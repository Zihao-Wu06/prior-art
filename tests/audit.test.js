// Audit engine tests. Unit tests use inline fixture patterns so they do not
// depend on the evolving catalog; one guarded integrity test validates the
// real catalog's schema, and a guarded e2e drives the full command.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildInventory } from '../src/audit/inventory.js';
import { collectSourceFiles, scanFile } from '../src/audit/scanner.js';
import { resolveFinding } from '../src/audit/resolve.js';

const HAS_CATALOG = existsSync(new URL('../src/audit/patterns.js', import.meta.url));

const FIXTURE_PATTERNS = {
  deepClone: {
    id: 'fx-deep-clone', title: 'Deep clone', langs: ['js'], category: 'objects',
    namePattern: /^(deepClone|cloneDeep|deep_copy)$/i, nameOnly: true,
    bodyHints: [/JSON\.parse\(\s*JSON\.stringify/],
    coveredBy: { builtin: { name: 'structuredClone', api: 'structuredClone(value)', since: { node: 17 } }, deps: [{ name: 'lodash', api: '_.cloneDeep(value)' }] }
  },
  retry: {
    id: 'fx-retry', title: 'Retry with backoff', langs: ['js'], category: 'async',
    namePattern: /retry/i, nameOnly: false,
    bodyHints: [/Math\.pow\(\s*2\s*,/],
    coveredBy: { deps: [{ name: 'p-retry', api: 'pRetry(fn)' }] }
  },
  pyClone: {
    id: 'fx-py-clone', title: 'Python deep clone', langs: ['py'], category: 'objects',
    namePattern: /^deep_clone$/i, nameOnly: true, bodyHints: [],
    coveredBy: { builtin: { name: 'copy.deepcopy', api: 'copy.deepcopy(value)' } }
  }
};

test('inventory: reads npm and python deps, normalizes names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-inv-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4' }, devDependencies: { vitest: '^1' } }));
  writeFileSync(join(dir, 'requirements.txt'), '# comment\nTenacity>=8.0\npython_slugify[unicode]==8.0 ; python_version > "3.8"\n-r other.txt\n');
  const inv = buildInventory(dir);
  assert.ok(inv.npmDeps.includes('lodash'));
  // devDependencies are inventoried separately: recommending a devDep in
  // runtime code would itself introduce a bug (full review 2026-07-10).
  assert.ok(!inv.npmDeps.includes('vitest'));
  assert.ok(inv.npmDevDeps.includes('vitest'));
  assert.ok(inv.pyDeps.includes('tenacity'));
  assert.ok(inv.pyDeps.includes('python-slugify'));
  assert.ok(inv.languages.includes('js'));
  assert.ok(inv.manifests.includes('package.json'));
});

test('inventory: malformed package.json degrades to empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-inv-'));
  writeFileSync(join(dir, 'package.json'), '{not json');
  assert.deepEqual(buildInventory(dir).npmDeps, []);
});

test('scanFile: nameOnly fires on the name alone', () => {
  const out = scanFile('function deepClone(obj) {\n  return obj;\n}\n', 'js', [FIXTURE_PATTERNS.deepClone]);
  assert.equal(out.length, 1);
  assert.equal(out[0].via, 'name');
  assert.equal(out[0].line, 1);
});

test('scanFile: nameOnly bodyHints fire alone (via body)', () => {
  const out = scanFile('const copy = JSON.parse(JSON.stringify(config));\n', 'js', [FIXTURE_PATTERNS.deepClone]);
  assert.equal(out.length, 1);
  assert.equal(out[0].via, 'body');
});

test('scanFile: name-gated pattern needs name AND hint', () => {
  const noHint = scanFile('function retryFetch(url) {\n  return fetch(url);\n}\n', 'js', [FIXTURE_PATTERNS.retry]);
  assert.equal(noHint.length, 0);
  const withHint = scanFile('function retryFetch(url) {\n  const delay = Math.pow(2, attempt) * 100;\n}\n', 'js', [FIXTURE_PATTERNS.retry]);
  assert.equal(withHint.length, 1);
  assert.equal(withHint[0].via, 'name+body');
});

