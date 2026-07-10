import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot } from '../../core/config.js';
import {
  SYSTEMS,
  fetchPackage,
  fetchVersion,
  fetchProject,
  queryOsv,
  fetchNpmPackument,
  fetchNpmDownloads
} from '../../data/sources.js';
import {
  assessPackage,
  assessVersion,
  assessProject,
  assessOsv,
  assessNpmExtras,
  classifyLicense,
  deriveFlags,
  buildEvidenceLine
} from '../../data/assess.js';

/**
 * Print a dependency due-diligence report for one package.
 * @param {string} name - Package name.
 * @param {Record<string, string|boolean>} opts - `--eco`, `--json`, `--fresh`.
 */
export async function run(name, opts) {
  const system = opts.eco || 'npm';
  if (!Object.prototype.hasOwnProperty.call(SYSTEMS, system)) {
    throw {
      message: `unknown ecosystem "${system}" — use one of: ${Object.keys(SYSTEMS).join('|')}`,
      exitCode: 2
    };
  }

  const fetchOpts = { fresh: Boolean(opts.fresh) };

  const pkgRes = await fetchPackage(system, name, fetchOpts);
  if (pkgRes.status === 404 || !pkgRes.data) {
    throw {
      message: `${system}:${name} not found on deps.dev — check the name or pass --eco <${Object.keys(SYSTEMS).join('|')}>`,
      exitCode: 2
    };
  }

  const signals = assessPackage(pkgRes.data);
  if (!signals) {
    throw {
      message: `${system}:${name} not found on deps.dev — check the name or pass --eco <${Object.keys(SYSTEMS).join('|')}>`,
      exitCode: 2
    };
  }
  const latestVersion = signals.latestVersion;

  // Enrichment sources may fail independently (rate limits, outages);
  // report whatever signals were gathered rather than aborting.
  const skipped = [];

  if (latestVersion) {
    try {
      const vRes = await fetchVersion(system, name, latestVersion, fetchOpts);
      Object.assign(signals, assessVersion(vRes.data));
    } catch {
      skipped.push('deps.dev version');
    }
  }

  if (signals.projectId) {
    try {
      const pRes = await fetchProject(signals.projectId, fetchOpts);
      Object.assign(signals, assessProject(pRes.data));
    } catch {
      skipped.push('deps.dev project');
    }
  }

  try {
    const osvRes = await queryOsv(system, name, latestVersion || null, fetchOpts);
    Object.assign(signals, assessOsv(osvRes.data));
  } catch {
    skipped.push('OSV');
  }

  if (system === 'npm') {
    try {
      const [packumentRes, downloadsRes] = await Promise.all([
        fetchNpmPackument(name, fetchOpts),
        fetchNpmDownloads(name, fetchOpts)
      ]);
      Object.assign(signals, assessNpmExtras(packumentRes.data, downloadsRes.data));
    } catch {
      skipped.push('npm registry');
    }
  }

  // Project license: only meaningful for npm projects today (Cargo.toml /
  // pyproject license parsing is future work); resolved from the project
  // root so subdirectory runs see the same manifest.
  let projectLicense = null;
  if (system === 'npm') {
    try {
      const raw = readFileSync(join(findProjectRoot(process.cwd()), 'package.json'), 'utf8');
      projectLicense = JSON.parse(raw).license || null;
    } catch {
      projectLicense = null;
    }
  }

  const flags = deriveFlags(signals, projectLicense);
  let evidence = buildEvidenceLine(name, system, signals, flags);
  if (skipped.length) {
    // The Evidence line travels alone into ADRs — it must carry its own
    // coverage statement rather than rely on a neighboring hint.
    evidence += ` [skipped sources: ${skipped.join(', ')} — missing signals are unknown, not clean]`;
  }

  if (opts.json) {
    console.log(JSON.stringify({ name, system, signals, flags, evidence, skippedSources: skipped }, null, 2));
  } else {
    console.log(renderReport({ name, system, signals, flags, evidence, projectLicense }));
    if (skipped.length) {
      console.log(`Coverage: skipped sources (unreachable): ${skipped.join(', ')} — treat missing signals as unknown, not as clean.`);
    }
  }

  if (flags.some(f => f.level === 'high')) {
    process.exitCode = 1;
  }
  // Gate mode: incomplete signal coverage is its own failure class (exit 3),
  // distinct from "HIGH finding" (exit 1) — a gate must not pass on absence
  // of evidence.
  if (skipped.length && opts.requireComplete) {
    console.error(`error: incomplete signal coverage (skipped: ${skipped.join(', ')}) — failing due to --require-complete`);
    process.exitCode = 3;
  }
}

/** Render '?' for null/undefined, 'yes'/'no' for booleans, joined lists for arrays. */
function fmt(value) {
  if (value === null || value === undefined) return '?';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '?';
  return String(value);
}

/** Render up to 3 vuln ids alongside the count. */
function vulnSummary(signals) {
  const ids = Array.isArray(signals.vulnIds) ? signals.vulnIds.slice(0, 3) : [];
  const count = signals.vulnCount ?? (Array.isArray(signals.vulnIds) ? signals.vulnIds.length : null);
  if (count === null || count === undefined) return '?';
  if (count === 0) return '0';
  return ids.length ? `${count} (${ids.join(', ')})` : String(count);
}

/** Align a list of [label, value] pairs into two columns. */
function renderRows(rows) {
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`).join('\n');
}

function renderReport({ name, system, signals, flags, evidence, projectLicense }) {
  const lines = [];
  lines.push('Prior Art — dependency report');
  lines.push(`${system}:${name}@${fmt(signals.latestVersion)}`);
  lines.push('');

  lines.push('Health:');
  lines.push(renderRows([
    ['latest release age (days)', fmt(signals.daysSinceLastRelease)],
    ['releases', fmt(signals.releaseCount)],
    ['age (days)', fmt(signals.ageDays)],
    ['deprecated', fmt(signals.deprecated)]
  ]));
  lines.push('');

  lines.push('Security:');
  lines.push(renderRows([
    ['vulns', vulnSummary(signals)],
    ['advisories', fmt(signals.advisoryCount)],
    ['provenance', fmt(signals.hasProvenance)],
    ['scorecard', fmt(signals.scorecard)]
  ]));
  lines.push('');

  lines.push('License:');
  lines.push(renderRows([
    ['license', fmt(signals.license)],
    ['class', fmt(signals.license != null ? classifyLicense(signals.license) : null)],
    ['project license', fmt(projectLicense)]
  ]));
  lines.push('');

  lines.push('Adoption:');
  lines.push(renderRows([
    ['stars', fmt(signals.stars)],
    ['forks', fmt(signals.forks)],
    ['open issues', fmt(signals.openIssues)],
    ['downloads/mo', fmt(signals.monthlyDownloads)],
    ['maintainers', fmt(signals.maintainerCount)],
    ['install scripts', fmt(signals.hasInstallScripts)]
  ]));
  lines.push('');

  lines.push('Flags:');
  if (flags.length === 0) {
    lines.push('  none');
  } else {
    for (const flag of flags) {
      lines.push(`  [${flag.level.toUpperCase()}] ${flag.code} — ${flag.message}`);
    }
  }
  lines.push('');

  lines.push(evidence);
  lines.push('Paste the Evidence line into your ADR (pa adr new "<title>").');

  return lines.join('\n');
}
