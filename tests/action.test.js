// GitHub Action / PR-review tests. Pure parsers and renderers are unit-tested
// directly; run() is driven with a FAKE injected audit so there is no network,
// no git, and no child process. Synthetic diffs are labeled as such.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAddedDependencies,
  collectChangedSourceFiles,
  extractAddedLines
} from '../src/action/diff.js';
import { renderSummary, decideExit } from '../src/action/render.js';
import { run, isDocumented } from '../src/action/pr-review.js';

// ── parseAddedDependencies ───────────────────────────────────────────────────

test('parseAddedDependencies: package.json additions inside a dependencies block', () => {
  const diff = [
    'diff --git a/package.json b/package.json',
    '--- a/package.json',
    '+++ b/package.json',
    '@@ -3,6 +3,8 @@',
    '   "dependencies": {',
    '     "express": "^4.18.0",',
    '+    "lodash": "^4.17.21",',
    '+    "zod": "^3.22.0"',
    '   }'
  ].join('\n');
  const deps = parseAddedDependencies(diff);
  assert.deepEqual(deps, [
    { ecosystem: 'npm', name: 'lodash', version: '^4.17.21', manifest: 'package.json' },
    { ecosystem: 'npm', name: 'zod', version: '^3.22.0', manifest: 'package.json' }
  ]);
});

test('parseAddedDependencies: package.json edits outside a deps block are ignored', () => {
  const diff = [
    '+++ b/package.json',
    '@@',
    '   "scripts": {',
    '+    "build": "webpack"',
    '   }'
  ].join('\n');
  assert.deepEqual(parseAddedDependencies(diff), []);
});

test('parseAddedDependencies: requirements.txt additions', () => {
  const diff = [
    '+++ b/requirements.txt',
    '@@ -1,2 +1,4 @@',
    ' flask==2.0.0',
    '+requests==2.31.0',
    '+tenacity>=8.0',
    '+# a comment',
    '+-r other.txt'
  ].join('\n');
  assert.deepEqual(parseAddedDependencies(diff), [
    { ecosystem: 'pypi', name: 'requests', version: '2.31.0', manifest: 'requirements.txt' },
    { ecosystem: 'pypi', name: 'tenacity', version: null, manifest: 'requirements.txt' }
  ]);
});

test('parseAddedDependencies: mixed manifests in one diff', () => {
  const diff = [
    '+++ b/package.json',
    '   "dependencies": {',
    '+    "chalk": "^5.3.0"',
    '   }',
    'diff --git a/go.mod b/go.mod',
    '+++ b/go.mod',
    '@@',
    ' require (',
    '+\tgithub.com/pkg/errors v0.9.1',
    ' )',
    '+++ b/Cargo.toml',
    '@@',
    ' [dependencies]',
    '+serde = "1.0"'
  ].join('\n');
  const deps = parseAddedDependencies(diff);
  assert.deepEqual(deps, [
    { ecosystem: 'npm', name: 'chalk', version: '^5.3.0', manifest: 'package.json' },
    { ecosystem: 'go', name: 'github.com/pkg/errors', version: 'v0.9.1', manifest: 'go.mod' },
    { ecosystem: 'cargo', name: 'serde', version: '1.0', manifest: 'Cargo.toml' }
  ]);
});

test('parseAddedDependencies: removals and context lines are ignored', () => {
  const diff = [
    '+++ b/package.json',
    '   "dependencies": {',
    '-    "left-pad": "^1.3.0",',
    '     "express": "^4.18.0"',
    '   }'
  ].join('\n');
  assert.deepEqual(parseAddedDependencies(diff), []);
});

test('parseAddedDependencies: garbage / empty input returns []', () => {
  assert.deepEqual(parseAddedDependencies(''), []);
  assert.deepEqual(parseAddedDependencies('not a diff at all\njust text'), []);
  assert.deepEqual(parseAddedDependencies(null), []);
  assert.deepEqual(parseAddedDependencies(undefined), []);
});

// ── collectChangedSourceFiles ────────────────────────────────────────────────

