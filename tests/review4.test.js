// Regression tests for the fourth review (2026-10-28): each test reproduces a
// bug that the previous suite let through.
//   1. audit crashed when Python files sat past the 200-entry language glance
//   2. the PR check reported "clean" when the audit itself failed
//   3. pyproject.toml metadata keys were reported as new dependencies
//   4. extras like "requests[socks]" hid every dependency; requires-python
//      read the upper bound instead of the floor
//   5. SPDX parentheses were ignored
//   6. a `$` in an ADR title was expanded as a replacement pattern

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { run as prReview } from '../src/action/pr-review.js';
import { parseManifestDeps } from '../src/action/manifest.js';
import { parseAddedDependencies } from '../src/action/diff.js';
import { decideExit } from '../src/action/render.js';
import { buildInventory, pythonFloor } from '../src/audit/inventory.js';
import { classifyLicense, deriveFlags } from '../src/data/assess.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'index.js');

function tmp() {
  return mkdtempSync(join(tmpdir(), 'pa-review4-'));
}

function pa(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

async function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}

const DEEP_COPY_PY = 'import copy\ndef deep_copy(o):\n    return copy.deepcopy(o)\n';

/** A JS project whose only Python file is visited after the 200-entry glance. */
function mixedRepo() {
  const dir = tmp();
  writeFileSync(join(dir, 'package.json'), '{"name":"x"}');
  mkdirSync(join(dir, 'a'));
  mkdirSync(join(dir, 'z'));
  for (let i = 0; i < 250; i++) writeFileSync(join(dir, 'z', `f${i}.js`), 'export const x = 1;\n');
  writeFileSync(join(dir, 'a', 'u.py'), DEEP_COPY_PY);
  return dir;
}

// ── 1. audit: languages come from the real file walk ─────────────────────────

test('audit: python files past the language glance are scanned, not a crash', () => {
  const dir = mixedRepo();
  const res = pa(['audit', '--dir', dir, '--json'], dir);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.deepEqual(out.inventory.languages, ['js', 'py']);
  assert.ok(out.findings.some(f => f.patternId === 'py-deep-copy' && f.file === join('a', 'u.py')));
});

// ── 2. PR check: a failed audit is never "clean" ─────────────────────────────

const PY_DIFF = [
  'diff --git a/a/u.py b/a/u.py',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/a/u.py',
  '@@ -0,0 +1,3 @@',
  ...DEEP_COPY_PY.trimEnd().split('\n').map(l => '+' + l),
  ''
].join('\n');

test('pr-review: a failing audit fails strict mode and is not reported clean', async () => {
  await quiet(async () => {
    const audit = async () => { throw new Error('boom'); };
    const strict = await prReview({ diffText: PY_DIFF, rootDir: tmp(), strict: true, audit });
    assert.equal(strict.exitCode, 1);
    assert.equal(strict.auditFailed, true);
    assert.doesNotMatch(strict.summary, /Verdict: clean/);

    const lenient = await prReview({ diffText: PY_DIFF, rootDir: tmp(), strict: false, audit });
    assert.equal(lenient.exitCode, 0);
    assert.match(lenient.summary, /Verdict: incomplete/);
  });
});

test('pr-review: the default audit surfaces a crashed `pa audit` as a failure', async () => {
  await quiet(async () => {
    const res = await prReview({ diffText: PY_DIFF, rootDir: join(tmp(), 'missing'), strict: true });
    assert.equal(res.auditFailed, true);
    assert.equal(res.exitCode, 1);
    assert.ok(res.notes.some(n => /pa audit exited 2/.test(n)));
  });
});

test('pr-review: the default audit finds the wheel in a mixed js/py repo', async () => {
  await quiet(async () => {
    const res = await prReview({ diffText: PY_DIFF, rootDir: mixedRepo(), strict: true });
    assert.equal(res.auditFailed, false);
    assert.ok(res.findings.some(f => f.patternId === 'py-deep-copy'));
    assert.equal(res.exitCode, 1);
  });
});

test('decideExit: strict fails on audit failure alone', () => {
  assert.equal(decideExit({ strict: true, auditFailed: true }), 1);
  assert.equal(decideExit({ strict: false, auditFailed: true }), 0);
});

// ── 3. pyproject.toml metadata is not a dependency ───────────────────────────

const PYPROJECT = [
  '[project]',
  'name = "x"',
  'description = "demo"',
  'readme = "README.md"',
  'dependencies = [',
  '  "requests[socks]>=2",',
  '  "httpx",',
  ']',
  '',
  '[tool.ruff]',
  'line-length = 100',
  ''
].join('\n');

