/**
 * Read-only diagnostic for upstream GDevelop and GDNG Crowdin projects.
 * The audit uses GET requests only. It never creates export jobs, uploads
 * storage, imports translations, approves strings, or changes project settings.
 */
import { pathToFileURL } from 'node:url';
import { createCrowdinApi, unwrapList } from './lib/crowdin-api.mjs';
import {
  assertCrowdinProjectPair,
  assertGdngProject,
  assertGdngProjectId,
  CROWDIN_PROJECT_IDS,
} from './lib/crowdin-projects.mjs';

const CATALOGS = [
  { name: 'gdcore-gdcpp-gdjs-extensions-messages.pot', label: 'Core/GDJS/extensions' },
  { name: 'ide-messages.pot', label: 'IDE' },
];

export function compareProjectLanguages(sourceProject, targetProject) {
  const sourceLanguages = sourceProject.targetLanguages || (sourceProject.targetLanguageIds || []).map(id => ({ id }));
  const targetIds = new Set(targetProject.targetLanguageIds || []);
  const matchedTargetIds = new Set();
  const dialectAliases = [];
  const missingSourceLanguageIds = [];

  for (const language of sourceLanguages) {
    if (targetIds.has(language.id)) {
      matchedTargetIds.add(language.id);
    } else if (language.dialectOf && targetIds.has(language.dialectOf)) {
      matchedTargetIds.add(language.dialectOf);
      dialectAliases.push({ sourceLanguageId: language.id, targetLanguageId: language.dialectOf });
    } else {
      missingSourceLanguageIds.push(language.id);
    }
  }

  return {
    sourceLanguageCount: sourceProject.targetLanguageIds?.length ?? sourceLanguages.length,
    targetLanguageCount: targetIds.size,
    missingSourceLanguageIds,
    dialectAliases,
    targetOnlyLanguageIds: [...targetIds].filter(id => !matchedTargetIds.has(id)),
  };
}

export function getConsistentPhraseTotal(progressRows, label) {
  if (!Array.isArray(progressRows) || progressRows.length === 0) {
    throw new Error('Crowdin returned no language progress rows for ' + label + '.');
  }
  const totals = progressRows.map(row => Number(row.phrases?.total));
  if (totals.some(total => !Number.isSafeInteger(total) || total <= 0)) {
    throw new Error('Crowdin returned an invalid phrase total for ' + label + '.');
  }
  if (new Set(totals).size !== 1) {
    throw new Error('Crowdin phrase totals differ between languages for ' + label + '.');
  }
  return totals[0];
}

export function sumPhraseMetric(progressRows, metric) {
  if (!Array.isArray(progressRows)) throw new Error('Crowdin progress rows must be an array.');
  return progressRows.reduce((sum, row) => {
    const value = Number(row.phrases?.[metric] ?? 0);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Crowdin returned an invalid phrases.' + metric + ' value.');
    }
    const next = sum + value;
    if (!Number.isSafeInteger(next)) {
      throw new Error('Crowdin phrases.' + metric + ' total exceeds the safe integer range.');
    }
    return next;
  }, 0);
}

export function compareMappedTranslations(sourceProject, targetProject, sourceProgressRows, targetProgressRows) {
  const targetIds = new Set(targetProject.targetLanguageIds || []);
  const sourceLanguages = new Map((sourceProject.targetLanguages || []).map(language => [language.id, language]));
  const sourceProgress = new Map(sourceProgressRows.map(row => [row.languageId, row]));
  const targetProgress = new Map(targetProgressRows.map(row => [row.languageId, row]));
  const mappedSourceRows = [];
  const mappedTargetRows = [];
  const matchedTargetIds = new Set();

  for (const sourceLanguageId of sourceProject.targetLanguageIds || []) {
    const language = sourceLanguages.get(sourceLanguageId) || { id: sourceLanguageId };
    const targetLanguageId = targetIds.has(sourceLanguageId)
      ? sourceLanguageId
      : (language.dialectOf && targetIds.has(language.dialectOf) ? language.dialectOf : null);
    if (!targetLanguageId) continue;

    // Two upstream locales must not be silently counted against the same GDNG locale.
    if (matchedTargetIds.has(targetLanguageId)) {
      throw new Error('Multiple upstream languages map to GDNG language ' + targetLanguageId + '.');
    }
    matchedTargetIds.add(targetLanguageId);

    const upstreamRow = sourceProgress.get(sourceLanguageId);
    const gdngRow = targetProgress.get(targetLanguageId);
    if (!upstreamRow || !gdngRow) {
      throw new Error('Crowdin progress is incomplete for mapped language ' + sourceLanguageId + ' → ' + targetLanguageId + '.');
    }
    mappedSourceRows.push(upstreamRow);
    mappedTargetRows.push(gdngRow);
  }

  const sourceTranslated = sumPhraseMetric(mappedSourceRows, 'translated');
  const targetTranslated = sumPhraseMetric(mappedTargetRows, 'translated');
  const sourceApproved = sumPhraseMetric(mappedSourceRows, 'approved');
  const targetApproved = sumPhraseMetric(mappedTargetRows, 'approved');

  return {
    mappedLanguages: mappedSourceRows.length,
    sourceTranslated,
    targetTranslated,
    difference: sourceTranslated - targetTranslated,
    sourceApproved,
    targetApproved,
    approvalDifference: sourceApproved - targetApproved,
  };
}

function findFile(files, name, projectId) {
  const matches = files.filter(file => file.name === name);
  if (matches.length !== 1) {
    throw new Error('Expected exactly one ' + name + ' in Crowdin project ' + projectId + '; found ' + matches.length + '.');
  }
  return matches[0];
}

