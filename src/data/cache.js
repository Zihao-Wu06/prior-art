// On-disk TTL cache for outbound JSON fetches, so repeated lookups (and
// repeated test/dev runs) don't hammer deps.dev/OSV/npm. Cache writes are
// best-effort: a cache failure must never break the underlying fetch.

import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const CACHE_DIR = join(homedir(), '.cache', 'priorart', 'http');

// 404s get a short negative TTL: a package published minutes ago must not
// stay "not found" for a full day just because we asked too early.
const NEGATIVE_TTL_MS = 300000;

function cacheFile(method, url, body) {
  const key = createHash('sha256').update(`${method} ${url} ${body || ''}`).digest('hex').slice(0, 32);
  return join(CACHE_DIR, `${key}.json`);
}

function readEntry(file) {
  try {
    if (!existsSync(file)) return null;
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    return entry && typeof entry.fetchedAt === 'number' ? entry : null;
  } catch {
    return null;
  }
}

function writeEntry(file, entry) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(entry));
  } catch {
    // best-effort: caching must never break the caller's fetch
  }
}

/**
 * Fetch JSON with an on-disk TTL cache.
 * @param {string} url
 * @param {{ttlMs?: number, fresh?: boolean, method?: string, body?: any, headers?: Record<string,string>}} [opts]
 * @returns {Promise<{status: number, data: any, fromCache: boolean}>}
 */
export async function cachedFetchJson(url, { ttlMs = 86400000, fresh = false, method = 'GET', body, headers } = {}) {
  const bodyStr = body === undefined ? undefined : JSON.stringify(body);
  const file = cacheFile(method, url, bodyStr);

  if (!fresh) {
    const cached = readEntry(file);
    const effectiveTtl = cached && cached.status === 404 ? Math.min(ttlMs, NEGATIVE_TTL_MS) : ttlMs;
    if (cached && Date.now() - cached.fetchedAt < effectiveTtl) {
      return { status: cached.status, data: cached.data, fromCache: true };
    }
  }

  const fetchHeaders = { 'User-Agent': 'priorart-cli', ...headers };
  if (bodyStr !== undefined) fetchHeaders['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, { method, headers: fetchHeaders, body: bodyStr });
  } catch (err) {
    throw new Error(`${method} ${url} -> ${err.message}`, { cause: err });
  }

  if (res.status === 404) {
    const entry = { fetchedAt: Date.now(), status: 404, data: null };
    writeEntry(file, entry);
    return { status: 404, data: null, fromCache: false };
  }

  if (res.status >= 200 && res.status < 300) {
    const data = await res.json();
    writeEntry(file, { fetchedAt: Date.now(), status: res.status, data });
    return { status: res.status, data, fromCache: false };
  }

  throw new Error(`${method} ${url} -> HTTP ${res.status}`);
}
