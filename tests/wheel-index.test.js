// Tests for the Wheel Reinvention Index aggregation + rendering.
// No network. Uses synthetic fixtures and a temp dir for loadResults.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { aggregateIndex, renderIndexMarkdown, loadResults } from '../scripts/wheel-index.js';

// Fixture A: scores expressed with explicit `rungCorrect` booleans.
// baseline correct on 1 of 4 → reinventionRate 0.75; enabled correct on 3 → delta +2.
const fixtureA = {
  meta: { model: 'tiny-a' },
  byCase: [
    { id: 'c1', expectedRung: 'built-in', baseline: { rungCorrect: false }, enabled: { rungCorrect: true } },
    { id: 'c2', expectedRung: 'native-platform', baseline: { rungCorrect: false }, enabled: { rungCorrect: true } },
    { id: 'c3', expectedRung: 'open-source', baseline: { rungCorrect: true }, enabled: { rungCorrect: true } },
    { id: 'c4', expectedRung: 'in-house', baseline: { rungCorrect: false }, enabled: { rungCorrect: false } }
  ]
};

// Fixture B: no boolean flags — correctness inferred from rung vs expectedRung.
// baseline correct on 3 of 4 → reinventionRate 0.25; enabled correct on 4 → delta +1.
const fixtureB = {
  meta: { model: 'tiny-b' },
  byCase: [
    { id: 'c1', expectedRung: 'built-in', baseline: { rung: 'built-in' }, enabled: { rung: 'built-in' } },
    { id: 'c2', expectedRung: 'native-platform', baseline: { rung: 'native-platform' }, enabled: { rung: 'native-platform' } },
    { id: 'c3', expectedRung: 'open-source', baseline: { rung: 'in-house' }, enabled: { rung: 'open-source' } },
    { id: 'c4', expectedRung: 'commercial', baseline: { rung: 'commercial' }, enabled: { rung: 'commercial' } }
  ]
};

test('aggregateIndex: computes scores, delta, reinventionRate and sorts by reinventionRate desc', () => {
  const agg = aggregateIndex([fixtureB, fixtureA]); // deliberately unsorted input
  assert.equal(agg.empty, false);
  assert.equal(agg.generatedFrom, 2);
  assert.equal(agg.rows.length, 2);

  // Sorted worst-first: tiny-a (0.75) before tiny-b (0.25).
  assert.deepEqual(agg.rows.map(r => r.model), ['tiny-a', 'tiny-b']);

  const a = agg.rows[0];
  assert.equal(a.model, 'tiny-a');
  assert.equal(a.cases, 4);
  assert.equal(a.maxScore, 4);
  assert.equal(a.baselineScore, 1);
  assert.equal(a.enabledScore, 3);
  assert.equal(a.delta, 2);
  assert.ok(Math.abs(a.reinventionRate - 0.75) < 1e-9);

  const b = agg.rows[1];
  assert.equal(b.model, 'tiny-b');
  assert.equal(b.baselineScore, 3);
  assert.equal(b.enabledScore, 4);
  assert.equal(b.delta, 1);
  assert.ok(Math.abs(b.reinventionRate - 0.25) < 1e-9);
});

test('aggregateIndex([]) → empty:true, no rows', () => {
  const agg = aggregateIndex([]);
  assert.equal(agg.empty, true);
  assert.equal(agg.generatedFrom, 0);
  assert.deepEqual(agg.rows, []);
});

test('aggregateIndex ignores invalid result objects (no byCase / empty byCase)', () => {
  const agg = aggregateIndex([null, {}, { meta: { model: 'x' }, byCase: [] }, 'nope']);
  assert.equal(agg.empty, true);
  assert.deepEqual(agg.rows, []);
});

test('renderIndexMarkdown(empty) says "No benchmark runs recorded" and prints NO percentages', () => {
  const md = renderIndexMarkdown(aggregateIndex([]), { asOf: '2026-07-12' });
  assert.match(md, /No benchmark runs recorded/);
  assert.match(md, /# Wheel Reinvention Index/);
  assert.match(md, /Reinvention rate/); // methodology still defines the term
  assert.equal(md.includes('%'), false); // no fabricated percentages
  assert.match(md, /_As of 2026-07-12\._/);
});

test('renderIndexMarkdown(non-empty) contains the model rows and real percentages', () => {
  const md = renderIndexMarkdown(aggregateIndex([fixtureA, fixtureB]), { asOf: '2026-07-12' });
  assert.match(md, /tiny-a/);
  assert.match(md, /tiny-b/);
  assert.match(md, /75\.0%/); // tiny-a reinvention rate
  assert.match(md, /25\.0%/); // tiny-b reinvention rate
  assert.match(md, /\+2/); // tiny-a delta rendered signed
  // tiny-a row appears before tiny-b row (sorted worst-first).
  assert.ok(md.indexOf('| tiny-a |') < md.indexOf('| tiny-b |'));
  assert.match(md, /Generated from 2 benchmark result file\(s\)/);
});

test('renderIndexMarkdown without asOf renders "unspecified" rather than a fabricated date', () => {
  const md = renderIndexMarkdown(aggregateIndex([]), {});
  assert.match(md, /_As of unspecified\._/);
});

test('loadResults: returns only the valid JSON, skips garbage and non-json, never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wheel-index-'));
  try {
    writeFileSync(join(dir, 'valid.json'), JSON.stringify(fixtureA));
    writeFileSync(join(dir, 'garbage.json'), '{ this is not valid json ,,,');
    writeFileSync(join(dir, 'notes.txt'), 'ignore me');

    const results = loadResults(dir);
    assert.equal(results.length, 1);
    assert.equal(results[0].meta.model, 'tiny-a');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadResults: missing directory yields [] (never throws)', () => {
  const results = loadResults(join(tmpdir(), 'wheel-index-does-not-exist-xyz'));
  assert.deepEqual(results, []);
});