test('collectChangedSourceFiles: keeps js/ts/py, excludes .d.ts and deleted files', () => {
  const diff = [
    '+++ b/src/app.js',
    '+++ b/src/util.ts',
    '+++ b/src/service.py',
    '+++ b/src/types.d.ts',
    'diff --git a/src/gone.js b/src/gone.js',
    '--- a/src/gone.js',
    '+++ /dev/null',
    '+++ b/README.md',
    '+++ b/src/app.js'
  ].join('\n');
  assert.deepEqual(collectChangedSourceFiles(diff), [
    { path: 'src/app.js', lang: 'js' },
    { path: 'src/util.ts', lang: 'js' },
    { path: 'src/service.py', lang: 'py' }
  ]);
});

test('collectChangedSourceFiles: garbage returns []', () => {
  assert.deepEqual(collectChangedSourceFiles(''), []);
  assert.deepEqual(collectChangedSourceFiles('random'), []);
});

// ── extractAddedLines ────────────────────────────────────────────────────────

test('extractAddedLines: returns only the added content lines for one file', () => {
  const diff = [
    '+++ b/src/a.js',
    ' const x = 1;',
    '+const y = 2;',
    '-const z = 3;',
    '+++ b/src/b.js',
    '+const other = 9;'
  ].join('\n');
  assert.deepEqual(extractAddedLines(diff, 'src/a.js'), ['const y = 2;']);
  assert.deepEqual(extractAddedLines(diff, 'src/b.js'), ['const other = 9;']);
  assert.deepEqual(extractAddedLines(diff, 'src/missing.js'), []);
});

// ── isDocumented ─────────────────────────────────────────────────────────────

test('isDocumented: name near a decision keyword counts as documented', () => {
  const dep = { name: 'lodash', ecosystem: 'npm' };
  assert.equal(isDocumented(dep, 'Decision: adopt lodash for deep cloning to save time.'), true);
  assert.equal(isDocumented(dep, 'We chose to reuse lodash here.'), true);
  assert.equal(isDocumented(dep, 'lodash is now a dependency.'), false);
  assert.equal(isDocumented(dep, ''), false);
  assert.equal(isDocumented({ name: '' }, 'Decision: build it.'), false);
});

test('isDocumented: keyword too far from the name does not count', () => {
  const far = 'Decision: we will build a new caching layer. ' + 'x'.repeat(200) + ' lodash appears much later.';
  assert.equal(isDocumented({ name: 'lodash' }, far), false);
});

// ── renderSummary ────────────────────────────────────────────────────────────

test('renderSummary: clean state says so plainly', () => {
  const md = renderSummary({ addedDeps: [], undocumentedDeps: [], auditFindings: [], strict: false });
  assert.match(md, /Verdict: clean/);
  assert.match(md, /None added in this diff/);
  assert.match(md, /None found in the changed lines/);
});

test('renderSummary: findings and undocumented deps render tables and verdict', () => {
  const md = renderSummary({
    addedDeps: [{ ecosystem: 'npm', name: 'lodash', version: '^4', manifest: 'package.json' }],
    undocumentedDeps: [{ ecosystem: 'npm', name: 'lodash', version: '^4', manifest: 'package.json' }],
    auditFindings: [{ title: 'Deep clone', level: 'high', file: 'src/a.js', line: 2, coveredBy: 'built-in structuredClone' }],
    strict: true
  });
  assert.match(md, /\| lodash \| npm \| \^4 \| MISSING \|/);
  assert.match(md, /\*\*Deep clone\*\* \(high\)/);
  assert.match(md, /Verdict: changes requested/);
});

// ── decideExit ───────────────────────────────────────────────────────────────

test('decideExit: strict/non-strict matrix', () => {
  // non-strict never fails
  assert.equal(decideExit({ undocumentedDeps: [{}], highFindings: 3, strict: false }), 0);
  // strict + clean passes
  assert.equal(decideExit({ undocumentedDeps: [], highFindings: 0, strict: true }), 0);
  // strict + undocumented dep fails
  assert.equal(decideExit({ undocumentedDeps: [{}], highFindings: 0, strict: true }), 1);
  // strict + high finding fails (count form)
  assert.equal(decideExit({ undocumentedDeps: [], highFindings: 2, strict: true }), 1);
  // strict + high finding fails (array form)
  assert.equal(decideExit({ undocumentedDeps: [], highFindings: [{}], strict: true }), 1);
});

