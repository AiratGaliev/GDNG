import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMissingTranslationsPo,
  findMissingExpectedTranslationsPo,
  parsePoCatalog,
} from '../lib/po-catalog.mjs';

test('reports and excludes source plural entries with missing forms', () => {
  const sourcePo = [
    'msgid ""',
    'msgstr ""',
    '',
    'msgid "item"',
    'msgid_plural "items"',
    'msgstr[0] "предмет"',
    'msgstr[1] ""',
  ].join('\n');
  const destinationPo = [
    'msgid ""',
    'msgstr ""',
    '',
    'msgid "item"',
    'msgid_plural "items"',
    'msgstr[0] ""',
    'msgstr[1] ""',
  ].join('\n');

  const result = buildMissingTranslationsPo(sourcePo, destinationPo);
  assert.equal(result.sourcePartiallyTranslated, 1);
  assert.equal(result.deltaEntries, 0);
  assert.equal(parsePoCatalog(result.po).entries.length, 0);
});


test('detects a plural form omitted entirely from a catalog entry', () => {
  const sourcePo = [
    'msgid ""',
    'msgstr ""',
    '"Plural-Forms: nplurals=3; plural=(n != 1);\n"',
    '',
    'msgid "item"',
    'msgid_plural "items"',
    'msgstr[0] "предмет"',
    'msgstr[1] "предметы"',
  ].join('\n');
  const destinationPo = [
    'msgid ""',
    'msgstr ""',
    '"Plural-Forms: nplurals=3; plural=(n != 1);\n"',
    '',
    'msgid "item"',
    'msgid_plural "items"',
    'msgstr[0] ""',
    'msgstr[1] ""',
    'msgstr[2] ""',
  ].join('\n');

  const result = buildMissingTranslationsPo(sourcePo, destinationPo);
  assert.equal(result.sourcePartiallyTranslated, 1);
  assert.equal(result.deltaEntries, 0);
});

test('requires each imported singular/plural translation form to match exactly after import', () => {
  const expectedPo = [
    'msgid ""',
    'msgstr ""',
    '',
    'msgid "Save"',
    'msgstr "Сохранить"',
    '',
    'msgid "item"',
    'msgid_plural "items"',
    'msgstr[0] "предмет"',
    'msgstr[1] "предметы"',
    '',
    'msgid "URL"',
    'msgstr "URL"',
  ].join('\n');
  const exactPo = [
    'msgid ""',
    'msgstr ""',
    '',
    'msgid "Save"',
    'msgstr "Сохранить"',
    '',
    'msgid "item"',
    'msgid_plural "items"',
    'msgstr[0] "предмет"',
    'msgstr[1] "предметы"',
    '',
    'msgid "URL"',
    'msgstr "URL"',
  ].join('\n');
  const wrongPo = [
    'msgid ""',
    'msgstr ""',
    '',
    'msgid "Save"',
    'msgstr "Сохранить вручную"',
    '',
    'msgid "item"',
    'msgid_plural "items"',
    'msgstr[0] "предмет"',
    'msgstr[1] "товары"',
  ].join('\n');

  assert.deepEqual(findMissingExpectedTranslationsPo(expectedPo, exactPo), []);
  const missing = findMissingExpectedTranslationsPo(expectedPo, wrongPo);
  assert.equal(missing.length, 2);
  assert.equal(missing[0].expected, 'Сохранить');
  assert.equal(missing[1].expected, 'предметы');
});
