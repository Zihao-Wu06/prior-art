// Pure signal derivations over deps.dev / OSV.dev / npm registry JSON.
// No IO here -- everything is a plain function of its input, unit-testable
// offline. See src/data/sources.js for the fetchers that produce this JSON.

const DAY_MS = 86400000;

/**
 * Summarize a deps.dev package response (all versions) into release signals.
 * The "latest" version is whichever entry has isDefault, else the last entry.
 * @param {{versions?: Array<{versionKey?: {version?: string}, publishedAt?: string, isDefault?: boolean, isDeprecated?: boolean}>}} pkgData
 * @param {number} [now]
 * @returns {{latestVersion: string|null, releaseCount: number, daysSinceLastRelease: number|null, ageDays: number|null, deprecated: boolean}|null}
 */
export function assessPackage(pkgData, now = Date.now()) {
  const versions = pkgData && Array.isArray(pkgData.versions) ? pkgData.versions : null;
  if (!versions || versions.length === 0) return null;

  const latest = versions.find(v => v && v.isDefault) || versions[versions.length - 1];
  const latestPublished = latest && latest.publishedAt ? Date.parse(latest.publishedAt) : NaN;

  const publishedTimes = versions
    .map(v => (v && v.publishedAt ? Date.parse(v.publishedAt) : NaN))
    .filter(t => !Number.isNaN(t));
  const firstPublished = publishedTimes.length ? Math.min(...publishedTimes) : NaN;

  return {
    latestVersion: latest?.versionKey?.version ?? null,
    releaseCount: versions.length,
    daysSinceLastRelease: Number.isNaN(latestPublished) ? null : Math.floor((now - latestPublished) / DAY_MS),
    ageDays: Number.isNaN(firstPublished) ? null : Math.floor((now - firstPublished) / DAY_MS),
    deprecated: Boolean(latest && latest.isDeprecated)
  };
}

/**
 * Summarize a deps.dev version response into license/advisory/provenance signals.
 * @param {{licenses?: string[], advisoryKeys?: any[], slsaProvenances?: any[], attestations?: any[], relatedProjects?: Array<{projectKey?: {id?: string}}>}} vData
 * @returns {{license: string|null, advisoryCount: number, hasProvenance: boolean, projectId: string|null}}
 */
export function assessVersion(vData) {
  const licenses = Array.isArray(vData?.licenses) ? vData.licenses : [];
  const advisoryKeys = Array.isArray(vData?.advisoryKeys) ? vData.advisoryKeys : [];
  const slsaProvenances = Array.isArray(vData?.slsaProvenances) ? vData.slsaProvenances : [];
  const attestations = Array.isArray(vData?.attestations) ? vData.attestations : [];
  const relatedProjects = Array.isArray(vData?.relatedProjects) ? vData.relatedProjects : [];

  return {
    license: licenses.length ? licenses.join(' OR ') : null,
    advisoryCount: advisoryKeys.length,
    hasProvenance: slsaProvenances.length > 0 || attestations.length > 0,
    projectId: relatedProjects[0]?.projectKey?.id ?? null
  };
}

/**
 * Summarize a deps.dev project response into repo-health signals.
 * @param {{starsCount?: number, forksCount?: number, openIssuesCount?: number, scorecard?: {overallScore?: number}}} pData
 * @returns {{stars: number|null, forks: number|null, openIssues: number|null, scorecard: number|null}}
 */
export function assessProject(pData) {
  return {
    stars: pData?.starsCount ?? null,
    forks: pData?.forksCount ?? null,
    openIssues: pData?.openIssuesCount ?? null,
    scorecard: pData?.scorecard?.overallScore ?? null
  };
}

/**
 * Summarize an OSV.dev query response.
 * @param {{vulns?: Array<{id?: string}>}} osvData
 * @returns {{vulnCount: number, vulnIds: string[]}}
 */
export function assessOsv(osvData) {
  const vulns = Array.isArray(osvData?.vulns) ? osvData.vulns : [];
  return {
    vulnCount: vulns.length,
    vulnIds: vulns.map(v => v?.id).filter(Boolean)
  };
}

/**
 * Summarize npm-specific signals from a registry packument and a downloads response.
 * @param {any} packument
 * @param {any} downloadsData
 * @param {number} [now]
 * @returns {{monthlyDownloads: number|null, maintainerCount: number|null, hasInstallScripts: boolean, latestPublishedAt: string|null}}
 */
export function assessNpmExtras(packument, downloadsData, now = Date.now()) {
  const latestTag = packument?.['dist-tags']?.latest ?? null;
  const latestVersion = latestTag ? packument?.versions?.[latestTag] : null;
  const scripts = latestVersion?.scripts ?? {};

  return {
    monthlyDownloads: downloadsData?.downloads ?? null,
    maintainerCount: Array.isArray(packument?.maintainers) ? packument.maintainers.length : null,
    hasInstallScripts: Boolean(scripts.preinstall || scripts.install || scripts.postinstall),
    latestPublishedAt: (latestTag && packument?.time?.[latestTag]) || null
  };
}

