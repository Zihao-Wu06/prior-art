// Regression tests for the findings from the 2026-07-09 cross-vendor code
// review. Each case cites the finding it pins down.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseArgv } from '../src/cli/index.js';
import { parseDecisionNote } from '../src/core/ladder.js';
import { recordEvent, summarize } from '../src/core/ledger.js';

test('parseArgv rejects value flags without a value (review #4)', () => {
  assert.throws(() => parseArgv(['report', 'left-pad', '--eco']));
  assert.throws(() => parseArgv(['adr', 'new', 't', '--rung', '--mode', 'adopt']));
});

test('parseArgv still parses valid flag/positional mixes', () => {
  const r = parseArgv(['report', 'zod', '--eco', 'npm', '--json']);
  assert.equal(r.command, 'report');
  assert.equal(r.opts.eco, 'npm');
  assert.equal(r.opts.json, true);
  assert.deepEqual(r.positionals, ['zod']);
});

test('importing the CLI module does not execute main (review #3)', () => {
  // Before the entrypoint guard, the import at the top of this file would
  // have run the CLI and printed usage; reaching this assertion is the check.
  assert.equal(typeof parseArgv, 'function');
});

test('parseDecisionNote rejects invalid modes (review #5)', () => {
  const note = 'Decision: use built-in: x [mode: explode]. Tradeoff: t. Rejected: r. Revisit if z.';
  assert.equal(parseDecisionNote(note), null);
  const ok = 'Decision: use built-in: x [mode: adopt]. Tradeoff: t. Rejected: r. Revisit if z.';
  assert.equal(parseDecisionNote(ok).mode, 'adopt');
});

test('recordEvent rejects non-finite amounts (review #6)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'priorart-ledger-'));
  assert.throws(() => recordEvent(dir, { type: 'lines-avoided', amount: Infinity }));
  assert.throws(() => recordEvent(dir, { type: 'lines-avoided', amount: Number('abc') }));
});

test('ledger writes atomically and round-trips (review #7)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'priorart-ledger-'));
  recordEvent(dir, { type: 'dep-averted', amount: 2, note: 'x' });
  recordEvent(dir, { type: 'lines-avoided', amount: 40 });
  const s = summarize(dir);
  assert.equal(s.count, 2);
  assert.equal(s.totals['dep-averted'], 2);
  assert.equal(s.totals['lines-avoided'], 40);
  assert.equal(existsSync(join(dir, '.prior-art', 'ledger.json.tmp')), false);
});
