import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMigrationTasks,
  importPair,
  mapLanguages,
  resolveDryRun,
} from '../migrate-gdevelop-translations.mjs';

const source = {
  targetLanguageIds: ['fr', 'sw-KE'],
  targetLanguages: [
    { id: 'fr', dialectOf: null },
    { id: 'sw-KE', dialectOf: 'sw' },
  ],
};
const target = {
  targetLanguageIds: ['fr', 'sw'],
  languageMapping: {
    fr: { locale_with_underscore: 'fr_FR' },
    sw: { locale_with_underscore: 'sw_KE' },
  },
};
const catalogs = [
  { name: 'ide-messages.pot', sourceFile: { id: 10 } },
  { name: 'core.pot', sourceFile: { id: 20 } },
];


function createImportApiFixture({ importedPo, reportPhrases = 1 }) {
  const sourcePo = [
    'msgid ""',
    'msgstr ""',
    '"Plural-Forms: nplurals=2; plural=(n != 1);\\n"',
    '',
    'msgid "Save"',
    'msgstr "Сохранить"',
  ].join('\\n');
  const destinationBefore = [
    'msgid ""',
    'msgstr ""',
    '"Plural-Forms: nplurals=2; plural=(n != 1);\\n"',
    '',
    'msgid "Save"',
    'msgstr ""',
  ].join('\\n');
  const calls = [];
  let gdngExportCount = 0;
  let uploaded = null;

  const api = {
    async request(endpoint, options = {}) {
      calls.push({ endpoint, options });
      if (endpoint === 'projects/79367/translations/exports') {
        return { data: { url: 'https://fixture.test/upstream' } };
      }
      if (endpoint === 'projects/948159/translations/exports') {
        gdngExportCount += 1;
        return { data: { url: 'https://fixture.test/gdng-' + gdngExportCount } };
      }
      if (endpoint === 'projects/948159/translations/imports' && options.method === 'POST') {
        return { data: { identifier: 'import-fixture-1' } };
      }
      if (endpoint === 'projects/948159/translations/imports/import-fixture-1') {
        return { data: { status: 'finished' } };
      }
      if (endpoint === 'projects/948159/translations/imports/import-fixture-1/report') {
        return {
          data: {
            languages: [{
              id: 'fr',
              files: [{
                id: 20,
                statistics: { phrases: reportPhrases, words: 2 },
              }],
            }],
          },
        };
      }
      throw new Error('Unexpected fixture API request: ' + endpoint);
    },
    async downloadText(url) {
      if (url === 'https://fixture.test/upstream') return sourcePo;
      if (url === 'https://fixture.test/gdng-1') return destinationBefore;
      if (url === 'https://fixture.test/gdng-2') return importedPo;
      throw new Error('Unexpected fixture download: ' + url);
    },
    async uploadStorage(name, content) {
      uploaded = { name, content };
      return 99;
    },
  };

  return { api, calls, get uploaded() { return uploaded; } };
}

const importTask = {
  languageId: 'fr',
  sourceLanguageId: 'fr',
  catalog: {
    output: 'ide-messages.po',
    sourceFile: { id: 10 },
    targetFile: { id: 20 },
  },
};
const importedDestinationPo = [
  'msgid ""',
  'msgstr ""',
  '"Plural-Forms: nplurals=2; plural=(n != 1);\\n"',
  '',
  'msgid "Save"',
  'msgstr "Сохранить"',
].join('\\n');

test('imports only into GDNG with approvals disabled and verifies the final text', async () => {
  const fixture = createImportApiFixture({ importedPo: importedDestinationPo });
  await importPair(fixture.api, importTask);

  const storageCall = fixture.uploaded;
  const importCall = fixture.calls.find(call =>
    call.endpoint === 'projects/948159/translations/imports' && call.options.method === 'POST'
  );

  assert.ok(storageCall);
  assert.match(storageCall.name, /^gdng-upstream-fr-20-missing-ide-messages\.po$/);
  assert.match(storageCall.content, /msgstr "Сохранить"/);
  assert.ok(importCall);
  assert.deepEqual(importCall.options.body, {
    storageId: 99,
    fileId: 20,
    languageIds: ['fr'],
    importEqSuggestions: false,
    autoApproveImported: false,
    translateHidden: false,
    addToTm: true,
  });
  assert.equal(fixture.calls.filter(call => call.endpoint === 'projects/79367/translations/exports').length, 1);
  assert.equal(fixture.calls.some(call => call.endpoint.startsWith('projects/79367/translations/imports')), false);
  assert.equal(fixture.calls.filter(call => call.endpoint === 'projects/948159/translations/exports').length, 2);
});

test('fails the seed when Crowdin import report has no imported phrases', async () => {
  const fixture = createImportApiFixture({
    importedPo: importedDestinationPo,
    reportPhrases: 0,
  });
  await assert.rejects(
    () => importPair(fixture.api, importTask),
    /Crowdin reported zero imported phrases/
  );
});

