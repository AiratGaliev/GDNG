import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { countPoEntries, createCrowdinApi, mapConcurrent, unwrapList } from './lib/crowdin-api.mjs';

const PROJECT_ID = Number(process.env.CROWDIN_PROJECT_ID || 948159);
const CONCURRENCY = Number(process.env.CROWDIN_EXPORT_CONCURRENCY || 6);
const LOCALES_ROOT = path.resolve('newIDE/app/src/locales');
const CATALOGS = [
  { name: 'ide-messages.pot', output: 'ide-messages.po' },
  { name: 'gdcore-gdcpp-gdjs-extensions-messages.pot', output: 'gdcore-gdcpp-gdjs-extensions-messages.po' },
];
function findFile(files, name) {
  const file = files.find(item => item.name === name);
  if (!file) throw new Error('Crowdin file not found: ' + name + '.');
  return file;
}
function safeLocale(locale) {
  if (!/^[A-Za-z0-9_-]+$/.test(locale)) throw new Error('Unsafe locale directory: ' + locale);
  return locale;
}
async function getProgress(api, fileId) {
  return unwrapList(await api.request('projects/' + PROJECT_ID + '/files/' + fileId + '/languages/progress?limit=500'));
}
async function exportPair(api, task, stagingRoot) {
  const response = await api.request('projects/' + PROJECT_ID + '/translations/exports', {
    method: 'POST',
    body: {
      targetLanguageId: task.languageId,
      fileIds: [task.file.id],
      skipUntranslatedStrings: false,
      exportApprovedOnly: false,
    },
  });
  if (!response?.data?.url) throw new Error('No export URL for ' + task.languageId + '/' + task.catalog.output + '.');
  const po = await api.downloadText(response.data.url);
  if (!po.includes('msgid ""') || !po.includes('msgstr')) throw new Error('Invalid PO export for ' + task.languageId + '/' + task.catalog.output + '.');
  const expected = Number(task.progress?.phrases?.total || 0);
  const actual = countPoEntries(po);
  if (expected && actual < expected) {
    throw new Error('Incomplete PO export for ' + task.languageId + '/' + task.catalog.output +
      ': ' + actual + ' entries; expected at least ' + expected + '.');
  }
  const locale = safeLocale(task.locale);
  const temporaryDirectory = path.join(stagingRoot, locale);
  await mkdir(temporaryDirectory, { recursive: true });
  const stagedPath = path.join(temporaryDirectory, task.catalog.output);
  await writeFile(stagedPath, po, 'utf8');
  return {
    stagedPath,
    destinationPath: path.join(LOCALES_ROOT, locale, task.catalog.output),
    entries: actual,
  };
}
async function main() {
  if (!Number.isInteger(PROJECT_ID) || PROJECT_ID <= 0) throw new Error('CROWDIN_PROJECT_ID must be positive.');
  if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 10) throw new Error('CROWDIN_EXPORT_CONCURRENCY must be between 1 and 10.');
  const api = createCrowdinApi();
  const [projectResponse, filesResponse] = await Promise.all([
    api.request('projects/' + PROJECT_ID),
    api.request('projects/' + PROJECT_ID + '/files?limit=500'),
  ]);
  const project = projectResponse.data;
  if (!project) throw new Error('Could not read Crowdin project ' + PROJECT_ID + '.');
  const files = unwrapList(filesResponse);
  const catalogs = CATALOGS.map(catalog => ({ ...catalog, file: findFile(files, catalog.name) }));
  const progress = await Promise.all(catalogs.map(catalog => getProgress(api, catalog.file.id)));
  const progressMaps = catalogs.map((catalog, index) => new Map(progress[index].map(row => [row.languageId, row])));
  const languages = project.targetLanguageIds || [];
  if (!languages.length) throw new Error('Crowdin project has no target languages.');
  const tasks = languages.flatMap(languageId => {
    const locale = project.languageMapping?.[languageId]?.locale_with_underscore;
    if (!locale) throw new Error('No locale_with_underscore mapping for ' + languageId + '.');
    return catalogs.map((catalog, index) => ({
      languageId, locale, catalog, file: catalog.file,
      progress: progressMaps[index].get(languageId),
    }));
  });

  const stagingRoot = await mkdtemp(path.join(LOCALES_ROOT, '.crowdin-download-'));
  try {
    console.log('GDNG Crowdin project: ' + project.name + ' (' + PROJECT_ID + ').');
    console.log('Languages: ' + languages.length + '; full PO exports: ' + tasks.length + '; concurrency: ' + CONCURRENCY + '.');
    const results = new Array(tasks.length);
    const errors = await mapConcurrent(tasks, CONCURRENCY, async (task, index) => {
      const result = await exportPair(api, task, stagingRoot);
      results[index] = result;
      console.log('Exported ' + task.languageId + '/' + task.catalog.output + ' (' + result.entries + ' entries).');
    });
    if (errors.length) {
      throw new Error(errors.length + ' export(s) failed:\n' +
        errors.map(item => item.item.languageId + '/' + item.item.catalog.output + ': ' + item.error).join('\n'));
    }
    // Install only after all exports pass validation, avoiding a partially updated locale tree.
    for (const result of results) {
      if (!result) throw new Error('An export completed without a staged file.');
      await mkdir(path.dirname(result.destinationPath), { recursive: true });
      await rename(result.stagedPath, result.destinationPath);
    }
    console.log('VERIFIED: installed ' + results.length + ' complete PO catalogs from GDNG Crowdin.');
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