/**
 * Classify an SPDX-ish license expression into a coarse reuse-risk bucket.
 * @param {string|null|undefined} expr
 * @returns {'permissive'|'weak-copyleft'|'strong-copyleft'|'unknown'}
 */
export function classifyLicense(expr) {
  if (!expr || typeof expr !== 'string') return 'unknown';
  const norm = expr.toUpperCase();

  if (norm.includes('AGPL')) return 'strong-copyleft';
  if (norm.includes('GPL') && !norm.includes('LGPL')) return 'strong-copyleft';
  if (norm.includes('LGPL') || norm.includes('MPL') || norm.includes('EPL') || norm.includes('CDDL')) return 'weak-copyleft';
  if (
    norm.includes('MIT') ||
    norm.includes('ISC') ||
    norm.includes('BSD') ||
    norm.includes('APACHE') ||
    norm.includes('0BSD') ||
    norm.includes('UNLICENSE') ||
    norm.includes('CC0') ||
    norm.includes('ZLIB') ||
    norm.includes('PSF')
  ) {
    return 'permissive';
  }

  return 'unknown';
}

/**
 * Turn assessed signals into ordered risk/info flags (high, then warn, then info).
 * @param {{deprecated?: boolean, vulnCount?: number, vulnIds?: string[], advisoryCount?: number,
 *   daysSinceLastRelease?: number|null, maintainerCount?: number|null, hasInstallScripts?: boolean,
 *   scorecard?: number|null, license?: string|null, monthlyDownloads?: number|null}} signals
 * @param {string|null} [projectLicense]
 * @returns {Array<{level: 'high'|'warn'|'info', code: string, message: string}>}
 */
export function deriveFlags(signals, projectLicense = null) {
  const s = signals || {};
  const flags = [];

  if (s.deprecated) {
    flags.push({ level: 'high', code: 'deprecated', message: 'Package is deprecated by its publisher.' });
  }
  if (s.vulnCount > 0) {
    const ids = (Array.isArray(s.vulnIds) ? s.vulnIds : []).slice(0, 3);
    flags.push({ level: 'high', code: 'known-vulnerabilities', message: `Known vulnerabilities (${s.vulnCount}): ${ids.join(', ')}.` });
  }
  if (s.advisoryCount > 0 && s.vulnCount === 0) {
    flags.push({ level: 'warn', code: 'advisories', message: `${s.advisoryCount} advisory record(s) with no confirmed OSV vulnerabilities.` });
  }
  if (s.daysSinceLastRelease > 540) {
    flags.push({ level: 'warn', code: 'stale-release', message: `No release in ${s.daysSinceLastRelease} days.` });
  }
  if (s.maintainerCount !== null && s.maintainerCount <= 1) {
    flags.push({ level: 'warn', code: 'bus-factor', message: `Only ${s.maintainerCount} maintainer(s) listed.` });
  }
  if (s.hasInstallScripts) {
    flags.push({ level: 'warn', code: 'install-scripts', message: 'Runs preinstall/install/postinstall scripts.' });
  }
  if (s.scorecard !== null && s.scorecard < 4) {
    flags.push({ level: 'warn', code: 'low-scorecard', message: `OpenSSF Scorecard is ${s.scorecard} (below 4).` });
  }
  if (classifyLicense(s.license) === 'strong-copyleft' && classifyLicense(projectLicense) === 'permissive') {
    flags.push({ level: 'warn', code: 'license-conflict', message: `${s.license} is strong-copyleft; project license is permissive.` });
  }
  if (s.monthlyDownloads !== null && s.monthlyDownloads < 1000) {
    flags.push({ level: 'info', code: 'low-adoption', message: `${s.monthlyDownloads} downloads/month.` });
  }
  if (s.license == null) {
    flags.push({ level: 'info', code: 'no-license-metadata', message: 'No license metadata found.' });
  }

  return flags;
}

/**
 * Render the one-line evidence summary for a dependency assessment.
 * @param {string} name
 * @param {string} system
 * @param {Record<string, any>} signals
 * @param {Array<{level: string, code: string, message: string}>} flags
 * @returns {string}
 */
export function buildEvidenceLine(name, system, signals, flags) {
  const s = signals || {};
  const val = v => (v === null || v === undefined ? '?' : v);
  const flagList = Array.isArray(flags) && flags.length ? flags.map(f => f.code).join(', ') : 'none';
  const today = new Date().toISOString().slice(0, 10);

  return `Evidence: ${system}:${name}@${val(s.latestVersion)} — released ${val(s.daysSinceLastRelease)}d ago, ` +
    `${val(s.releaseCount)} releases, ${val(s.stars)}★, scorecard ${val(s.scorecard)}, license ${val(s.license)}, ` +
    `vulns ${val(s.vulnCount)}, downloads/mo ${val(s.monthlyDownloads)}; flags: ${flagList}. ` +
    `(source: deps.dev/OSV, ${today})`;
}
