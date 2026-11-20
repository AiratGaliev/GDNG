import { createCrowdinApi, getImportReportStats, mapConcurrent, sleep, unwrapList } from './lib/crowdin-api.mjs';
import { buildMissingTranslationsPo, parsePoCatalog } from './lib/po-catalog.mjs';

const SOURCE_PROJECT_ID = Number(process.env.SOURCE_PROJECT_ID || 79367);
const TARGET_PROJECT_ID = Number(process.env.TARGET_PROJECT_ID || 948159);
const DRY_RUN = process.env.DRY_RUN === 'true';
const CONCURRENCY = Number(process.env.CROWDIN_IMPORT_CONCURRENCY || 4);
const IMPORT_TIMEOUT_MS = 30 * 60 * 1000;
const CATALOGS = [
  { name: 'ide-messages.pot', output: 'ide-messages.po' },
  { name: 'gdcore-gdcpp-gdjs-extensions-messages.pot', output: 'gdcore-gdcpp-gdjs-extensions-messages.po' },
];

function findFile(files, name, project) {
  const found = files.find(file => file.name === name);
  if (!found) throw new Error('File ' + name + ' not found in ' + project + '.');
  return found;
}
function mapLanguages(source, target) {
  const sourceIds = new Set(source.targetLanguageIds || []);
  const sourceLanguages = source.targetLanguages || [];
  return (target.targetLanguageIds || []).map(languageId => {
    const locale = target.languageMapping?.[languageId]?.locale_with_underscore;
    const sourceLanguageId = sourceIds.has(languageId)
      ? languageId
      : sourceLanguages.find(item => item.dialectOf === languageId)?.id;
    if (!locale || !sourceLanguageId) throw new Error('No upstream language/locale mapping for ' + languageId + '.');
    return { languageId, sourceLanguageId, locale };
  });
}
const asProgressMap = rows => new Map(rows.map(row => [row.languageId, row]));
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

  if (delta.sourceTranslated > 0 && delta.matched === 0) {
    throw new Error(
      'No upstream source identities matched the GDNG catalog for ' + label +
      '; refusing to import translations against an unverified catalog.'
    );
  }

  return { label, sourcePo, delta };
}
function logMergePlan(label, delta, mode) {
  console.log(
    mode + ' ' + label + ': upstream translated=' + delta.sourceTranslated +
    ', already present=' + delta.alreadyTranslated +
    ', partially translated plural entries=' + delta.partiallyTranslated +
    ', unmatched source identities=' + delta.unmatched +
    ', source-equal=' + delta.sourceEqualsSource +
    ', missing translations=' + delta.deltaEntries + '.'
  );
}
async function importPair(api, task) {
  const { label, sourcePo, delta } = await buildMergePlan(api, task);
  logMergePlan(label, delta, 'Phrase merge');

  if (delta.partiallyTranslated > 0) {
    console.warn(
      'Preserving ' + delta.partiallyTranslated +
      ' partially translated plural entries in ' + label +
      '; they need a separate form-level review and will not be overwritten.'
    );
  }
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
  const verification = buildMissingTranslationsPo(sourcePo, destinationAfterImport);
  if (verification.deltaEntries > 0) {
    throw new Error(
      'Phrase merge verification failed for ' + label + ': ' +
      verification.deltaEntries + ' fully untranslated matched entries are still missing after import.'
    );
  }
  if (verification.partiallyTranslated > 0) {
    console.warn(
      'Post-import verification preserved ' + verification.partiallyTranslated +
      ' partially translated plural entries in ' + label + '.'
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

  const catalogs = CATALOGS.map(catalog => ({
    ...catalog,
    sourceFile: findFile(unwrapList(sourceFilesResponse), catalog.name, sourceProject.name),
    targetFile: findFile(unwrapList(targetFilesResponse), catalog.name, targetProject.name),
  }));
  const languages = mapLanguages(sourceProject, targetProject);
  const sourceRows = await Promise.all(
    catalogs.map(catalog => fileProgress(api, SOURCE_PROJECT_ID, catalog.sourceFile.id))
  );
  const tasks = [];

  catalogs.forEach((catalog, index) => {
    const source = asProgressMap(sourceRows[index]);
    for (const language of languages) {
      const upstreamCount = Number(source.get(language.sourceLanguageId)?.phrases?.translated || 0);
      if (upstreamCount > 0) tasks.push({ ...language, catalog });
    }
  });

  console.log('Upstream project: ' + sourceProject.name + ' (' + SOURCE_PROJECT_ID + ').');
  console.log('Destination project: ' + targetProject.name + ' (' + TARGET_PROJECT_ID + ').');
  console.log('Languages: ' + languages.length + '; source-non-empty file/language pairs: ' + tasks.length + '.');
  console.log('Phrase-level merge: only exact source identities missing in GDNG are imported.');
  console.log('Concurrent Imports API operations: ' + CONCURRENCY + '.');

  if (DRY_RUN) {
    const previewErrors = await mapConcurrent(tasks, CONCURRENCY, async task => {
      const { label, delta } = await buildMergePlan(api, task);
      logMergePlan(label, delta, 'DRY RUN');
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

  console.log('VERIFIED: all fully untranslated matched upstream entries are now present in GDNG.');
  console.log('Unmatched source identities were not imported; imported translations remain unapproved.');
  console.log('Existing translations and approvals were preserved. Partially translated plural entries were left untouched for separate review.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
