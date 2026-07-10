// Regression tests for the third full review (2026-07-10): SPDX expression
// handling, engines semver floors, ledger corruption/concurrency, cache
// permissions, config fail-visible behavior, and CJK inputs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyLicense, deriveFlags } from '../src/data/assess.js';
import { enginesFloor, buildInventory } from '../src/audit/inventory.js';
import { recordEvent, summarize } from '../src/core/ledger.js';
import { tokenizeNeed } from '../src/search/local.js';
import { parseArgv } from '../src/cli/index.js';

test('spdx: OR lets the consumer choose the permissive side', () => {
  assert.equal(classifyLicense('MIT OR GPL-3.0'), 'permissive');
  assert.equal(classifyLicense('(MIT OR Apache-2.0)'), 'permissive');
  assert.equal(classifyLicense('GPL-3.0 OR AGPL-3.0'), 'strong-copyleft');
});

test('spdx: AND imposes the most restrictive side', () => {
  assert.equal(classifyLicense('LGPL-2.1 AND GPL-2.0'), 'strong-copyleft');
  assert.equal(classifyLicense('MIT AND CC0-1.0'), 'permissive');
  assert.equal(classifyLicense('MIT AND SomeCustomLicense'), 'unknown');
});

test('spdx: UNLICENSED is proprietary, The Unlicense is permissive', () => {
  assert.equal(classifyLicense('UNLICENSED'), 'proprietary');
  assert.equal(classifyLicense('Unlicense'), 'permissive');
  assert.equal(classifyLicense('GPL-2.0-with-classpath-exception'), 'strong-copyleft');
  const flags = deriveFlags({ license: 'UNLICENSED' }, 'MIT');
  assert.ok(flags.some(f => f.code === 'proprietary-license'));
});

test('engines: floor of an OR range is the lowest branch floor', () => {
  assert.equal(enginesFloor('>=22 <23 || >=20 <21'), '20');
  assert.equal(enginesFloor('>=16.14 <21'), '16.14');
  assert.equal(enginesFloor('^18.2.0'), '18.2.0');
  assert.equal(enginesFloor('>=20'), '20');
  assert.equal(enginesFloor('*'), null);
  assert.equal(enginesFloor('>=20 || *'), null);
});

test('ledger: a corrupt file is backed up, never silently wiped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-ledger3-'));
  mkdirSync(join(dir, '.prior-art'), { recursive: true });
  const file = join(dir, '.prior-art', 'ledger.json');
  writeFileSync(file, '{ definitely not json');

  const before = summarize(dir);
  assert.equal(before.corrupt, true);

  const event = recordEvent(dir, { type: 'wheel-found', amount: 1, note: 'x' });
  assert.ok(event._recoveredFrom, 'recovery path should be reported');
  assert.match(readFileSync(event._recoveredFrom, 'utf8'), /definitely not json/);

  const after = summarize(dir);
  assert.equal(after.count, 1);
  assert.equal(after.corrupt, false);
  const backups = readdirSync(join(dir, '.prior-art')).filter(f => f.includes('.corrupt-'));
  assert.equal(backups.length, 1);
});

test('inventory: workspaces mark the project as a monorepo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-mono-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'], dependencies: {} }));
  assert.equal(buildInventory(dir).monorepo, true);
  const plain = mkdtempSync(join(tmpdir(), 'pa-mono-'));
  writeFileSync(join(plain, 'package.json'), JSON.stringify({ dependencies: {} }));
  assert.equal(buildInventory(plain).monorepo, false);
});

test('search: CJK needs produce usable tokens', () => {
  const tokens = tokenizeNeed('重试机制 with backoff');
  assert.ok(tokens.includes('重试机制'));
  assert.ok(tokens.includes('backoff'));
});

test('cli: --require-complete parses as a boolean report option', () => {
  const r = parseArgv(['report', 'zod', '--require-complete']);
  assert.equal(r.opts.requireComplete, true);
  assert.deepEqual(r.positionals, ['zod']);
});
