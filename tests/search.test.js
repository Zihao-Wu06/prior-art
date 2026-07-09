// Search-channel tests: pure helpers only (no network). The live pipeline is
// smoke-tested manually / in release checks, not in the unit suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildGitHubSearchUrl, normalizeGitHubResults, sanitizeNeed } from '../src/search/github.js';
import { cacheFile } from '../src/data/cache.js';
import { buildNpmSearchUrl, normalizeNpmResults, normalizeCratesResults, searchRegistry } from '../src/search/registries.js';
import { tokenizeNeed, searchRepo } from '../src/search/local.js';

test('github: search URL encodes the need and applies the limit', () => {
  const url = buildGitHubSearchUrl('retry with backoff & jitter', 5);
  assert.match(url, /per_page=5/);
  assert.match(url, /retry%20with%20backoff%20%26%20jitter/);
  assert.match(url, /sort=stars/);
});

test('github: qualifier syntax is neutralized, never forwarded (review: injection)', () => {
  assert.equal(sanitizeNeed('retry backoff user:no-such-user'), 'retry backoff user no-such-user');
  assert.equal(sanitizeNeed('http "client" stars:>100 language:go'), 'http client stars 100 language go');
  const url = buildGitHubSearchUrl('retry user:evil', 5);
  assert.ok(!url.includes('%3A'), 'no encoded colon may reach GitHub');
});

test('cache: auth mode partitions the cache key (review: token replay)', () => {
  const anon = cacheFile('GET', 'https://api.github.com/x', undefined, 'gh-anon');
  const auth = cacheFile('GET', 'https://api.github.com/x', undefined, 'gh-auth');
  const bare = cacheFile('GET', 'https://api.github.com/x', undefined, undefined);
  assert.notEqual(anon, auth);
  assert.notEqual(anon, bare);
});

test('github: results normalize with license/archived handling', () => {
  const rows = normalizeGitHubResults({
    total_count: 2,
    items: [
      { full_name: 'a/p-retry', stargazers_count: 4200, description: 'Retry', pushed_at: '2026-05-01T00:00:00Z', license: { spdx_id: 'MIT' }, archived: false, html_url: 'u1' },
      { full_name: 'b/old', stargazers_count: 10, description: null, pushed_at: null, license: { spdx_id: 'NOASSERTION' }, archived: true, html_url: 'u2' }
    ]
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].license, 'MIT');
  assert.equal(rows[0].updatedAt, '2026-05-01');
  assert.equal(rows[1].license, null);
  assert.equal(rows[1].archived, true);
  assert.deepEqual(normalizeGitHubResults(null), []);
});

test('npm: results normalize name/score/date', () => {
  const rows = normalizeNpmResults({
    objects: [
      { package: { name: 'p-retry', version: '6.0.0', description: 'Retry', date: '2026-01-02T03:04:05Z', links: { repository: 'r' } }, score: { final: 0.9234 } },
      { package: null, score: null }
    ]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].signal, 'score 0.9');
  assert.equal(rows[0].updatedAt, '2026-01-02');
});

test('crates: results normalize with downloads as the signal', () => {
  const rows = normalizeCratesResults({ crates: [{ name: 'backoff', max_version: '0.4.0', description: 'd', downloads: 123456, updated_at: '2025-12-01T00:00:00Z' }] });
  assert.equal(rows[0].signal, '123,456 dl');
  assert.equal(rows[0].url, 'https://crates.io/crates/backoff');
});

test('registry: pypi and unknown ecosystems degrade to honest skips', async () => {
  const pypi = await searchRegistry('pypi', 'retry');
  assert.equal(pypi.status, 'skipped');
  assert.match(pypi.reason, /no keyless search API/);
  const go = await searchRegistry('go', 'retry');
  assert.equal(go.status, 'skipped');
});

test('local: tokenize drops stopwords and short tokens', () => {
  assert.deepEqual(tokenizeNeed('I need a retry with exponential backoff'), ['retry', 'exponential', 'backoff']);
  assert.deepEqual(tokenizeNeed('a an I'), []);
});

test('local: finds related definition lines in the repo, caps hits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-local-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'net.js'),
    'export function retryWithBackoff(fn) {\n  return fn();\n}\nconst x = 1;\n');
  writeFileSync(join(dir, 'src', 'other.js'), 'export function unrelatedThing() {}\n');
  const out = searchRepo(dir, 'retry with exponential backoff');
  assert.equal(out.status, 'ok');
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].file, 'src/net.js');
  assert.equal(out.results[0].line, 1);

  const none = searchRepo(dir, 'graphql subscription server');
  assert.equal(none.results.length, 0);

  const empty = searchRepo(dir, 'a an');
  assert.equal(empty.status, 'skipped');
});