test('scanFile: name-gated hints never fire alone', () => {
  const out = scanFile('const backoff = Math.pow(2, attempt);\n', 'js', [FIXTURE_PATTERNS.retry]);
  assert.equal(out.length, 0);
});

test('scanFile: ignore-file marker suppresses the whole file', () => {
  const src = '// prior-art: ignore-file — fixture\nfunction deepClone(o) { return JSON.parse(JSON.stringify(o)); }\n';
  assert.equal(scanFile(src, 'js', [FIXTURE_PATTERNS.deepClone]).length, 0);
});

test('scanFile: python def extraction', () => {
  const out = scanFile('def deep_clone(value):\n    return value\n', 'py', [FIXTURE_PATTERNS.pyClone]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'deep_clone');
});

test('scanFile: dedup caps at 3 per pattern per file', () => {
  const src = Array.from({ length: 5 }, (_, i) => `function deepClone${''}(o${i}) {}`).map(s => s.replace('(o', 'X(o')).join('\n')
    .replace(/deepCloneX/g, 'deepClone');
  const out = scanFile(src, 'js', [FIXTURE_PATTERNS.deepClone]);
  assert.equal(out.length, 3);
});

test('collectSourceFiles: excludes tests by default, honors truncation and .d.ts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-scan-'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'tests'));
  writeFileSync(join(dir, 'src', 'a.js'), 'x');
  writeFileSync(join(dir, 'src', 'b.py'), 'x');
  writeFileSync(join(dir, 'src', 'types.d.ts'), 'x');
  writeFileSync(join(dir, 'src', 'c.spec.js'), 'x');
  writeFileSync(join(dir, 'tests', 'd.js'), 'x');
  const { files } = collectSourceFiles(dir);
  const rels = files.map(f => f.rel).sort();
  assert.deepEqual(rels, ['src/a.js', 'src/b.py']);
  const withTests = collectSourceFiles(dir, { includeTests: true });
  assert.equal(withTests.files.length, 4);
  const capped = collectSourceFiles(dir, { maxFiles: 1 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.files.length, 1);
});

const INV22 = { node: { version: 'v22.16.0', major: 22 }, npmDeps: ['lodash'], pyDeps: [] };
const MATCH = { patternId: 'fx-deep-clone', line: 1, snippet: 's', via: 'name', blockLines: 3, file: 'src/a.js' };

test('resolveFinding: satisfied builtin wins at high', () => {
  const f = resolveFinding(MATCH, FIXTURE_PATTERNS.deepClone, INV22);
  assert.equal(f.level, 'high');
  assert.equal(f.action, 'use-builtin');
  assert.match(f.coveredBy, /structuredClone/);
});

test('resolveFinding: unsatisfied builtin falls back to installed dep, then info', () => {
  const pattern = { ...FIXTURE_PATTERNS.deepClone, coveredBy: { builtin: { ...FIXTURE_PATTERNS.deepClone.coveredBy.builtin, since: { node: 99 } }, deps: FIXTURE_PATTERNS.deepClone.coveredBy.deps } };
  const withDep = resolveFinding(MATCH, pattern, INV22);
  assert.equal(withDep.action, 'use-installed');
  const noDep = resolveFinding(MATCH, pattern, { ...INV22, npmDeps: [] });
  assert.equal(noDep.level, 'info');
  assert.match(noDep.coveredBy, /requires Node ≥ 99/);
});

test('resolveFinding: dep-only pattern drops without suggest, surfaces with it', () => {
  const inv = { ...INV22, npmDeps: [] };
  const dropped = resolveFinding({ ...MATCH, patternId: 'fx-retry' }, FIXTURE_PATTERNS.retry, inv);
  assert.equal(dropped, null);
  const suggested = resolveFinding({ ...MATCH, patternId: 'fx-retry' }, FIXTURE_PATTERNS.retry, inv, { suggest: true });
  assert.equal(suggested.level, 'info');
  assert.equal(suggested.action, 'consider-library');
});

