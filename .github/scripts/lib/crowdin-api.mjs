const DEFAULT_API_BASE_URL = 'https://api.crowdin.com/api/v2/';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function retryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : Math.max(0, timestamp - Date.now());
}
function parseBody(value) {
  if (!value) return {};
  try { return JSON.parse(value); } catch { return { raw: value.slice(0, 1000) }; }
}
export class CrowdinApiError extends Error {
  constructor(method, endpoint, status, payload) {
    super(method + ' ' + endpoint + ' failed (' + status + '): ' + JSON.stringify(payload).slice(0, 1600));
    this.name = 'CrowdinApiError';
    this.status = status;
    this.payload = payload;
  }
}
export function createCrowdinApi({
  token = process.env.CROWDIN_PERSONAL_TOKEN,
  baseUrl = process.env.CROWDIN_BASE_URL || DEFAULT_API_BASE_URL,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  maxRetries = 7,
  timeoutMs = 90_000,
} = {}) {
  if (!token) throw new Error('CROWDIN_PERSONAL_TOKEN is not configured.');
  if (typeof fetchImpl !== 'function') throw new Error('Node.js global fetch is required.');
  const apiBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  async function request(endpoint, { method = 'GET', body, headers: suppliedHeaders = {}, timeout = timeoutMs } = {}) {
    const url = new URL(endpoint.replace(/^\/+/, ''), apiBase);
    const headers = new Headers(suppliedHeaders);
    headers.set('Authorization', 'Bearer ' + token);
    headers.set('Accept', 'application/json');
    if (body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, {
          method, headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(timeout),
        });
      } catch (error) {
        if (attempt >= maxRetries) throw error;
        await sleepImpl(Math.min(30_000, 1_000 * (2 ** attempt)));
        continue;
      }
      const payload = parseBody(await response.text());
      if (response.ok) return payload;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= maxRetries) throw new CrowdinApiError(method, endpoint, response.status, payload);
      await sleepImpl(Math.max(retryAfterMs(response.headers.get('retry-after')), Math.min(30_000, 1_000 * (2 ** attempt))));
    }
    throw new Error('Crowdin API retry budget exhausted: ' + endpoint);
  }
  async function downloadText(url, { timeout = timeoutMs } = {}) {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response;
      try { response = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) }); }
      catch (error) {
        if (attempt >= maxRetries) throw error;
        await sleepImpl(Math.min(30_000, 1_000 * (2 ** attempt)));
        continue;
      }
      if (response.ok) return response.text();
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= maxRetries) throw new Error('Crowdin export download failed: HTTP ' + response.status);
      await sleepImpl(Math.max(retryAfterMs(response.headers.get('retry-after')), Math.min(30_000, 1_000 * (2 ** attempt))));
    }
    throw new Error('Crowdin download retry budget exhausted.');
  }
  async function uploadStorage(fileName, content) {
    const url = new URL('storages', apiBase);
    const headers = new Headers({
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'Content-Type': 'application/octet-stream',
      'Crowdin-API-FileName': encodeURIComponent(fileName),
    });
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST', headers, body: Buffer.from(content, 'utf8'),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (error) {
        if (attempt >= maxRetries) throw error;
        await sleepImpl(Math.min(30_000, 1_000 * (2 ** attempt)));
        continue;
      }
      const payload = parseBody(await response.text());
      if (response.ok) {
        if (!payload?.data?.id) throw new Error('Crowdin storage upload returned no storage id.');
        return payload.data.id;
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= maxRetries) throw new CrowdinApiError('POST', '/storages', response.status, payload);
      await sleepImpl(Math.max(retryAfterMs(response.headers.get('retry-after')), Math.min(30_000, 1_000 * (2 ** attempt))));
    }
    throw new Error('Crowdin storage upload retry budget exhausted.');
  }
  return { request, downloadText, uploadStorage };
}
export function unwrapList(response) {
  return (response?.data ?? []).map(item => item?.data ?? item);
}
export function countNonEmptyTranslations(po) {
  let count = 0;
  let active = false;
  let nonEmpty = false;
  let headerEntry = false;
  const quotedTextExists = value => {
    const match = value.trim().match(/^"(?:\\.|[^"\\])*"/);
    return Boolean(match && match[0] !== '""');
  };
  const finish = () => {
    if (active && !headerEntry && nonEmpty) count += 1;
    active = false;
    nonEmpty = false;
  };
  for (const line of po.split(/\r?\n/)) {
    const msgid = line.match(/^msgid\s+(.*)$/);
    if (msgid) {
      finish();
      headerEntry = msgid[1].trim() === '""';
      continue;
    }
    const msgstr = line.match(/^msgstr(?:\[\d+\])?\s+(.*)$/);
    if (msgstr) {
      finish();
      active = true;
      nonEmpty = !headerEntry && quotedTextExists(msgstr[1]);
      continue;
    }
    if (active && /^"/.test(line.trim())) {
      if (!headerEntry) nonEmpty ||= quotedTextExists(line.trim());
      continue;
    }
    if (active && (line.trim() === '' || /^(msgctxt|msgid_plural)\b/.test(line) || /^#/.test(line))) finish();
  }
  finish();
  return count;
}
export function countPoEntries(po) {
  const matches = po.match(/^msgid\s+"/gm) ?? [];
  return Math.max(0, matches.length - (/^msgid ""\s*$/m.test(po) ? 1 : 0));
}
export async function mapConcurrent(items, concurrency, worker) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Concurrency must be a positive integer.');
  let cursor = 0;
  const errors = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { await worker(items[index], index); }
      catch (error) { errors.push({ item: items[index], error: error instanceof Error ? error.message : String(error) }); }
    }
  }));
  return errors;
}
