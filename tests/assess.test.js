import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessPackage,
  assessVersion,
  assessProject,
  assessOsv,
  assessNpmExtras,
  classifyLicense,
  deriveFlags,
  buildEvidenceLine
} from '../src/data/assess.js';

const DAY = 86400000;

// ---------------------------------------------------------------------------
// assessPackage
// ---------------------------------------------------------------------------

test('assessPackage picks the isDefault version and computes day-based signals', () => {
  const t0 = Date.UTC(2020, 0, 1); // earliest release
  const t1 = t0 + 400 * DAY; // isDefault release, 400 days after t0
  const now = t1 + 10 * DAY; // "today" is 10 days after the latest release

  const pkg = {
    versions: [
      { versionKey: { version: '1.0.0' }, publishedAt: new Date(t0).toISOString(), isDefault: false },
      { versionKey: { version: '2.0.0' }, publishedAt: new Date(t1).toISOString(), isDefault: true, isDeprecated: false }
    ]
  };

  assert.deepEqual(assessPackage(pkg, now), {
    latestVersion: '2.0.0',
    releaseCount: 2,
    daysSinceLastRelease: 10,
    ageDays: 410,
    deprecated: false
  });
});

test('assessPackage falls back to the last array entry when no version isDefault', () => {
  const pkg = {
    versions: [
      { versionKey: { version: '3.0.0' }, publishedAt: '2022-06-01T00:00:00.000Z' },
      { versionKey: { version: '1.0.0' }, publishedAt: '2020-01-01T00:00:00.000Z' }
    ]
  };
  const result = assessPackage(pkg, Date.parse('2022-06-11T00:00:00.000Z'));
  assert.equal(result.latestVersion, '1.0.0');
  assert.equal(result.releaseCount, 2);
});

test('assessPackage reports deprecated from the latest version', () => {
  const pkg = {
    versions: [
      { versionKey: { version: '1.0.0' }, publishedAt: '2020-01-01T00:00:00.000Z', isDefault: true, isDeprecated: true, deprecationReason: 'use foo instead' }
    ]
  };
  assert.equal(assessPackage(pkg, Date.parse('2020-01-02T00:00:00.000Z')).deprecated, true);
});

test('assessPackage is null-safe for null/invalid/empty input', () => {
  assert.equal(assessPackage(null), null);
  assert.equal(assessPackage(undefined), null);
  assert.equal(assessPackage({}), null);
  assert.equal(assessPackage({ versions: [] }), null);
  assert.equal(assessPackage('not an object'), null);
});

// ---------------------------------------------------------------------------
// assessVersion
// ---------------------------------------------------------------------------

test('assessVersion derives license/advisory/provenance/projectId', () => {
  const vData = {
    licenses: ['MIT'],
    advisoryKeys: [{ id: 'GHSA-1' }, { id: 'GHSA-2' }],
    slsaProvenances: [],
    attestations: [{ kind: 'x' }],
    relatedProjects: [{ projectKey: { id: 'github.com/foo/bar' } }, { projectKey: { id: 'github.com/other' } }]
  };
  assert.deepEqual(assessVersion(vData), {
    license: 'MIT',
    advisoryCount: 2,
    hasProvenance: true,
    projectId: 'github.com/foo/bar'
  });
});

test('assessVersion joins multiple licenses', () => {
  assert.equal(assessVersion({ licenses: ['MIT', 'Apache-2.0'] }).license, 'MIT OR Apache-2.0');
});

test('assessVersion is null-safe and defaults on missing fields', () => {
  assert.deepEqual(assessVersion({}), {
    license: null,
    advisoryCount: 0,
    hasProvenance: false,
    projectId: null
  });
  assert.deepEqual(assessVersion(null), {
    license: null,
    advisoryCount: 0,
    hasProvenance: false,
    projectId: null
  });
});

// ---------------------------------------------------------------------------
// assessProject
// ---------------------------------------------------------------------------

test('assessProject reads stars/forks/openIssues/scorecard', () => {
  const pData = { starsCount: 120, forksCount: 30, openIssuesCount: 5, scorecard: { overallScore: 7.2 } };
  assert.deepEqual(assessProject(pData), { stars: 120, forks: 30, openIssues: 5, scorecard: 7.2 });
});

test('assessProject defaults every missing field to null', () => {
  assert.deepEqual(assessProject({}), { stars: null, forks: null, openIssues: null, scorecard: null });
  assert.deepEqual(assessProject(null), { stars: null, forks: null, openIssues: null, scorecard: null });
});

// ---------------------------------------------------------------------------
// assessOsv
// ---------------------------------------------------------------------------