test('manifest: pyproject keys are not parsed as requirements', () => {
  const deps = parseManifestDeps(PYPROJECT, 'pypi', 'pyproject.toml');
  assert.deepEqual([...deps.keys()].sort(), ['httpx', 'requests']);
  // Without a path the TOML is still recognized by its table headers.
  assert.deepEqual([...parseManifestDeps(PYPROJECT, 'pypi').keys()].sort(), ['httpx', 'requests']);
  // requirements files keep working, inline comments included.
  const req = parseManifestDeps('flask==3.0  # web\n-r base.txt\n\nattrs\n', 'pypi', 'requirements.txt');
  assert.deepEqual([...req.keys()].sort(), ['attrs', 'flask']);
});

test('pr-review: metadata-only pyproject edits add no dependencies; a real one is caught', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'pyproject.toml'), PYPROJECT);
  const diff = [
    'diff --git a/pyproject.toml b/pyproject.toml',
    '--- a/pyproject.toml',
    '+++ b/pyproject.toml',
    '@@ -1,6 +1,11 @@',
    ' [project]',
    ' name = "x"',
    '+description = "demo"',
    '+readme = "README.md"',
    ' dependencies = [',
    '   "requests[socks]>=2",',
    '+  "httpx",',
    ' ]',
    '+',
    '+[tool.ruff]',
    '+line-length = 100',
    ''
  ].join('\n');
  await quiet(async () => {
    const res = await prReview({ diffText: diff, rootDir: dir, strict: true, audit: async () => [] });
    assert.deepEqual(res.addedDeps.map(d => d.name), ['httpx']);
  });
});

test('diff: an extras entry does not close the dependencies array early', () => {
  const diff = [
    '--- a/pyproject.toml',
    '+++ b/pyproject.toml',
    '@@ -1,2 +1,5 @@',
    ' [project]',
    '+dependencies = [',
    '+  "requests[socks]>=2",',
    '+  "attrs",',
    '+]',
    ''
  ].join('\n');
  assert.deepEqual(parseAddedDependencies(diff).map(d => d.name), ['requests', 'attrs']);
});

// ── 4. inventory: extras and the requires-python floor ───────────────────────

test('inventory: extras keep the whole dependency array; floor is the lower bound', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'pyproject.toml'), [
    '[project]',
    'requires-python = "<3.13,>=3.8"',
    'dependencies = [',
    '  "requests[socks]>=2",  # comment with ] in it',
    '  "tenacity",',
    ']',
    ''
  ].join('\n'));
  const inv = buildInventory(dir);
  assert.deepEqual(inv.pyDeps.sort(), ['requests', 'tenacity']);
  assert.equal(inv.pythonRequires, '3.8');
});

test('pythonFloor: lower bounds only', () => {
  assert.equal(pythonFloor('>=3.9'), '3.9');
  assert.equal(pythonFloor('~=3.10'), '3.10');
  assert.equal(pythonFloor('!=3.0.*, >=3.7'), '3.7');
  assert.equal(pythonFloor('<4'), null);
});

// ── 5. SPDX parentheses ──────────────────────────────────────────────────────

test('spdx: parentheses group before OR splits', () => {
  assert.equal(classifyLicense('GPL-3.0 AND (MIT OR BSD-3-Clause)'), 'strong-copyleft');
  assert.equal(classifyLicense('(MIT OR Apache-2.0) AND GPL-3.0-only'), 'strong-copyleft');
  assert.equal(classifyLicense('(MIT OR GPL-3.0) AND BSD-3-Clause'), 'permissive');
  assert.equal(classifyLicense('Apache-2.0 WITH LLVM-exception OR MIT'), 'permissive');
  assert.equal(classifyLicense('(MIT'), 'unknown');
  assert.equal(classifyLicense('MIT OR'), 'unknown');
  const flags = deriveFlags({ license: 'GPL-3.0 AND (MIT OR BSD-3-Clause)' }, 'MIT');
  assert.ok(flags.some(f => f.code === 'license-conflict'));
});

// ── 6. ADR titles are literal ────────────────────────────────────────────────

test('adr: a `$` in the title is written verbatim', () => {
  const dir = tmp();
  assert.equal(pa(['init'], dir).status, 0);
  const res = pa(['adr', 'new', 'Pay $& per seat, not $1'], dir);
  assert.equal(res.status, 0, res.stderr);
  const content = readFileSync(res.stdout.trim(), 'utf8');
  assert.equal(content.split('\n')[0], '# 0001. Pay $& per seat, not $1');
});
