// Package-registry search channels for `pa search`.
//
// npm and crates.io expose keyless search APIs; PyPI does not (its XML-RPC
// search was retired), so the pypi ecosystem is reported as a skipped
// channel rather than silently omitted — coverage honesty applies to our
// own pipeline first.

import { cachedFetchJson } from '../data/cache.js';

const SEARCH_TTL_MS = 3600000;

export function buildNpmSearchUrl(need, limit) {
  return `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(String(need).trim())}&size=${limit}`;
}

export function buildCratesSearchUrl(need, limit) {
  return `https://crates.io/api/v1/crates?q=${encodeURIComponent(String(need).trim())}&per_page=${limit}`;
}

/** Normalize npm search payload into candidate rows. */
export function normalizeNpmResults(data) {
  const objects = (data && Array.isArray(data.objects)) ? data.objects : [];
  return objects.map(o => ({
    name: o.package && o.package.name,
    version: o.package && o.package.version,
    description: ((o.package && o.package.description) || '').slice(0, 120),
    signal: o.score && typeof o.score.final === 'number' ? `score ${o.score.final.toFixed(1)}` : '',
    updatedAt: ((o.package && o.package.date) || '').slice(0, 10),
    url: o.package && o.package.links && (o.package.links.repository || o.package.links.npm)
  })).filter(r => r.name);
}

/** Normalize crates.io search payload into candidate rows. */
export function normalizeCratesResults(data) {
  const crates = (data && Array.isArray(data.crates)) ? data.crates : [];
  return crates.map(c => ({
    name: c.name,
    version: c.max_version,
    description: (c.description || '').slice(0, 120),
    // crates has no relevance score; downloads is the adoption signal
    signal: c.downloads != null ? `${c.downloads.toLocaleString('en-US')} dl` : '',
    updatedAt: (c.updated_at || '').slice(0, 10),
    url: c.repository || `https://crates.io/crates/${c.name}`
  })).filter(r => r.name);
}

/**
 * Search the package registry for the given ecosystem.
 * @param {string} eco - 'npm' | 'cargo' | 'pypi' | others
 * @param {string} need
 * @param {{limit?: number, fresh?: boolean}} [opts]
 * @returns {Promise<{status: 'ok'|'skipped', reason?: string, registry?: string, results: Array<object>}>}
 */
export async function searchRegistry(eco, need, { limit = 8, fresh = false } = {}) {
  try {
    if (eco === 'npm') {
      const res = await cachedFetchJson(buildNpmSearchUrl(need, limit), { ttlMs: SEARCH_TTL_MS, fresh });
      return { status: 'ok', registry: 'npm', results: normalizeNpmResults(res.data) };
    }
    if (eco === 'cargo') {
      const res = await cachedFetchJson(buildCratesSearchUrl(need, limit), { ttlMs: SEARCH_TTL_MS, fresh });
      return { status: 'ok', registry: 'crates.io', results: normalizeCratesResults(res.data) };
    }
    if (eco === 'pypi') {
      return { status: 'skipped', registry: 'pypi', reason: 'PyPI has no keyless search API — try GitHub results or `pa report <pkg> --eco pypi` for a known name', results: [] };
    }
    return { status: 'skipped', registry: eco, reason: `registry search not implemented for "${eco}" yet (npm|cargo supported)`, results: [] };
  } catch (err) {
    return { status: 'skipped', registry: eco, reason: `registry unreachable (${String(err && err.message || err).slice(0, 80)})`, results: [] };
  }
}
