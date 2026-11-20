import assert from 'node:assert/strict';
import test from 'node:test';
import { countNonEmptyTranslations, countPoEntries, createCrowdinApi, mapConcurrent } from '../lib/crowdin-api.mjs';

test('counts translated singular and plural msgstr entries, including multiline values', () => {
  const po = [
    'msgid ""', 'msgstr ""', '"Content-Type: text/plain; charset=UTF-8\\n"', '',
    'msgid "one"', 'msgstr "un"', '',
    'msgid "two"', 'msgstr ""', '"deux"', '',
    'msgid "three"', 'msgstr ""', '',
    'msgid_plural "items"', 'msgstr[0] "article"', 'msgstr[1] "articles"',
  ].join('\n');
  assert.equal(countNonEmptyTranslations(po), 4);
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
