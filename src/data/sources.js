// Thin fetchers over cache.js for deps.dev, OSV.dev, and the npm registry.
// No assessment logic lives here -- see assess.js for the pure derivations.

import { cachedFetchJson } from './cache.js';

const DEPS_DEV_BASE = 'https://api.deps.dev/v3';
const OSV_QUERY_URL = 'https://api.osv.dev/v1/query';
const NPM_REGISTRY_BASE = 'https://registry.npmjs.org';
const NPM_DOWNLOADS_BASE = 'https://api.npmjs.org/downloads/point/last-month';

/** Ecosystem name mapping: our system id -> deps.dev system id / OSV ecosystem. */
export const SYSTEMS = {
  npm: { depsdev: 'npm', osv: 'npm' },
  pypi: { depsdev: 'pypi', osv: 'PyPI' },
  go: { depsdev: 'go', osv: 'Go' },
  maven: { depsdev: 'maven', osv: 'Maven' },
  cargo: { depsdev: 'cargo', osv: 'crates.io' },
  nuget: { depsdev: 'nuget', osv: 'NuGet' },
  rubygems: { depsdev: 'rubygems', osv: 'RubyGems' }
};

function requireSystem(system) {
  const entry = SYSTEMS[system];
  if (!entry) throw new Error(`unknown system: ${system}`);
  return entry;
}

/** npm registry path-segment encoding: only scoped names need the '/' escaped. */
function encodeNpmName(name) {
  return name.startsWith('@') ? name.replace('/', '%2F') : name;
}

/**
 * Fetch package metadata (all versions) from deps.dev.
 * @param {string} system
 * @param {string} name
 * @param {{fresh?: boolean}} [opts]
 * @returns {Promise<{status: number, data: any, fromCache: boolean}>}
 */
export async function fetchPackage(system, name, opts = {}) {
  const sys = requireSystem(system).depsdev;
  const url = `${DEPS_DEV_BASE}/systems/${sys}/packages/${encodeURIComponent(name)}`;
  return cachedFetchJson(url, opts);
}

/**
 * Fetch a single version's metadata from deps.dev.
 * @param {string} system
 * @param {string} name
 * @param {string} version
 * @param {{fresh?: boolean}} [opts]
 * @returns {Promise<{status: number, data: any, fromCache: boolean}>}
 */
export async function fetchVersion(system, name, version, opts = {}) {
  const sys = requireSystem(system).depsdev;
  const url = `${DEPS_DEV_BASE}/systems/${sys}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
  return cachedFetchJson(url, opts);
}

/**
 * Fetch project metadata (stars, forks, scorecard, ...) from deps.dev.
 * @param {string} projectId
 * @param {{fresh?: boolean}} [opts]
 * @returns {Promise<{status: number, data: any, fromCache: boolean}>}
 */
export async function fetchProject(projectId, opts = {}) {
  const url = `${DEPS_DEV_BASE}/projects/${encodeURIComponent(projectId)}`;
  return cachedFetchJson(url, opts);
}

/**
 * Query OSV.dev for known vulnerabilities affecting a package.
 * @param {string} system
 * @param {string} name
 * @param {{fresh?: boolean}} [opts]
 * @returns {Promise<{status: number, data: any, fromCache: boolean}>}
 */
export async function queryOsv(system, name, opts = {}) {
  const ecosystem = requireSystem(system).osv;
  return cachedFetchJson(OSV_QUERY_URL, {
    ...opts,
    method: 'POST',
    body: { package: { name, ecosystem } }
  });
}

/**
 * Fetch the full npm packument (versions, dist-tags, time, maintainers).
 * @param {string} name
 * @param {{fresh?: boolean}} [opts]
 * @returns {Promise<{status: number, data: any, fromCache: boolean}>}
 */
export async function fetchNpmPackument(name, opts = {}) {
  const url = `${NPM_REGISTRY_BASE}/${encodeNpmName(name)}`;
  return cachedFetchJson(url, opts);
}

/**
 * Fetch last-month download counts from the npm API.
 * @param {string} name
 * @param {{fresh?: boolean}} [opts]
 * @returns {Promise<{status: number, data: any, fromCache: boolean}>}
 */
export async function fetchNpmDownloads(name, opts = {}) {
  const url = `${NPM_DOWNLOADS_BASE}/${encodeNpmName(name)}`;
  return cachedFetchJson(url, opts);
}