test('assessOsv counts vulns and collects ids', () => {
  const osv = { vulns: [{ id: 'OSV-1' }, { id: 'OSV-2' }] };
  assert.deepEqual(assessOsv(osv), { vulnCount: 2, vulnIds: ['OSV-1', 'OSV-2'] });
});

test('assessOsv defaults to zero vulns when missing/empty', () => {
  assert.deepEqual(assessOsv({}), { vulnCount: 0, vulnIds: [] });
  assert.deepEqual(assessOsv(null), { vulnCount: 0, vulnIds: [] });
});

// ---------------------------------------------------------------------------
// assessNpmExtras
// ---------------------------------------------------------------------------

test('assessNpmExtras reads downloads, maintainers, install scripts, and latest publish time', () => {
  const packument = {
    'dist-tags': { latest: '2.0.0' },
    versions: { '2.0.0': { scripts: { postinstall: 'node build.js' } } },
    time: { '2.0.0': '2023-05-01T00:00:00.000Z' },
    maintainers: [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
  };
  const downloads = { downloads: 45000 };

  assert.deepEqual(assessNpmExtras(packument, downloads), {
    monthlyDownloads: 45000,
    maintainerCount: 3,
    hasInstallScripts: true,
    latestPublishedAt: '2023-05-01T00:00:00.000Z'
  });
});

test('assessNpmExtras reports no install scripts when scripts do not include install hooks', () => {
  const packument = {
    'dist-tags': { latest: '1.0.0' },
    versions: { '1.0.0': { scripts: { test: 'jest' } } },
    time: { '1.0.0': '2022-01-01T00:00:00.000Z' },
    maintainers: []
  };
  const result = assessNpmExtras(packument, { downloads: 0 });
  assert.equal(result.hasInstallScripts, false);
  assert.equal(result.maintainerCount, 0);
  assert.equal(result.monthlyDownloads, 0);
});

test('assessNpmExtras is null-safe on missing packument/downloads data', () => {
  assert.deepEqual(assessNpmExtras({}, {}), {
    monthlyDownloads: null,
    maintainerCount: null,
    hasInstallScripts: false,
    latestPublishedAt: null
  });
  assert.deepEqual(assessNpmExtras(null, null), {
    monthlyDownloads: null,
    maintainerCount: null,
    hasInstallScripts: false,
    latestPublishedAt: null
  });
});

// ---------------------------------------------------------------------------
// classifyLicense
// ---------------------------------------------------------------------------

test('classifyLicense: permissive licenses', () => {
  for (const expr of ['MIT', 'ISC', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense', 'CC0-1.0', 'Zlib', 'PSF-2.0']) {
    assert.equal(classifyLicense(expr), 'permissive', expr);
  }
  assert.equal(classifyLicense('MIT OR Apache-2.0'), 'permissive');
});

test('classifyLicense: weak-copyleft licenses', () => {
  assert.equal(classifyLicense('LGPL-3.0-only'), 'weak-copyleft');
  assert.equal(classifyLicense('MPL-2.0'), 'weak-copyleft');
  assert.equal(classifyLicense('EPL-2.0'), 'weak-copyleft');
  assert.equal(classifyLicense('CDDL-1.0'), 'weak-copyleft');
});

test('classifyLicense: strong-copyleft licenses', () => {
  assert.equal(classifyLicense('GPL-3.0'), 'strong-copyleft');
  assert.equal(classifyLicense('GPL-2.0-only'), 'strong-copyleft');
  assert.equal(classifyLicense('AGPL-3.0'), 'strong-copyleft');
});

test('classifyLicense: LGPL must not be misclassified as strong-copyleft', () => {
  assert.equal(classifyLicense('LGPL-3.0'), 'weak-copyleft');
});

test('classifyLicense: empty/null/other -> unknown', () => {
  assert.equal(classifyLicense(''), 'unknown');
  assert.equal(classifyLicense(null), 'unknown');
  assert.equal(classifyLicense(undefined), 'unknown');
  assert.equal(classifyLicense('WTFPL'), 'unknown');
});

// ---------------------------------------------------------------------------
// deriveFlags
// ---------------------------------------------------------------------------

test('deriveFlags covers every rule and orders high before warn before info', () => {
  const signals = {
    deprecated: true,
    vulnCount: 2,
    vulnIds: ['OSV-1', 'OSV-2', 'OSV-3', 'OSV-4'],
    advisoryCount: 3, // vulnCount !== 0, so 'advisories' must NOT fire
    daysSinceLastRelease: 600,
    maintainerCount: 1,
    hasInstallScripts: true,
    scorecard: 2,
    license: 'GPL-3.0',
    monthlyDownloads: 10
  };
  const flags = deriveFlags(signals, 'MIT');
  const codes = flags.map(f => f.code);

  assert.deepEqual(codes, [
    'deprecated',
    'known-vulnerabilities',
    'stale-release',
    'bus-factor',
    'install-scripts',
    'low-scorecard',
    'license-conflict',
    'low-adoption'
  ]);

  const levels = flags.map(f => f.level);
  const firstWarnIdx = levels.indexOf('warn');
  const firstInfoIdx = levels.indexOf('info');
  assert.ok(levels.slice(0, firstWarnIdx).every(l => l === 'high'));
  assert.ok(levels.slice(firstWarnIdx, firstInfoIdx).every(l => l === 'warn'));
  assert.ok(levels.slice(firstInfoIdx).every(l => l === 'info'));

  const vulnFlag = flags.find(f => f.code === 'known-vulnerabilities');
  assert.equal((vulnFlag.message.match(/OSV-/g) || []).length, 3, 'lists at most 3 vuln ids');
});

test('deriveFlags: advisories fires only when advisoryCount > 0 and vulnCount === 0', () => {
  // license: 'MIT' keeps no-license-metadata from also firing, isolating this rule.
  assert.deepEqual(deriveFlags({ advisoryCount: 2, vulnCount: 0, license: 'MIT' }).map(f => f.code), ['advisories']);
  assert.equal(deriveFlags({ advisoryCount: 2, vulnCount: 0, license: 'MIT' })[0].level, 'warn');
  assert.equal(deriveFlags({ advisoryCount: 2, vulnCount: 1, license: 'MIT' }).some(f => f.code === 'advisories'), false);
  assert.equal(deriveFlags({ advisoryCount: 0, vulnCount: 0, license: 'MIT' }).some(f => f.code === 'advisories'), false);
});

test('deriveFlags: no-license-metadata fires when license is null/undefined', () => {
  assert.deepEqual(deriveFlags({ license: null }).map(f => f.code), ['no-license-metadata']);
  assert.deepEqual(deriveFlags({}).map(f => f.code), ['no-license-metadata']);
});

test('deriveFlags: license-conflict requires a strong-copyleft dep and a permissive project license', () => {
  assert.ok(deriveFlags({ license: 'GPL-3.0' }, 'MIT').some(f => f.code === 'license-conflict'));
  assert.equal(deriveFlags({ license: 'LGPL-3.0-only' }, 'MIT').some(f => f.code === 'license-conflict'), false);
  assert.equal(deriveFlags({ license: 'GPL-3.0' }, 'GPL-3.0').some(f => f.code === 'license-conflict'), false);
  assert.equal(deriveFlags({ license: 'GPL-3.0' }).some(f => f.code === 'license-conflict'), false);
});

test('deriveFlags: a clean, healthy signal set produces no flags', () => {
  const flags = deriveFlags({
    deprecated: false,
    vulnCount: 0,
    advisoryCount: 0,
    daysSinceLastRelease: 5,
    maintainerCount: 4,
    hasInstallScripts: false,
    scorecard: 8,
    license: 'MIT',
    monthlyDownloads: 500000
  }, 'MIT');
  assert.deepEqual(flags, []);
});

// ---------------------------------------------------------------------------
// buildEvidenceLine
// ---------------------------------------------------------------------------

test('buildEvidenceLine renders the exact template with concrete values', () => {
  const signals = {
    latestVersion: '2.0.0',
    daysSinceLastRelease: 10,
    releaseCount: 5,
    stars: 120,
    scorecard: 7,
    license: 'MIT',
    vulnCount: 0,
    monthlyDownloads: 45000
  };
  const flags = [{ level: 'info', code: 'low-adoption', message: 'x' }];
  const line = buildEvidenceLine('left-pad', 'npm', signals, flags);
  const today = new Date().toISOString().slice(0, 10);

  assert.equal(
    line,
    `Evidence: npm:left-pad@2.0.0 — released 10d ago, 5 releases, 120★, scorecard 7, license MIT, vulns 0, downloads/mo 45000; flags: low-adoption. (source: deps.dev/OSV, ${today})`
  );
});

test('buildEvidenceLine uses ? for null signal values and "none" for no flags', () => {
  const line = buildEvidenceLine('foo', 'pypi', {}, []);
  const today = new Date().toISOString().slice(0, 10);

  assert.equal(
    line,
    `Evidence: pypi:foo@? — released ?d ago, ? releases, ?★, scorecard ?, license ?, vulns ?, downloads/mo ?; flags: none. (source: deps.dev/OSV, ${today})`
  );
});
