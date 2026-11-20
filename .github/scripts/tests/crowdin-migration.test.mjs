import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMigrationTasks,
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

test('rejects ambiguous mapping of multiple GDNG locales to one upstream language', () => {
  assert.throws(() => mapLanguages(
    {
      targetLanguageIds: ['sw-KE', 'sw-TZ'],
      targetLanguages: [
        { id: 'sw-KE', dialectOf: 'sw' },
        { id: 'sw-TZ', dialectOf: 'sw' },
      ],
    },
    {
      targetLanguageIds: ['sw', 'sw-UG'],
      languageMapping: {
        sw: { locale_with_underscore: 'sw_KE' },
        'sw-UG': { locale_with_underscore: 'sw_UG' },
      },
    }
  ), /Multiple GDNG languages map to upstream language sw/);
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
});