async function getProgress(api, projectId, fileId) {
  return unwrapList(await api.request(
    'projects/' + projectId + '/files/' + fileId + '/languages/progress?limit=500'
  ));
}

async function getProjectProgress(api, projectId) {
  return unwrapList(await api.request('projects/' + projectId + '/languages/progress?limit=500'));
}

async function auditParity() {
  const api = createCrowdinApi();
  const [sourceProjectResponse, targetProjectResponse, sourceFilesResponse, targetFilesResponse] = await Promise.all([
    api.request('projects/' + CROWDIN_PROJECT_IDS.gdevelop),
    api.request('projects/' + CROWDIN_PROJECT_IDS.gdng),
    api.request('projects/' + CROWDIN_PROJECT_IDS.gdevelop + '/files?limit=500'),
    api.request('projects/' + CROWDIN_PROJECT_IDS.gdng + '/files?limit=500'),
  ]);

  const sourceProject = sourceProjectResponse.data;
  const targetProject = targetProjectResponse.data;
  assertCrowdinProjectPair(sourceProject, targetProject);

  const sourceFiles = unwrapList(sourceFilesResponse);
  const targetFiles = unwrapList(targetFilesResponse);
  const catalogs = CATALOGS.map(catalog => ({
    ...catalog,
    sourceFile: findFile(sourceFiles, catalog.name, CROWDIN_PROJECT_IDS.gdevelop),
    targetFile: findFile(targetFiles, catalog.name, CROWDIN_PROJECT_IDS.gdng),
  }));

  const [sourceProjectProgress, targetProjectProgress, ...catalogProgress] = await Promise.all([
    getProjectProgress(api, CROWDIN_PROJECT_IDS.gdevelop),
    getProjectProgress(api, CROWDIN_PROJECT_IDS.gdng),
    ...catalogs.flatMap(catalog => [
      getProgress(api, CROWDIN_PROJECT_IDS.gdevelop, catalog.sourceFile.id),
      getProgress(api, CROWDIN_PROJECT_IDS.gdng, catalog.targetFile.id),
    ]),
  ]);

  console.log('Read-only Crowdin parity audit');
  console.log('GDevelop source: ' + sourceProject.name + ' (' + CROWDIN_PROJECT_IDS.gdevelop + '); GDNG destination: ' + targetProject.name + ' (' + CROWDIN_PROJECT_IDS.gdng + ').');

  const languageParity = compareProjectLanguages(sourceProject, targetProject);
  console.log('Target languages: GDevelop=' + languageParity.sourceLanguageCount + ', GDNG=' + languageParity.targetLanguageCount + '.');
  for (const alias of languageParity.dialectAliases) {
    console.log('Language alias: upstream ' + alias.sourceLanguageId + ' maps to GDNG ' + alias.targetLanguageId + '.');
  }
  if (languageParity.missingSourceLanguageIds.length) {
    console.log('::warning::GDNG has no target language for upstream: ' + languageParity.missingSourceLanguageIds.join(', ') + '.');
  }
  if (languageParity.targetOnlyLanguageIds.length) {
    console.log('::warning::GDNG has target languages not represented by GDevelop: ' + languageParity.targetOnlyLanguageIds.join(', ') + '.');
  }

  for (let index = 0; index < catalogs.length; index += 1) {
    const catalog = catalogs[index];
    const sourceRows = catalogProgress[index * 2];
    const targetRows = catalogProgress[index * 2 + 1];
    const sourceTotal = getConsistentPhraseTotal(sourceRows, 'GDevelop/' + catalog.name);
    const targetTotal = getConsistentPhraseTotal(targetRows, 'GDNG/' + catalog.name);
    const difference = sourceTotal - targetTotal;
    console.log(
      'Source phrases ' + catalog.label + ': GDevelop=' + sourceTotal +
      ', GDNG=' + targetTotal + ', upstream-only count difference=' + difference + '.'
    );
    if (difference !== 0) {
      console.log('::warning::Source catalog phrase counts differ for ' + catalog.name + '; upstream-only strings require source-catalog review, not blind translation import.');
    }
  }

  const mappedTranslations = compareMappedTranslations(
    sourceProject,
    targetProject,
    sourceProjectProgress,
    targetProjectProgress
  );
  console.log(
    'Mapped-language translations: GDevelop=' + mappedTranslations.sourceTranslated +
    ', GDNG=' + mappedTranslations.targetTranslated +
    ', difference=' + mappedTranslations.difference +
    ' across ' + mappedTranslations.mappedLanguages + ' languages.'
  );
  console.log(
    'Mapped-language approvals: GDevelop=' + mappedTranslations.sourceApproved +
    ', GDNG=' + mappedTranslations.targetApproved +
    ', difference=' + mappedTranslations.approvalDifference + '.'
  );
  if (mappedTranslations.difference !== 0) {
    console.log('::warning::Translation totals differ on mapped languages. The phrase-level reconciler must distinguish source identities before any import.');
  }
  if (mappedTranslations.approvalDifference > 0) {
    console.log('::warning::GDevelop has more approved phrases on mapped languages; imported translations intentionally remain unapproved until GDNG review.');
  }
  console.log('Audit complete. No Crowdin project content or settings were changed.');
}

async function assertUploadTarget() {
  const projectId = assertGdngProjectId(process.env.CROWDIN_PROJECT_ID);
  const api = createCrowdinApi();
  const response = await api.request('projects/' + projectId);
  assertGdngProject(response.data);
  console.log('GDNG Crowdin project identity verified; source upload may proceed.');
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const operation = process.argv[2];
  const run = operation === '--assert-upload-target' ? assertUploadTarget : auditParity;
  run().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