test('catalog integrity: schema holds for every pattern', { skip: !HAS_CATALOG }, async () => {
  const { PATTERNS, patternsForLang } = await import('../src/audit/patterns.js');
  const ids = new Set();
  for (const p of PATTERNS) {
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    assert.ok(p.langs.every(l => l === 'js' || l === 'py'), p.id);
    assert.ok(p.namePattern === null || p.namePattern instanceof RegExp, p.id);
    assert.ok(Array.isArray(p.bodyHints) && p.bodyHints.every(h => h instanceof RegExp), p.id);
    assert.equal(typeof p.nameOnly, 'boolean', p.id);
    assert.ok(p.coveredBy.builtin || (p.coveredBy.deps || []).length, p.id);
    if (!p.nameOnly) assert.ok(p.bodyHints.length >= 1, `${p.id} is name-gated but has no corroborating hints`);
  }
  assert.ok(patternsForLang('js').length > 20);
  assert.ok(patternsForLang('py').length > 5);
});

test('e2e: audit finds wheels in a fixture project, skips tests', { skip: !HAS_CATALOG }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-e2e-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx', license: 'MIT', dependencies: { lodash: '^4.17.21' } }));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'util.js'), [
    'export function cloneConfig(config) {',
    '  return JSON.parse(JSON.stringify(config));',
    '}',
    '',
    'export function slugify(title) {',
    '  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-");',
    '}',
    ''
  ].join('\n'));
  mkdirSync(join(dir, 'tests'));
  writeFileSync(join(dir, 'tests', 'helper.test.js'), 'function deepClone(o) { return JSON.parse(JSON.stringify(o)); }\n');

  const { run } = await import('../src/cli/commands/audit.js');
  const logged = [];
  const original = console.log;
  console.log = (...args) => logged.push(args.join(' '));
  try {
    await run({ dir, json: true });
  } finally {
    console.log = original;
  }
  const out = JSON.parse(logged.join('\n'));
  assert.ok(out.summary.high >= 1, 'expected at least one high finding');
  assert.ok(out.findings.every(f => !f.file.startsWith('tests/')), 'test files must be excluded');
  assert.ok(out.findings.some(f => /structuredClone|lodash/.test(f.coveredBy)));
  assert.equal(out.coverage.testsExcluded, true);
});

// ── Regressions from the v0.2 cross-vendor review ────────────────────────────

test('review: name-gated hint beyond the function block does not corroborate', () => {
  const src = 'function retryOnce() { return 1; }\n\nfunction unrelated() {\n  const delay = Math.pow(2, attempt);\n}\n';
  assert.equal(scanFile(src, 'js', [FIXTURE_PATTERNS.retry]).length, 0);
});

test('review: distinct body site fires even when a name fire exists elsewhere', () => {
  const src = 'function deepClone(x) { return x; }\n\nconst snapshot = JSON.parse(JSON.stringify(config));\n';
  const out = scanFile(src, 'js', [FIXTURE_PATTERNS.deepClone]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(m => m.via).sort(), ['body', 'name']);
});

test('review: same-block name+hint stays a single finding', () => {
  const src = 'function deepClone(x) {\n  return JSON.parse(JSON.stringify(x));\n}\n';
  assert.equal(scanFile(src, 'js', [FIXTURE_PATTERNS.deepClone]).length, 1);
});

test('review: single-parameter arrow functions are extracted', () => {
  const src = 'const retryDelay = attempt => Math.pow(2, attempt) * 100;\n';
  assert.equal(scanFile(src, 'js', [FIXTURE_PATTERNS.retry]).length, 1);
});

test('review: .mts/.cts are collected, .d.mts is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-mts-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.mts'), 'x');
  writeFileSync(join(dir, 'src', 'b.cts'), 'x');
  writeFileSync(join(dir, 'src', 'c.d.mts'), 'x');
  const { files } = collectSourceFiles(dir);
  assert.deepEqual(files.map(f => f.rel).sort(), ['src/a.mts', 'src/b.cts']);
});