// ── run() with a fake injected audit ─────────────────────────────────────────

// A synthetic diff (hand-written fixture, not from a real repo): adds an
// undocumented dep and reinvents a deep clone in one changed file, while a
// separate unchanged file also has a wheel the audit "knows about".
const SYNTHETIC_DIFF = [
  '+++ b/package.json',
  '   "dependencies": {',
  '+    "lodash": "^4.17.21"',
  '   }',
  '+++ b/src/changed.js',
  '@@ -1,0 +1,3 @@',
  '+export function cloneConfig(config) {',
  '+  return JSON.parse(JSON.stringify(config));',
  '+}'
].join('\n');

// The fake audit reports two findings: one on the changed file whose snippet was
// added, and one on a file the diff never touched. Diff-scoping must keep only
// the first.
const FAKE_FINDINGS = [
  {
    patternId: 'fx-clone', title: 'Deep clone', category: 'objects',
    file: 'src/changed.js', line: 2, level: 'high',
    snippet: 'return JSON.parse(JSON.stringify(config));',
    coveredBy: 'built-in structuredClone'
  },
  {
    patternId: 'fx-clone', title: 'Deep clone', category: 'objects',
    file: 'src/untouched.js', line: 5, level: 'high',
    snippet: 'return JSON.parse(JSON.stringify(other));',
    coveredBy: 'built-in structuredClone'
  }
];

function withSuppressedLog(fn) {
  const orig = console.log;
  console.log = () => {};
  return Promise.resolve()
    .then(fn)
    .finally(() => { console.log = orig; });
}

test('run: diff-scopes findings and flags the undocumented dep in strict mode', async () => {
  await withSuppressedLog(async () => {
    const audit = async () => FAKE_FINDINGS;
    const res = await run({
      diffText: SYNTHETIC_DIFF,
      decisionText: 'This PR adds lodash without justification.',   // no decision keyword near it
      rootDir: '/nonexistent-root',                                  // decision-docs lookup degrades
      strict: true,
      audit
    });
    // Only the changed-file finding survives diff-scoping.
    assert.equal(res.findings.length, 1);
    assert.equal(res.findings[0].file, 'src/changed.js');
    // lodash was added but not documented → undocumented.
    assert.equal(res.undocumentedDeps.length, 1);
    assert.equal(res.undocumentedDeps[0].name, 'lodash');
    // strict + (undocumented dep OR high finding) → exit 1.
    assert.equal(res.exitCode, 1);
    assert.match(res.summary, /Verdict: changes requested/);
  });
});

test('run: documented dep + non-strict → clean exit even with a scoped finding', async () => {
  await withSuppressedLog(async () => {
    const audit = async () => FAKE_FINDINGS;
    const res = await run({
      diffText: SYNTHETIC_DIFF,
      decisionText: 'Decision: adopt lodash for cloning; rejected hand-rolling.',
      rootDir: '/nonexistent-root',
      strict: false,
      audit
    });
    assert.equal(res.undocumentedDeps.length, 0);   // documented
    assert.equal(res.findings.length, 1);           // still surfaced
    assert.equal(res.exitCode, 0);                   // non-strict never fails
    assert.match(res.summary, /Verdict: advisory/);
  });
});

test('run: empty diff degrades cleanly without an audit call', async () => {
  await withSuppressedLog(async () => {
    let called = false;
    const audit = async () => { called = true; return []; };
    const res = await run({ diffText: '', decisionText: '', rootDir: '/nonexistent', strict: true, audit });
    assert.equal(res.exitCode, 0);
    assert.equal(res.addedDeps.length, 0);
    assert.equal(res.findings.length, 0);
    assert.equal(called, true);   // audit still runs; it simply finds nothing to scope
    assert.match(res.summary, /Verdict: clean/);
  });
});

test('run: a throwing audit does not break the review', async () => {
  await withSuppressedLog(async () => {
    const audit = async () => { throw new Error('boom'); };
    const res = await run({ diffText: SYNTHETIC_DIFF, decisionText: '', rootDir: '/nonexistent', strict: false, audit });
    assert.equal(res.findings.length, 0);
    assert.equal(res.exitCode, 0);
    assert.ok(res.notes.some(n => /Audit step failed/.test(n)));
  });
});
