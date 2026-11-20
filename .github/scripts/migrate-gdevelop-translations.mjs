import { pathToFileURL } from 'node:url';
import { createCrowdinApi, getImportReportStats, mapConcurrent, sleep, unwrapList } from './lib/crowdin-api.mjs';
import {
  buildMissingTranslationsPo,
  findMissingExpectedTranslationsPo,
  parsePoCatalog,
} from './lib/po-catalog.mjs';
import { CROWDIN_PROJECT_IDS, assertCrowdinProjectPair, assertProjectId } from './lib/crowdin-projects.mjs';

// Project IDs are pinned: the upstream GDevelop project is read-only, and GDNG is the only write target.
const SOURCE_PROJECT_ID = assertProjectId(process.env.SOURCE_PROJECT_ID, CROWDIN_PROJECT_IDS.gdevelop, 'SOURCE_PROJECT_ID');
const TARGET_PROJECT_ID = assertProjectId(process.env.TARGET_PROJECT_ID, CROWDIN_PROJECT_IDS.gdng, 'TARGET_PROJECT_ID');
export function resolveDryRun(value) {
  if (value === undefined || value === '' || value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('DRY_RUN must be explicitly set to either true or false.');
}
const DRY_RUN = resolveDryRun(process.env.DRY_RUN);
const CONCURRENCY = Number(process.env.CROWDIN_IMPORT_CONCURRENCY || 4);
const IMPORT_TIMEOUT_MS = 30 * 60 * 1000;
const CATALOGS = [
  { name: 'ide-messages.pot', output: 'ide-messages.po' },
  { name: 'gdcore-gdcpp-gdjs-extensions-messages.pot', output: 'gdcore-gdcpp-gdjs-extensions-messages.po' },
];

function findFile(files, name, project) {
  const matches = files.filter(file => file.name === name);
  if (matches.length !== 1) throw new Error('Expected exactly one ' + name + ' file in ' + project.name + '; found ' + matches.length + '.');
  return matches[0];
}
export function mapLanguages(source, target) {
  const sourceIdsList = source?.targetLanguageIds;
  const targetIdsList = target?.targetLanguageIds;
  if (!Array.isArray(sourceIdsList) || sourceIdsList.length === 0) {
    throw new Error('GDevelop project returned no target languages; refusing to complete an empty seed.');
  }
  if (!Array.isArray(targetIdsList) || targetIdsList.length === 0) {
    throw new Error('GDNG project returned no target languages; refusing to complete an empty seed.');
  }
  if (new Set(sourceIdsList).size !== sourceIdsList.length) {
    throw new Error('GDevelop project returned duplicate target language identifiers.');
  }
  if (new Set(targetIdsList).size !== targetIdsList.length) {
    throw new Error('GDNG project returned duplicate target language identifiers.');
  }

  const sourceIds = new Set(sourceIdsList);
  const sourceLanguages = source.targetLanguages || [];
  const mappedSourceIds = new Set();
  return targetIdsList.map(languageId => {
    const locale = target.languageMapping?.[languageId]?.locale_with_underscore;
    const sourceLanguageId = sourceIds.has(languageId)
      ? languageId
      : sourceLanguages.find(item => item.dialectOf === languageId)?.id;
    if (!locale || !sourceLanguageId) {
      throw new Error('No upstream language/locale mapping for GDNG language ' + languageId + '.');
    }
    if (mappedSourceIds.has(sourceLanguageId)) {
      throw new Error('Multiple GDNG languages map to upstream language ' + sourceLanguageId + '.');
    }
    mappedSourceIds.add(sourceLanguageId);
    return { languageId, sourceLanguageId, locale };
  });
}

/**
 * Build seed tasks only when Crowdin returned a valid progress row for every
 * mapped source language and catalog. Missing progress must never look like
 * zero translations, or the one-time seed could be marked complete early.
 */
export function buildMigrationTasks(catalogs, languages, sourceProgressRows) {
  if (!Array.isArray(sourceProgressRows) || sourceProgressRows.length !== catalogs.length) {
    throw new Error('Crowdin source progress is incomplete for the configured catalogs.');
  }

  const tasks = [];
  catalogs.forEach((catalog, index) => {
    const rows = sourceProgressRows[index];
    if (!Array.isArray(rows)) {
      throw new Error('Crowdin source progress rows are missing for ' + catalog.name + '.');
    }
    const progressByLanguage = new Map();
    for (const row of rows) {
      if (!row?.languageId || progressByLanguage.has(row.languageId)) {
        throw new Error('Crowdin returned a missing or duplicate language progress row for ' + catalog.name + '.');
      }
      progressByLanguage.set(row.languageId, row);
    }

    for (const language of languages) {
      const progress = progressByLanguage.get(language.sourceLanguageId);
      if (!progress) {
        throw new Error(
          'Crowdin source progress is missing for ' + language.sourceLanguageId +
          '/' + catalog.name + '; refusing to skip an unverified language.'
        );
      }
      const rawTranslated = progress.phrases?.translated;
      const translatedText = typeof rawTranslated === 'string' ? rawTranslated.trim() : null;
      if (
        rawTranslated === undefined ||
        rawTranslated === null ||
        (typeof rawTranslated !== 'number' && !(translatedText && /^\\d+$/.test(translatedText)))
      ) {
        throw new Error(
          'Crowdin returned a missing or non-numeric translated phrase count for ' +
          language.sourceLanguageId + '/' + catalog.name + '.'
        );
      }
      const translated = Number(rawTranslated);
      if (!Number.isSafeInteger(translated) || translated < 0) {
        throw new Error(
          'Crowdin returned an invalid translated phrase count for ' +
          language.sourceLanguageId + '/' + catalog.name + '.'
        );
      }
      if (translated > 0) tasks.push({ ...language, catalog });
    }
  });

  return tasks;
}
async function fileProgress(api, projectId, fileId) {
  return unwrapList(await api.request('projects/' + projectId + '/files/' + fileId + '/languages/progress?limit=500'));
}
async function exportPo(api, projectId, languageId, fileId, skipUntranslatedStrings) {
  const exported = await api.request('projects/' + projectId + '/translations/exports', {
    method: 'POST',
    body: {
      targetLanguageId: languageId,
      fileIds: [fileId],
      skipUntranslatedStrings,
      exportApprovedOnly: false,
    },
  });
  if (!exported?.data?.url) {
    throw new Error('Crowdin returned no PO export URL for project ' + projectId + ', file ' + fileId + ', language ' + languageId + '.');
  }

  const po = await api.downloadText(exported.data.url);
  const catalog = parsePoCatalog(po);
  if (!catalog.entries.length) {
    throw new Error('Crowdin exported an empty source catalog for file ' + fileId + ', language ' + languageId + '.');
  }
  return po;
}
async function waitForImport(api, identifier, label) {
  const deadline = Date.now() + IMPORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await api.request('projects/' + TARGET_PROJECT_ID + '/translations/imports/' + identifier);
    const operation = response?.data;
    if (operation?.status === 'finished') return;
    if (operation?.status === 'failed' || operation?.status === 'canceled') {
      throw new Error('Import ' + operation.status + ' for ' + label + ': ' + JSON.stringify(operation.error || operation));
    }
    if (!operation?.status) throw new Error('No Crowdin import status for ' + identifier + '.');
    await sleep(3_000);
  }
  throw new Error('Timed out waiting for Crowdin import ' + label + ' (' + identifier + ').');
}
async function buildMergePlan(api, task) {
  const label = task.languageId + '/' + task.catalog.output;
  const [sourcePo, destinationPo] = await Promise.all([
    exportPo(api, SOURCE_PROJECT_ID, task.sourceLanguageId, task.catalog.sourceFile.id, true),
    // Include untranslated entries so absence is checked per source identity, not per catalog.
    exportPo(api, TARGET_PROJECT_ID, task.languageId, task.catalog.targetFile.id, false),
  ]);
  const delta = buildMissingTranslationsPo(sourcePo, destinationPo);

  logMergePlan(label, delta, DRY_RUN ? 'DRY RUN' : 'Merge plan');
  if (delta.sourcePartiallyTranslated > 0) {
    throw new Error(
      'Source catalog contains ' + delta.sourcePartiallyTranslated +
      ' partially translated plural entries for ' + label +
      '; refusing to mark the one-time seed complete with untranslated plural forms.'
    );
  }
  if (delta.partiallyTranslated > 0) {
    throw new Error(
      'GDNG already contains ' + delta.partiallyTranslated +
      ' partially translated plural entries for ' + label +
      '; preserving existing forms and requiring explicit reconciliation.'
    );
  }
  if (delta.sourceTranslated > 0 && delta.matched === 0) {
    throw new Error(
      'No upstream source identities matched the GDNG catalog for ' + label +
      '; refusing to import translations against an unverified catalog.'
    );
  }

  return { label, delta };
}
function logMergePlan(label, delta, mode) {
  console.log(
    mode + ' ' + label + ': upstream translated=' + delta.sourceTranslated +
    ', already present=' + delta.alreadyTranslated +
    ', partially translated source plurals=' + delta.sourcePartiallyTranslated +
    ', partially translated destination plurals=' + delta.partiallyTranslated +
    ', conflicting existing entries preserved=' + delta.conflictingEntries +
    ', unmatched source identities=' + delta.unmatched +
    ', source-equal=' + delta.sourceEqualsSource +
    ', missing translations=' + delta.deltaEntries + '.'
  );
}
export async function importPair(api, task) {
  const { label, delta } = await buildMergePlan(api, task);
  if (delta.deltaEntries === 0) {
    console.log('No Crowdin import required for ' + label + '.');
    return;
  }

  const storageId = await api.uploadStorage(
    'gdng-upstream-' + task.languageId + '-' + task.catalog.targetFile.id + '-missing-' + task.catalog.output,
    delta.po
  );
  const imported = await api.request('projects/' + TARGET_PROJECT_ID + '/translations/imports', {
    method: 'POST',
    body: {
      storageId,
      fileId: task.catalog.targetFile.id,
      languageIds: [task.languageId],
      importEqSuggestions: false,
      autoApproveImported: false,
      translateHidden: false,
      addToTm: true,
    },
  });
  const identifier = imported?.data?.identifier;
  if (!identifier) throw new Error('Crowdin returned no import operation identifier.');

  console.log(
    'Import started: ' + label + ', ' + delta.deltaEntries +
    ' missing PO entries, operation ' + identifier + '.'
  );
  await waitForImport(api, identifier, label);

  const report = await api.request(
    'projects/' + TARGET_PROJECT_ID + '/translations/imports/' + identifier + '/report'
  );
  const statistics = getImportReportStats(
    report,
    task.languageId,
    task.catalog.targetFile.id
  );
  if (statistics.phrases === 0) {
    throw new Error('Crowdin reported zero imported phrases for ' + label + '.');
  }

  // Re-export the destination and prove that every matched upstream translation
  // that was missing before import now exists. This also catches QA/hidden skips.
  const destinationAfterImport = await exportPo(
    api,
    TARGET_PROJECT_ID,
    task.languageId,
    task.catalog.targetFile.id,
    false
  );
  const missingExpected = findMissingExpectedTranslationsPo(delta.po, destinationAfterImport);
  if (missingExpected.length > 0) {
    throw new Error(
      'Phrase merge verification failed for ' + label + ': ' +
      missingExpected.length + ' expected translation form(s) are missing or differ after import. ' +
      JSON.stringify(missingExpected.slice(0, 5).map(item => ({
        key: item.key,
        pluralIndex: item.pluralIndex,
        actualPresent: item.actual !== undefined,
      })))
    );
  }

  console.log(
    'Import verified: ' + label + ' — Crowdin report=' + statistics.phrases +
    ' phrases, ' + statistics.words + ' words; skipped=' +
    JSON.stringify(statistics.skipped) + '. Existing destination translations were not uploaded.'
  );
}
async function main() {
  if (!Number.isInteger(SOURCE_PROJECT_ID) || SOURCE_PROJECT_ID <= 0) throw new Error('SOURCE_PROJECT_ID must be positive.');
  if (!Number.isInteger(TARGET_PROJECT_ID) || TARGET_PROJECT_ID <= 0) throw new Error('TARGET_PROJECT_ID must be positive.');
  if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 6) throw new Error('CROWDIN_IMPORT_CONCURRENCY must be between 1 and 6.');

  const api = createCrowdinApi();
  const [sourceProjectResponse, targetProjectResponse, sourceFilesResponse, targetFilesResponse] = await Promise.all([
    api.request('projects/' + SOURCE_PROJECT_ID),
    api.request('projects/' + TARGET_PROJECT_ID),
    api.request('projects/' + SOURCE_PROJECT_ID + '/files?limit=500'),
    api.request('projects/' + TARGET_PROJECT_ID + '/files?limit=500'),
  ]);
  const sourceProject = sourceProjectResponse.data;
  const targetProject = targetProjectResponse.data;
  if (!sourceProject || !targetProject) throw new Error('Unable to read both Crowdin projects.');

  // Validate both remote identities before any export job, Storage upload, or Import API operation.
  assertCrowdinProjectPair(sourceProject, targetProject);

  const catalogs = CATALOGS.map(catalog => ({
    ...catalog,
    sourceFile: findFile(unwrapList(sourceFilesResponse), catalog.name, sourceProject),
    targetFile: findFile(unwrapList(targetFilesResponse), catalog.name, targetProject),
  }));
  const languages = mapLanguages(sourceProject, targetProject);
  const sourceRows = await Promise.all(
    catalogs.map(catalog => fileProgress(api, SOURCE_PROJECT_ID, catalog.sourceFile.id))
  );
  const tasks = buildMigrationTasks(catalogs, languages, sourceRows);

  console.log('Upstream project: ' + sourceProject.name + ' (' + SOURCE_PROJECT_ID + ').');
  console.log('Destination project: ' + targetProject.name + ' (' + TARGET_PROJECT_ID + ').');
  console.log('Languages: ' + languages.length + '; source-non-empty file/language pairs: ' + tasks.length + '.');
  console.log('Phrase-level merge: only exact source identities missing in GDNG are imported.');
  console.log('Concurrent Imports API operations: ' + CONCURRENCY + '.');

  if (DRY_RUN) {
    const previewErrors = await mapConcurrent(tasks, CONCURRENCY, async task => {
      const { delta } = await buildMergePlan(api, task);
      return delta;
    });
    if (previewErrors.length) {
      throw new Error(previewErrors.length + ' phrase merge preview(s) failed:\n' +
        previewErrors.map(item => item.item.languageId + '/' + item.item.catalog.output + ': ' + item.error).join('\n'));
    }
    console.log('DRY RUN complete: exact phrase-level deltas calculated; no Crowdin storage or import writes were made.');
    return;
  }

  const errors = await mapConcurrent(tasks, CONCURRENCY, task => importPair(api, task));
  if (errors.length) {
    throw new Error(errors.length + ' phrase merge(s) failed:\n' +
      errors.map(item => item.item.languageId + '/' + item.item.catalog.output + ': ' + item.error).join('\n'));
  }

  console.log('VERIFIED: every expected non-source-equal imported translation form is present verbatim in GDNG.');
  console.log('Unmatched source identities were not imported; imported translations remain unapproved.');
  console.log('Existing translations and approvals were preserved. Any partial plural catalog blocks completion instead of silently skipping forms.');
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
