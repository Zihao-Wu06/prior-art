import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDecisionNote } from '../src/core/ladder.js';
import { extractDecisionNote, gradeOutput, aggregate } from '../scripts/grade.js';
import { runBenchmark, renderReport } from '../scripts/benchmark.js';
import { runGateCheck } from '../scripts/benchmark-gate.js';

// --- extractDecisionNote -----------------------------------------------------

test('extractDecisionNote round-trips a formatDecisionNote string (strict)', () => {
  const decision = {
    rung: 'existing-solution',
    option: 'acme-starter-template',
    mode: 'adopt',
    tradeoff: 'saves two weeks of setup',
    rejected: 'greenfielding the scaffold',
    revisit: 'requirements diverge from the template'
  };
  const note = formatDecisionNote(decision);
  const extracted = extractDecisionNote(`Here is my plan.\n${note}\nThanks.`);
  assert.deepEqual(extracted, decision);
});

test('extractDecisionNote falls back to a loose `use <rung>` match', () => {
  const out = "I'll use open-source here (mode: adopt) since a mature retry lib fits.";
  const extracted = extractDecisionNote(out);
  assert.equal(extracted.rung, 'open-source');
  assert.equal(extracted.mode, 'adopt');
  assert.equal(extracted._looseMatch, true);
});

test('extractDecisionNote loose match ignores an invalid mode', () => {
  const extracted = extractDecisionNote('We should use built-in for this (mode: bogus).');
  assert.equal(extracted.rung, 'built-in');
  assert.equal(extracted.mode, null);
  assert.equal(extracted._looseMatch, true);
});

test('extractDecisionNote returns null when nothing matches', () => {
  assert.equal(extractDecisionNote('Totally unrelated text with no rung.'), null);
  assert.equal(extractDecisionNote(''), null);
  assert.equal(extractDecisionNote(null), null);
  assert.equal(extractDecisionNote(undefined), null);
  // "use whatever" is not a valid rung id.
  assert.equal(extractDecisionNote('Just use whatever you like.'), null);
});

// --- gradeOutput (all four scoring cases) -----------------------------------

test('gradeOutput: full credit (parsed + rung + mode) = 4', () => {
  const note = formatDecisionNote({
    rung: 'built-in', option: 'crypto.randomUUID', mode: 'adopt',
    tradeoff: 'zero deps', rejected: 'uuid', revisit: 'need v5'
  });
  const g = gradeOutput(note, { expectedRung: 'built-in', expectedMode: 'adopt' });
  assert.deepEqual(
    { parsed: g.parsed, rungCorrect: g.rungCorrect, modeCorrect: g.modeCorrect, score: g.score },
    { parsed: true, rungCorrect: true, modeCorrect: true, score: 4 }
  );
});

test('gradeOutput: correct rung, wrong mode = 3 (partial)', () => {
  const note = formatDecisionNote({
    rung: 'built-in', option: 'crypto.randomUUID', mode: 'build',
    tradeoff: 'zero deps', rejected: 'uuid', revisit: 'need v5'
  });
  const g = gradeOutput(note, { expectedRung: 'built-in', expectedMode: 'adopt' });
  assert.equal(g.parsed, true);
  assert.equal(g.rungCorrect, true);
  assert.equal(g.modeCorrect, false);
  assert.equal(g.score, 3);
});

test('gradeOutput: wrong rung, correct mode = 2 (partial)', () => {
  const note = formatDecisionNote({
    rung: 'in-house', option: 'hand-rolled', mode: 'adopt',
    tradeoff: 'x', rejected: 'y', revisit: 'z'
  });
  const g = gradeOutput(note, { expectedRung: 'built-in', expectedMode: 'adopt' });
  assert.equal(g.parsed, true);
  assert.equal(g.rungCorrect, false);
  assert.equal(g.modeCorrect, true);
  assert.equal(g.score, 2);
});

test('gradeOutput: empty/garbage output = 0, never throws', () => {
  const g = gradeOutput('', { expectedRung: 'built-in', expectedMode: 'adopt' });
  assert.deepEqual(
    { parsed: g.parsed, rungCorrect: g.rungCorrect, modeCorrect: g.modeCorrect, score: g.score, note: g.note },
    { parsed: false, rungCorrect: false, modeCorrect: false, score: 0, note: null }
  );
  assert.doesNotThrow(() => gradeOutput(null, {}));
});

test('gradeOutput: loose match still earns rung + mode credit', () => {
  const g = gradeOutput('Plan: use native-platform (mode: adopt).', {
    expectedRung: 'native-platform', expectedMode: 'adopt'
  });
  assert.equal(g.parsed, true);
  assert.equal(g.rungCorrect, true);
  assert.equal(g.modeCorrect, true);
  assert.equal(g.score, 4);
});

// --- aggregate ---------------------------------------------------------------

