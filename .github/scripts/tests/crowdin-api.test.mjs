import assert from 'node:assert/strict';
import test from 'node:test';
import { countNonEmptyTranslations, countPoEntries, createCrowdinApi, getImportReportStats, mapConcurrent } from '../lib/crowdin-api.mjs';
import { buildMissingTranslationsPo, parsePoCatalog } from '../lib/po-catalog.mjs';

test('counts translated singular and plural msgstr entries, including multiline values', () => {
  const po = [
    'msgid ""', 'msgstr ""', '"Content-Type: text/plain; charset=UTF-8\\n"', '',
    'msgid "one"', 'msgstr "un"', '',
    'msgid "two"', 'msgstr ""', '"deux"', '',
    'msgid "three"', 'msgid_plural "items"',
    'msgstr[0] "article"', 'msgstr[1] "articles"',
  ].join('\n');
  assert.equal(countNonEmptyTranslations(po), 3);
});
test('counts entries without counting the PO header', () => {
  const po = ['msgid ""', 'msgstr ""', '', 'msgid "one"', 'msgstr "un"', '', 'msgid "two"', 'msgstr ""'].join('\n');
  assert.equal(countPoEntries(po), 2);
});
test('keeps worker concurrency bounded and processes all items', async () => {
  let active = 0;
  let maximum = 0;
  const processed = [];
  const errors = await mapConcurrent([1, 2, 3, 4, 5], 2, async value => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    processed.push(value);
    active -= 1;
  });
  assert.deepEqual(errors, []);
  assert.equal(maximum, 2);
  assert.equal(processed.length, 5);
});
test('collects failures and continues processing remaining items', async () => {
  const processed = [];
  const errors = await mapConcurrent([1, 2, 3], 2, async value => {
    processed.push(value);
    if (value === 2) throw new Error('expected failure');
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].item, 2);
  assert.equal(errors[0].error, 'expected failure');
  assert.equal(processed.length, 3);
});
test('retries transient API failures and supplies bearer authentication', async () => {
  let calls = 0;
  let authorization = '';
  const client = createCrowdinApi({
    token: 'test-token',
    fetchImpl: async (_url, options) => {
      calls += 1;
      authorization = options.headers.get('authorization');
      if (calls === 1) return new Response('{"error":{"message":"busy"}}', { status: 429, headers: { 'Retry-After': '0' } });
      return new Response('{"data":{"status":"ok"}}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    sleepImpl: async () => {},
  });
  const response = await client.request('projects/123');
  assert.equal(calls, 2);
  assert.equal(authorization, 'Bearer test-token');
  assert.equal(response.data.status, 'ok');
});

test('retries an explicitly rejected Crowdin 429 for a POST operation', async () => {
  let calls = 0;
  const client = createCrowdinApi({
    token: 'test-token',
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('{"error":{"message":"too many concurrent imports"}}', {
          status: 429,
          headers: { 'Retry-After': '0' },
        });
      }
      return new Response('{"data":{"identifier":"import-123"}}', {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    sleepImpl: async () => {},
  });

  const response = await client.request('projects/123/translations/imports', {
    method: 'POST',
    body: { storageId: 1 },
  });

  assert.equal(calls, 2);
  assert.equal(response.data.identifier, 'import-123');
});

test('does not retry ambiguous server failures for POST operations', async () => {
  let calls = 0;
  const client = createCrowdinApi({
    token: 'test-token',
    fetchImpl: async () => {
      calls += 1;
      return new Response('{"error":{"message":"temporary server error"}}', {
        status: 503,
      });
    },
    sleepImpl: async () => {},
  });

  await assert.rejects(
    client.request('projects/123/translations/imports', {
      method: 'POST',
      body: { storageId: 1 },
    }),
    /failed \(503\)/
  );
  assert.equal(calls, 1);
});


test('counts plural forms as one translated PO phrase', () => {
  const po = [
    'msgid "many"',
    'msgid_plural "many things"',
    'msgstr[0] "uno"',
    'msgstr[1] "varios"',
  ].join('\n');

  assert.equal(countNonEmptyTranslations(po), 1);
});

test('reads per-language and per-file import statistics from Crowdin', () => {
  const report = {
    data: {
      languages: [{
        id: 'ru',
        files: [{
          id: '4',
          statistics: { phrases: 6, words: 45 },
        }],
        skipped: { translation_eq_source: 2, hidden_strings: 0 },
      }],
    },
  };

  assert.deepEqual(getImportReportStats(report, 'ru', 4), {
    phrases: 6,
    words: 45,
    skipped: { translation_eq_source: 2, hidden_strings: 0 },
  });
});


test('matches source entries by gettext context, msgid and plural identity', () => {
  const sourcePo = [
    'msgid ""',
    'msgstr ""',
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '',
    '#: toolbar/open',
    'msgctxt "toolbar"',
    'msgid "Open"',
    'msgstr "Открыть"',
    '',
    'msgid "Draft"',
    'msgstr "Черновик"',
    '',
    'msgid "Save"',
    'msgstr "Сохранить"',
    '',
    'msgid "item"',
    'msgid_plural "items"',
    'msgstr[0] "предмет"',
    'msgstr[1] "предметы"',
    '',
    'msgid "Unmatched"',
    'msgstr "Нет пары"',
    '',
    'msgid "URL"',
    'msgstr "URL"',
  ].join('\n');

  const destinationPo = [
    'msgid ""',
    'msgstr ""',
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '',
    '#, fuzzy',
    '#: toolbar/open',
    'msgctxt "toolbar"',
    'msgid "Open"',
    'msgstr "Открыть вручную"',
    '',
    'msgid "Draft"',
    'msgstr "Существующий проверенный перевод"',
    '',
    'msgid "Save"',
    'msgstr ""',
    '',
    'msgid "item"',
    'msgid_plural "items"',
    'msgstr[0] ""',
    'msgstr[1] ""',
    '',
    'msgid "URL"',
    'msgstr "URL"',
  ].join('\n');

  const result = buildMissingTranslationsPo(sourcePo, destinationPo);
  assert.equal(result.sourceTranslated, 5);
  assert.equal(result.sourceEqualsSource, 1);
  assert.equal(result.matched, 4);
  assert.equal(result.alreadyTranslated, 2);
  assert.equal(result.unmatched, 1);
  assert.equal(result.deltaEntries, 2);
  assert.match(result.po, /msgid "Save"/);
  assert.match(result.po, /msgid "item"/);
  assert.doesNotMatch(result.po, /msgid "Open"/);
  assert.doesNotMatch(result.po, /msgid "Draft"/);
  assert.doesNotMatch(result.po, /msgid "Unmatched"/);
  assert.equal(countNonEmptyTranslations(result.po), 2);
});

test('decodes gettext octal escapes and joins multiline source/context strings before matching', () => {
  const sourcePo = [
    'msgid ""',
    'msgstr ""',
    '',
    'msgctxt "toolbar "',
    '"menu"',
    'msgid "Open "',
    '"file"',
    'msgstr "Открыть файл"',
    '',
    'msgctxt "ellipsis"',
    'msgid "\\342\\200\\246"',
    'msgstr "многоточие"',
  ].join('\n');
  const destinationPo = [
    'msgid ""',
    'msgstr ""',
    '',
    'msgctxt "toolbar menu"',
    'msgid "Open file"',
    'msgstr ""',
    '',
    'msgctxt "ellipsis"',
    'msgid "…" ',
    'msgstr ""',
  ].join('\n');

  const result = buildMissingTranslationsPo(sourcePo, destinationPo);
  assert.equal(result.deltaEntries, 2);
  assert.match(result.po, /msgstr "Открыть файл"/);
  assert.match(result.po, /msgstr "многоточие"/);
});
test('ignores obsolete PO entries and preserves the upstream header in a delta', () => {
  const sourcePo = [
    '# upstream header comment',
    'msgid ""',
    'msgstr ""',
    '"Project-Id-Version: upstream\\n"',
    '',
    '#~ msgid "Removed"',
    '#~ msgstr "Удалено"',
    '',
    'msgid "Added"',
    'msgstr "Добавлено"',
  ].join('\n');
  const destinationPo = [
    'msgid ""',
    'msgstr ""',
    '"Project-Id-Version: destination\\n"',
    '',
    '#~ msgid "Removed"',
    '#~ msgstr "Переведено"',
    '',
    'msgid "Added"',
    'msgstr ""',
  ].join('\n');

  const parsed = parsePoCatalog(sourcePo);
  const result = buildMissingTranslationsPo(sourcePo, destinationPo);
  assert.equal(parsed.entries.length, 1);
  assert.match(result.po, /Project-Id-Version: upstream/);
  assert.match(result.po, /msgid "Added"/);
  assert.doesNotMatch(result.po, /msgid "Removed"/);
});

test('fails closed on duplicate gettext identities instead of choosing an arbitrary translation', () => {
  const duplicateCatalog = [
    'msgid "Same"',
    'msgstr "Первый"',
    '',
    'msgid "Same"',
    'msgstr "Второй"',
  ].join('\n');

  assert.throws(() => parsePoCatalog(duplicateCatalog), /duplicate source identity/i);
});

test('fails closed on malformed PO source directives', () => {
  assert.throws(
    () => parsePoCatalog(['msgid "Valid"', 'unexpected "directive"'].join('\n')),
    /Unsupported PO syntax/
  );
});
