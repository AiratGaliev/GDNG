import { countNonEmptyTranslations, createCrowdinApi, getImportReportStats, mapConcurrent, sleep, unwrapList } from './lib/crowdin-api.mjs';

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
async function importPair(api, task) {
  const exported = await api.request('projects/' + SOURCE_PROJECT_ID + '/translations/exports', {
    method: 'POST',
    body: {
      targetLanguageId: task.sourceLanguageId,
      fileIds: [task.catalog.sourceFile.id],
      skipUntranslatedStrings: true,
      exportApprovedOnly: false,
    },
  });
  if (!exported?.data?.url) throw new Error('Crowdin returned no upstream PO export URL.');
  const po = await api.downloadText(exported.data.url);
  if (!po.includes('msgid ') || !po.includes('msgstr ')) throw new Error('Upstream export is not a valid PO catalog.');
  const entries = countNonEmptyTranslations(po);
  if (!entries) throw new Error('Upstream progress is non-zero but the exported PO contains no translations.');

  const storageId = await api.uploadStorage(
    'gdng-upstream-' + task.languageId + '-' + task.catalog.targetFile.id + '-' + task.catalog.output,
    po
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
  const label = task.languageId + '/' + task.catalog.output;
  console.log('Import started: ' + label + ', ' + entries + ' translated entries, operation ' + identifier + '.');
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

  console.log(
    'Import finished: ' + label + ' — ' + statistics.phrases +
    ' phrases, ' + statistics.words + ' words imported; skipped: ' +
    JSON.stringify(statistics.skipped) + '.'
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
  const [sourceRows, targetRows] = await Promise.all([
    Promise.all(catalogs.map(catalog => fileProgress(api, SOURCE_PROJECT_ID, catalog.sourceFile.id))),
    Promise.all(catalogs.map(catalog => fileProgress(api, TARGET_PROJECT_ID, catalog.targetFile.id))),
  ]);
  const tasks = [];
  let skippedExisting = 0;
  let emptyAtSource = 0;
  catalogs.forEach((catalog, index) => {
    const source = asProgressMap(sourceRows[index]);
    const target = asProgressMap(targetRows[index]);
    for (const language of languages) {
      const upstreamCount = Number(source.get(language.sourceLanguageId)?.phrases?.translated || 0);
      const destinationCount = Number(target.get(language.languageId)?.phrases?.translated || 0);
      if (!upstreamCount) { emptyAtSource += 1; continue; }
      // Resume-only behaviour protects every catalog that already contains destination translations.
      if (destinationCount > 0) { skippedExisting += 1; continue; }
      tasks.push({ ...language, catalog });
    }
  });

  console.log('Upstream project: ' + sourceProject.name + ' (' + SOURCE_PROJECT_ID + ').');
  console.log('Destination project: ' + targetProject.name + ' (' + TARGET_PROJECT_ID + ').');
  console.log('Languages: ' + languages.length + '; existing pairs preserved: ' + skippedExisting +
    '; empty upstream pairs: ' + emptyAtSource + '; queued imports: ' + tasks.length + '.');
  console.log('Concurrent Imports API operations: ' + CONCURRENCY + '.');
  if (DRY_RUN) {
    tasks.forEach(task => console.log('DRY RUN: ' + task.languageId + '/' + task.catalog.output + ' from ' + task.sourceLanguageId + '.'));
    return;
  }

  const errors = await mapConcurrent(tasks, CONCURRENCY, task => importPair(api, task));
  if (errors.length) {
    throw new Error(errors.length + ' import(s) failed:\n' +
      errors.map(item => item.item.languageId + '/' + item.item.catalog.output + ': ' + item.error).join('\n'));
  }

  const finalRows = await Promise.all(catalogs.map(catalog => fileProgress(api, TARGET_PROJECT_ID, catalog.targetFile.id)));
  const missing = [];
  catalogs.forEach((catalog, index) => {
    const source = asProgressMap(sourceRows[index]);
    const target = asProgressMap(finalRows[index]);
    for (const language of languages) {
      const sourceCount = Number(source.get(language.sourceLanguageId)?.phrases?.translated || 0);
      const targetCount = Number(target.get(language.languageId)?.phrases?.translated || 0);
      if (sourceCount > 0 && targetCount === 0) missing.push(language.languageId + '/' + catalog.output);
    }
    const translatedLanguages = finalRows[index].filter(row => Number(row.phrases?.translated || 0) > 0).length;
    console.log('Final coverage ' + catalog.output + ': ' + translatedLanguages + '/' + languages.length + ' languages.');
    const ru = finalRows[index].find(row => row.languageId === 'ru');
    console.log('Russian ' + catalog.output + ': ' + (ru?.phrases?.translated || 0) + '/' + (ru?.phrases?.total || 0) + ' phrases.');
  });
  if (missing.length) throw new Error('Some upstream translations are still absent from GDNG:\n' + missing.join('\n'));
  console.log('VERIFIED: all upstream file/language pairs with translations are present in GDNG.');
  console.log('New imports remain unapproved. Existing destination translations were not re-imported.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
