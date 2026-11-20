import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCrowdinProjectPair,
  assertGdngProject,
  assertGdngProjectId,
  assertProjectId,
  CROWDIN_PROJECT_IDS,
} from '../lib/crowdin-projects.mjs';
import {
  compareMappedTranslations,
  compareProjectLanguages,
  getConsistentPhraseTotal,
  sumPhraseMetric,
} from '../audit-crowdin-parity.mjs';

const gdevelop = {
  id: 79367,
  name: 'GDevelop 5',
  identifier: 'gdevelop',
  type: 'file-based',
  sourceLanguageId: 'en',
};
const gdng = {
  id: 948159,
  name: 'GDNG',
  type: 'file-based',
  sourceLanguageId: 'en',
};

test('pins the upstream read-only and GDNG destination project IDs', () => {
  assert.deepEqual(CROWDIN_PROJECT_IDS, { gdevelop: 79367, gdng: 948159 });
  assert.equal(assertProjectId(undefined, 79367, 'SOURCE_PROJECT_ID'), 79367);
  assert.equal(assertProjectId('948159', 948159, 'TARGET_PROJECT_ID'), 948159);
  assert.throws(() => assertProjectId('79367', 948159, 'TARGET_PROJECT_ID'), /GDevelop.*read-only|read-only.*GDevelop/i);
  assert.throws(() => assertGdngProjectId('79367'), /GDevelop.*read-only|read-only.*GDevelop/i);
  assert.throws(() => assertGdngProjectId(undefined), /positive integer/);
  assert.throws(() => assertGdngProjectId('948158'), /must identify GDNG/);
});

test('validates the actual remote Crowdin project identities before write operations', () => {
  assert.equal(assertGdngProject(gdng), gdng);
  assert.doesNotThrow(() => assertCrowdinProjectPair(gdevelop, gdng));
  assert.throws(() => assertGdngProject({ ...gdng, id: 79367 }), /identity mismatch/);
  assert.throws(() => assertGdngProject({ ...gdng, name: 'GDevelop 5' }), /unexpected name/);
  assert.throws(() => assertCrowdinProjectPair({ ...gdevelop, identifier: 'other' }, gdng), /unexpected identifier/);
});

test('maps the upstream Swahili dialect to GDNG and reports missing Rusyn', () => {
  const source = {
    targetLanguageIds: ['en', 'sw-KE', 'ry-UA'],
    targetLanguages: [
      { id: 'en', dialectOf: null },
      { id: 'sw-KE', dialectOf: 'sw' },
      { id: 'ry-UA', dialectOf: null },
    ],
  };
  const target = { targetLanguageIds: ['en', 'sw'] };
  assert.deepEqual(compareProjectLanguages(source, target), {
    sourceLanguageCount: 3,
    targetLanguageCount: 2,
    missingSourceLanguageIds: ['ry-UA'],
    dialectAliases: [{ sourceLanguageId: 'sw-KE', targetLanguageId: 'sw' }],
    targetOnlyLanguageIds: [],
  });
});

test('compares translation progress only for mapped languages', () => {
  const source = {
    targetLanguageIds: ['en', 'sw-KE', 'ry-UA'],
    targetLanguages: [
      { id: 'en', dialectOf: null },
      { id: 'sw-KE', dialectOf: 'sw' },
      { id: 'ry-UA', dialectOf: null },
    ],
  };
  const target = { targetLanguageIds: ['en', 'sw'] };
  const sourceRows = [
    { languageId: 'en', phrases: { translated: 10 } },
    { languageId: 'sw-KE', phrases: { translated: 2 } },
    { languageId: 'ry-UA', phrases: { translated: 19 } },
  ];
  const targetRows = [
    { languageId: 'en', phrases: { translated: 9 } },
    { languageId: 'sw', phrases: { translated: 2 } },
  ];
  assert.deepEqual(compareMappedTranslations(source, target, sourceRows, targetRows), {
    mappedLanguages: 2,
    sourceTranslated: 12,
    targetTranslated: 11,
    difference: 1,
  });
});

test('validates consistent source phrase totals and sums approved phrases', () => {
  assert.equal(getConsistentPhraseTotal([
    { phrases: { total: 123 } }, { phrases: { total: 123 } },
  ], 'catalog'), 123);
  assert.throws(() => getConsistentPhraseTotal([], 'empty'), /no language progress rows/);
  assert.throws(() => getConsistentPhraseTotal([
    { phrases: { total: 123 } }, { phrases: { total: 122 } },
  ], 'inconsistent'), /differ between languages/);
  assert.equal(sumPhraseMetric([
    { phrases: { approved: 4 } }, { phrases: { approved: 0 } }, { phrases: {} },
  ], 'approved'), 4);
});
