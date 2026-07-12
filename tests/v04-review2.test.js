// Regression tests for the second v0.4 adversarial review (2026-07-10):
// index honesty on errored runs (P0), the out-of-hunk dependency false
// negative (P1), isDocumented substring over-match (P2), and two low-severity
// grading/parsing tightenings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { aggregateIndex, renderIndexMarkdown, resultHasErrors } from '../scripts/wheel-index.js';
import { isDocumented, reconcileAddedDeps } from '../src/action/pr-review.js';
import { extractDecisionNote } from '../scripts/grade.js';
import { parseAddedDependencies } from '../src/action/diff.js';

// P0 — an errored run must never become a scored Index row.
test('v04r2-P0: index excludes errored runs, never publishes their zeros', () => {
  const errored = {
    model: 'broken-model', date: 'd',
    byCase: [{ id: 'a', baselineRungCorrect: false, enabledRungCorrect: false }],
    raw: [{ id: 'a', baselineError: 'claude: not found', enabledError: 'claude: not found' }]
  };
  assert.equal(resultHasErrors(errored), true);
  const agg = aggregateIndex([errored]);
  assert.equal(agg.empty, true, 'no rows from an errored run');
  assert.equal(agg.excludedErrored, 1);
  const md = renderIndexMarkdown(agg, { asOf: '2026-07-10' });
  assert.doesNotMatch(md, /100(\.0)?%/, 'must not print a fabricated reinvention rate');
  assert.doesNotMatch(md, /broken-model/, 'errored model must not appear as a ranked row');
  assert.match(md, /excluded because their agent\s+errored/i);

  // A clean run alongside it still scores.
  const clean = {
    model: 'good-model', date: 'd',
    byCase: [{ id: 'a', baselineRungCorrect: false, enabledRungCorrect: true }],
    raw: [{ id: 'a', baselineError: null, enabledError: null }]
  };
  const agg2 = aggregateIndex([errored, clean]);
  assert.equal(agg2.rows.length, 1);
  assert.equal(agg2.rows[0].model, 'good-model');
  assert.equal(agg2.excludedErrored, 1);
});

// P1 — a dependency added deep inside a large existing block, where the block
// opener is beyond the diff's context window, must still be flagged. Uses a
// hand-crafted opener-less diff + a real on-disk manifest so the scenario is
// deterministic (not dependent on git's context-line count).
test('v04r2-P1: out-of-hunk dependency addition is caught by reconciliation', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pa-oohunk-'));
  const real = {
    name: 'demo',
    dependencies: { aaa: '^1', bbb: '^1', ccc: '^1', ddd: '^1', lodash: '^4.17.21', eee: '^1', fff: '^1' }
  };
  writeFileSync(join(repo, 'package.json'), JSON.stringify(real, null, 2) + '\n');

  // A diff whose hunk does NOT contain the `"dependencies": {` opener.
  const diff = [
    'diff --git a/package.json b/package.json',
    '--- a/package.json',
    '+++ b/package.json',
    '@@ -6,6 +6,7 @@',
    '     "ccc": "^1",',
    '     "ddd": "^1",',
    '+    "lodash": "^4.17.21",',
    '     "eee": "^1",',
    '     "fff": "^1"'
  ].join('\n');

  // Pure parser misses it (no opener in the diff)...
  assert.equal(parseAddedDependencies(diff).some(d => d.name === 'lodash'), false);
  // ...reconciliation against the real manifest catches it.
  const reconciled = reconcileAddedDeps(diff, repo);
  const lodash = reconciled.find(d => d.name === 'lodash');
  assert.ok(lodash, 'lodash must be flagged as a new dependency');
  assert.equal(lodash.ecosystem, 'npm');
  // Untouched deps are not falsely flagged.
  assert.equal(reconciled.some(d => d.name === 'ccc'), false);
});

// P1b — a version bump (remove old line + add new line, same name) is not a
// "new dependency".
test('v04r2-P1b: a version bump is not reported as a new dependency', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pa-bump-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t.t'); git('config', 'user.name', 't');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'd', dependencies: { zod: '^3.0.0' } }, null, 2) + '\n');
  git('add', '-A'); git('commit', '-qm', 'base');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'd', dependencies: { zod: '^3.24.0' } }, null, 2) + '\n');
  const diff = git('diff');
  assert.equal(reconcileAddedDeps(diff, repo).some(d => d.name === 'zod'), false);
});

// P2 — a dependency name that is only a substring of another word is NOT
// documented; a real whole-word mention near a decision keyword is.
test('v04r2-P2: isDocumented requires whole-token match', () => {
  assert.equal(isDocumented({ name: 'ms' }, 'This PR builds the new terms-of-service page.'), false);
  assert.equal(isDocumented({ name: 'in' }, 'Run npm install then build the project.'), false);
  assert.equal(isDocumented({ name: 'chalk' }, 'chalk rebuilds the ANSI colors.'), false, 'build must be a whole word');
  assert.equal(isDocumented({ name: 'lodash' }, 'Decision: reuse lodash for deep clone.'), true);
  assert.equal(isDocumented({ name: '@scope/pkg' }, 'We build on @scope/pkg deliberately.'), true);
});

// Low — the loose grade fallback needs a real decision cue, not a casual "use".
test('v04r2-low: loose grade fallback requires a decision cue', () => {
  assert.equal(extractDecisionNote('we can use in-house tooling for logging'), null);
  const withCue = extractDecisionNote('Decision: we use built-in crypto here.');
  assert.ok(withCue && withCue.rung === 'built-in');
});

// Low — a bare URL / VCS requirement line is not parsed as a named dependency.
test('v04r2-low: requirements URL/VCS lines are not flagged as deps', () => {
  const diff = [
    'diff --git a/requirements.txt b/requirements.txt',
    '--- a/requirements.txt',
    '+++ b/requirements.txt',
    '@@ -1,1 +1,3 @@',
    ' flask==2.0',
    '+https://example.com/pkg-1.0.tar.gz',
    '+git+https://github.com/x/y.git'
  ].join('\n');
  const names = parseAddedDependencies(diff).map(d => d.name);
  assert.ok(!names.some(n => n.includes('http')), 'no URL should become a dep name');
});