test('full-review: engines.node floor is parsed and gates JS builtins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-eng-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ engines: { node: '>=16.14 <21' }, dependencies: {} }));
  const inv = buildInventory(dir);
  assert.equal(inv.nodeRequires, '16.14');

  const pattern = {
    id: 'fx-withresolvers', title: 'Deferred', langs: ['js'], category: 'async',
    namePattern: /^deferred$/i, nameOnly: true, bodyHints: [],
    coveredBy: { builtin: { name: 'Promise.withResolvers', api: 'Promise.withResolvers()', since: { node: 22 } } }
  };
  const match = { patternId: 'fx-withresolvers', line: 1, snippet: 's', via: 'name', blockLines: 2, file: 'src/a.js' };
  // Project floor 16.14 < required 22 → info, even on a Node 22 machine.
  const gated = resolveFinding(match, pattern, { ...INV22, nodeRequires: '16.14' });
  assert.equal(gated.level, 'info');
  assert.match(gated.coveredBy, /engines\.node allows ≥ 16\.14/);
  // No declared floor → the running Node (22) is the proxy → high.
  const proxy = resolveFinding(match, pattern, { ...INV22, nodeRequires: null });
  assert.equal(proxy.level, 'high');
});

test('full-review: OSV query body is version-scoped when a version is known', async () => {
  const { buildOsvQueryBody } = await import('../src/data/sources.js');
  assert.deepEqual(buildOsvQueryBody('npm', 'lodash', '4.18.1'),
    { package: { name: 'lodash', ecosystem: 'npm' }, version: '4.18.1' });
  assert.deepEqual(buildOsvQueryBody('pypi', 'requests', null),
    { package: { name: 'requests', ecosystem: 'PyPI' } });
});

test('review: pyproject requires-python is parsed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-pyreq-'));
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\nrequires-python = ">=3.10"\ndependencies = ["tenacity>=8"]\n');
  const inv = buildInventory(dir);
  assert.equal(inv.pythonRequires, '3.10');
  assert.ok(inv.pyDeps.includes('tenacity'));
});

const PY_BATCHED = {
  id: 'fx-batched', title: 'Chunking', langs: ['py'], category: 'arrays',
  namePattern: /^chunked?$/i, nameOnly: true, bodyHints: [],
  coveredBy: { builtin: { name: 'itertools.batched', api: 'itertools.batched(it, n)', since: { python: '3.12' } }, deps: [{ name: 'more-itertools', api: 'chunked(it, n)' }] }
};
const PYMATCH = { patternId: 'fx-batched', line: 1, snippet: 's', via: 'name', blockLines: 2, file: 'src/a.py' };

test('review: python builtins gate on requires-python', () => {
  const ok = resolveFinding(PYMATCH, PY_BATCHED, { ...INV22, pythonRequires: '3.12', pyDeps: [] });
  assert.equal(ok.level, 'high');
  const low = resolveFinding(PYMATCH, PY_BATCHED, { ...INV22, pythonRequires: '3.9', pyDeps: [] });
  assert.equal(low.level, 'info');
  assert.match(low.coveredBy, /requires Python ≥ 3\.12/);
  const unknown = resolveFinding(PYMATCH, PY_BATCHED, { ...INV22, pythonRequires: null, pyDeps: [] });
  assert.equal(unknown.level, 'info');
  const viaDep = resolveFinding(PYMATCH, PY_BATCHED, { ...INV22, pythonRequires: '3.9', pyDeps: ['more-itertools'] });
  assert.equal(viaDep.action, 'use-installed');
});

test('review: catalog does not misfire on generic names or claim a shallow-merge builtin', { skip: !HAS_CATALOG }, async () => {
  const { patternsForLang } = await import('../src/audit/patterns.js');
  const js = patternsForLang('js');
  assert.equal(scanFile('function generateId(row) { return row.id + 1; }\n', 'js', js).length, 0);
  assert.equal(scanFile('function parseParams(argv) { return argv.slice(2); }\n', 'js', js).length, 0);
  const merge = js.find(p => p.id === 'deep-merge');
  assert.ok(merge && !merge.coveredBy.builtin, 'deep-merge must not claim a shallow builtin');
});

test('review: --json works on the empty-language path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-empty-'));
  writeFileSync(join(dir, 'notes.txt'), 'x');
  const { run } = await import('../src/cli/commands/audit.js');
  const logged = [];
  const orig = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  try {
    await run({ dir, json: true });
  } finally {
    console.log = orig;
  }
  const out = JSON.parse(logged.join('\n'));
  assert.deepEqual(out.findings, []);
  assert.equal(out.summary.total, 0);
});
