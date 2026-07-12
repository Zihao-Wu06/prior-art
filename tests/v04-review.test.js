// Regression tests for the v0.4 adversarial-review findings (2026-07-10):
// the benchmark→index schema mismatch (P0), all-errored-run honesty (P1),
// and the action CLI entrypoint guard (P2).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatDecisionNote } from '../src/core/ladder.js';
import { runBenchmark, renderReport, erroredCount } from '../scripts/benchmark.js';
import { aggregateIndex } from '../scripts/wheel-index.js';

// P0 — end-to-end: the exact object benchmark.js persists must score correctly
// in wheel-index.js. Before the fix, the field-name mismatch made every real
// run resolve to `unknown | 0/0 | reinventionRate 1.0`.
test('v04-P0: benchmark output flows into the index with real numbers', async () => {
  const cases = [
    { id: 'a', prompt: 'add a unique id helper', expectedRung: 'built-in', expectedMode: 'adopt' },
    { id: 'b', prompt: 'add password reset email', expectedRung: 'commercial', expectedMode: 'adopt' }
  ];
  // Baseline (no gate) answers vaguely → wrong rung; enabled (gate prepended)
  // emits a correct decision note → right rung.
  const fakeAgent = async prompt => {
    if (!prompt.includes('GATE-ON')) return 'I will just write it myself.';
    const c = cases.find(x => prompt.includes(x.prompt));
    return formatDecisionNote({
      rung: c.expectedRung, option: 'the right thing', mode: c.expectedMode,
      tradeoff: 'less to own', rejected: 'in-house because reuse fits', revisit: 'needs change'
    });
  };

  const agg = await runBenchmark(cases, { agent: fakeAgent, gate: 'GATE-ON' });
  assert.ok(agg.enabledTotal > agg.baselineTotal, 'gate should lift the score');

  // Mirror exactly what benchmark.js cli() writes, through a JSON round-trip.
  const persisted = JSON.parse(JSON.stringify({ model: 'claude-test', date: '2026-07-10', ...agg }));
  const index = aggregateIndex([persisted]);

  assert.equal(index.empty, false);
  assert.equal(index.rows.length, 1);
  const row = index.rows[0];
  assert.equal(row.model, 'claude-test', 'model must resolve from top-level, not stay "unknown"');
  assert.equal(row.cases, 2);
  assert.equal(row.enabledScore, 2, 'gate-enabled got both rungs right');
  assert.equal(row.baselineScore, 0, 'baseline missed both');
  assert.equal(row.reinventionRate, 1, 'baseline reinvented every case');
  assert.ok(row.delta > 0);
});

// P1 — an all-errored run must not masquerade as a real all-zero measurement.
test('v04-P1: renderReport warns loudly when agent calls errored', async () => {
  const throwingAgent = async () => { throw new Error('claude: command not found'); };
  const agg = await runBenchmark(
    [{ id: 'a', prompt: 'p', expectedRung: 'built-in', expectedMode: 'adopt' }],
    { agent: throwingAgent, gate: 'g' }
  );
  assert.equal(erroredCount(agg), 1);
  const md = renderReport(agg, { model: 'claude-test', date: '2026-07-10' });
  assert.match(md, /WARNING:.*agent error/i);
  assert.match(md, /NOT a valid measurement/i);

  // A clean run carries no such warning.
  const okAgg = await runBenchmark(
    [{ id: 'a', prompt: 'p', expectedRung: 'built-in', expectedMode: 'adopt' }],
    { agent: async () => 'anything', gate: 'g' }
  );
  assert.equal(erroredCount(okAgg), 0);
  assert.doesNotMatch(renderReport(okAgg, { model: 'm', date: 'd' }), /WARNING/);
});

// P2 — importing the action CLI must have no side effects (no env read, no
// summary write, no process.exit). We assert the import resolves and control
// returns to us.
test('v04-P2: importing action/cli.js does not execute the CLI', async () => {
  const mod = await import('../src/action/cli.js');
  assert.ok(mod, 'import resolved without the CLI terminating the process');
});