test('aggregate computes totals, delta, rung hits, and per-case deltas', () => {
  const perCase = [
    { id: 'a', baseline: { score: 0, rungCorrect: false }, enabled: { score: 4, rungCorrect: true, modeCorrect: true } },
    { id: 'b', baseline: { score: 2, rungCorrect: true }, enabled: { score: 3, rungCorrect: true, modeCorrect: false } }
  ];
  const agg = aggregate(perCase);
  assert.equal(agg.n, 2);
  assert.equal(agg.baselineTotal, 2);
  assert.equal(agg.enabledTotal, 7);
  assert.equal(agg.maxTotal, 8);
  assert.equal(agg.delta, 5);
  assert.equal(agg.rungHitsBaseline, 1);
  assert.equal(agg.rungHitsEnabled, 2);
  assert.equal(agg.byCase.length, 2);
  assert.equal(agg.byCase[0].delta, 4);
  assert.equal(agg.byCase[1].delta, 1);
});

test('aggregate tolerates an empty / non-array input', () => {
  const agg = aggregate();
  assert.deepEqual(
    { n: agg.n, baselineTotal: agg.baselineTotal, enabledTotal: agg.enabledTotal, maxTotal: agg.maxTotal, delta: agg.delta },
    { n: 0, baselineTotal: 0, enabledTotal: 0, maxTotal: 0, delta: 0 }
  );
});

// --- runBenchmark (injected FAKE agent) -------------------------------------

const GATE = 'REUSE-LADDER-GATE-MARKER';
const TEST_CASES = [
  { id: 'a', prompt: 'Add a UUID helper for uploads.', expectedRung: 'built-in', expectedMode: 'adopt' },
  { id: 'b', prompt: 'Add a copy-to-clipboard button.', expectedRung: 'native-platform', expectedMode: 'adopt' }
];

function strongEnabledAgent(prompt) {
  const enabled = prompt.includes(GATE);
  if (!enabled) return Promise.resolve('Sure, here is a quick implementation with a new dependency.');
  const c = TEST_CASES.find(x => prompt.includes(x.prompt));
  return Promise.resolve(formatDecisionNote({
    rung: c.expectedRung, option: 'x', mode: c.expectedMode,
    tradeoff: 't', rejected: 'r', revisit: 'v'
  }));
}

test('runBenchmark: gate lifts the score (delta > 0) with an injected agent', async () => {
  const agg = await runBenchmark(TEST_CASES, { agent: strongEnabledAgent, gate: GATE });
  assert.equal(agg.n, 2);
  assert.equal(agg.baselineTotal, 0);
  assert.equal(agg.enabledTotal, 8);
  assert.ok(agg.delta > 0, `expected positive delta, got ${agg.delta}`);
  assert.equal(agg.rungHitsEnabled, 2);
  assert.equal(agg.rungHitsBaseline, 0);
  assert.equal(agg.raw.length, 2);
});

test('runBenchmark: survives an agent that throws on one case', async () => {
  const throwingAgent = (prompt) => {
    // Blow up on case b's enabled call specifically.
    if (prompt.includes(GATE) && prompt.includes('copy-to-clipboard')) {
      throw new Error('boom');
    }
    return strongEnabledAgent(prompt);
  };
  const agg = await runBenchmark(TEST_CASES, { agent: throwingAgent, gate: GATE });
  assert.equal(agg.n, 2);
  // Case a still lifts, so the run completes and delta stays positive.
  assert.ok(agg.delta > 0, `expected positive delta despite a throw, got ${agg.delta}`);
  const caseB = agg.raw.find(r => r.id === 'b');
  assert.equal(caseB.enabledError, 'boom');
});

test('runBenchmark: requires an injected agent', async () => {
  await assert.rejects(() => runBenchmark(TEST_CASES, {}), /injected async `agent`/);
});

// --- renderReport ------------------------------------------------------------

test('renderReport includes the SYNTHETIC banner when meta.synthetic', () => {
  const agg = aggregate([{ id: 'x', baseline: { score: 0 }, enabled: { score: 4, rungCorrect: true } }]);
  const md = renderReport(agg, { synthetic: true, model: 'FAKE', date: '2026-07-12T00:00:00.000Z' });
  assert.match(md, /\*\*SYNTHETIC — not a measurement of any real model\.\*\*/);
  assert.match(md, /Provenance:.*FAKE/);
  assert.match(md, /Totals:/);
});

test('renderReport omits the banner and states provenance on a real run', () => {
  const agg = aggregate([{ id: 'x', baseline: { score: 0 }, enabled: { score: 4 } }]);
  const md = renderReport(agg, { synthetic: false, model: 'claude-opus-4-8', date: '2026-07-12T00:00:00.000Z' });
  assert.doesNotMatch(md, /SYNTHETIC/);
  assert.match(md, /Provenance: agent\/model = `claude-opus-4-8`/);
});

// --- runGateCheck (the honest regression) -----------------------------------

test('runGateCheck: the grading pipeline discriminates (ok:true)', () => {
  const r = runGateCheck();
  assert.equal(r.ok, true);
  assert.equal(r.detail.baselineTotal, 0);
  assert.equal(r.detail.rungHitsBaseline, 0);
  assert.equal(r.detail.rungHitsEnabled, r.detail.n);
  assert.ok(r.detail.enabledTotal > r.detail.baselineTotal + r.detail.margin);
});