test('fails the seed when post-import export does not contain the expected upstream text', async () => {
  const fixture = createImportApiFixture({
    importedPo: importedDestinationPo.replace('Сохранить', 'Сохранить вручную'),
  });
  await assert.rejects(
    () => importPair(fixture.api, importTask),
    /expected translation form\(s\) are missing or differ after import/
  );
});

test('defaults the importer to dry-run and requires an explicit false for writes', () => {
  assert.equal(resolveDryRun(undefined), true);
  assert.equal(resolveDryRun(''), true);
  assert.equal(resolveDryRun('true'), true);
  assert.equal(resolveDryRun('false'), false);
  assert.throws(() => resolveDryRun('0'), /DRY_RUN must be explicitly/);
});

test('maps an upstream language dialect to the GDNG language identifier', () => {
  assert.deepEqual(mapLanguages(source, target), [
    { languageId: 'fr', sourceLanguageId: 'fr', locale: 'fr_FR' },
    { languageId: 'sw', sourceLanguageId: 'sw-KE', locale: 'sw_KE' },
  ]);
});

test('rejects missing, empty or duplicate project language lists', () => {
  assert.throws(
    () => mapLanguages({ targetLanguageIds: [], targetLanguages: [] }, target),
    /GDevelop project returned no target languages/
  );
  assert.throws(
    () => mapLanguages(source, { targetLanguageIds: [], languageMapping: {} }),
    /GDNG project returned no target languages/
  );
  assert.throws(
    () => mapLanguages({ ...source, targetLanguageIds: ['fr', 'fr'] }, target),
    /GDevelop project returned duplicate/
  );
  assert.throws(
    () => mapLanguages(source, { ...target, targetLanguageIds: ['fr', 'fr'] }),
    /GDNG project returned duplicate/
  );
});

test('rejects a GDNG locale without an exact or dialect upstream mapping', () => {
  assert.throws(() => mapLanguages(
    {
      targetLanguageIds: ['sw-KE'],
      targetLanguages: [{ id: 'sw-KE', dialectOf: 'sw' }],
    },
    {
      targetLanguageIds: ['sw', 'sw-UG'],
      languageMapping: {
        sw: { locale_with_underscore: 'sw_KE' },
        'sw-UG': { locale_with_underscore: 'sw_UG' },
      },
    }
  ), /No upstream language\/locale mapping for GDNG language sw-UG/);
});

test('builds tasks only for validated, non-empty upstream progress rows', () => {
  const languages = mapLanguages(source, target);
  const rows = [
    [
      { languageId: 'fr', phrases: { translated: 12 } },
      { languageId: 'sw-KE', phrases: { translated: 0 } },
    ],
    [
      { languageId: 'fr', phrases: { translated: 0 } },
      { languageId: 'sw-KE', phrases: { translated: 3 } },
    ],
  ];
  const tasks = buildMigrationTasks(catalogs, languages, rows);
  assert.deepEqual(tasks.map(task => [task.languageId, task.catalog.name]), [
    ['fr', 'ide-messages.pot'],
    ['sw', 'core.pot'],
  ]);
});

test('fails closed when any mapped language progress row is missing', () => {
  const languages = mapLanguages(source, target);
  assert.throws(
    () => buildMigrationTasks(catalogs, languages, [
      [{ languageId: 'fr', phrases: { translated: 12 } }],
      [
        { languageId: 'fr', phrases: { translated: 1 } },
        { languageId: 'sw-KE', phrases: { translated: 2 } },
      ],
    ]),
    /progress is missing for sw-KE/
  );
});

test('fails closed on duplicate or invalid upstream progress rows', () => {
  const languages = mapLanguages(source, target);
  assert.throws(
    () => buildMigrationTasks(catalogs, languages, [
      [
        { languageId: 'fr', phrases: { translated: 1 } },
        { languageId: 'fr', phrases: { translated: 2 } },
        { languageId: 'sw-KE', phrases: { translated: 0 } },
      ],
      [
        { languageId: 'fr', phrases: { translated: 0 } },
        { languageId: 'sw-KE', phrases: { translated: 0 } },
      ],
    ]),
    /duplicate language progress/
  );
  assert.throws(
    () => buildMigrationTasks(catalogs, languages, [
      [
        { languageId: 'fr', phrases: { translated: Number.NaN } },
        { languageId: 'sw-KE', phrases: { translated: 0 } },
      ],
      [
        { languageId: 'fr', phrases: { translated: 0 } },
        { languageId: 'sw-KE', phrases: { translated: 0 } },
      ],
    ]),
    /invalid translated phrase count/
  );
  assert.throws(
    () => buildMigrationTasks(catalogs, languages, [
      [
        { languageId: 'fr', phrases: { translated: null } },
        { languageId: 'sw-KE', phrases: { translated: 0 } },
      ],
      [
        { languageId: 'fr', phrases: { translated: 0 } },
        { languageId: 'sw-KE', phrases: { translated: 0 } },
      ],
    ]),
    /missing or non-numeric translated phrase count/
  );
});
