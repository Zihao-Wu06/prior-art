// GitHub repository search channel for `pa search`.
//
// Keyless by default (10 search requests/min unauthenticated); when
// GITHUB_TOKEN or GH_TOKEN is set we send it and the cap rises ~30x.
// A rate-limited or failed call degrades to a skipped channel with a
// reason — never to a crash, and never to a silent "nothing exists".

import { cachedFetchJson } from '../data/cache.js';

const SEARCH_TTL_MS = 3600000; // search results age fast; cache 1h, not 24h

/** Build the GitHub search URL for a natural-language need. */
export function buildGitHubSearchUrl(need, limit) {
  const q = encodeURIComponent(String(need).trim());
  return `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${limit}`;
}

/** Normalize the GitHub search-API payload into candidate rows. */
export function normalizeGitHubResults(data) {
  const items = (data && Array.isArray(data.items)) ? data.items : [];
  return items.map(r => ({
    fullName: r.full_name,
    stars: r.stargazers_count ?? 0,
    description: (r.description || '').slice(0, 120),
    updatedAt: (r.pushed_at || '').slice(0, 10),
    license: (r.license && r.license.spdx_id && r.license.spdx_id !== 'NOASSERTION') ? r.license.spdx_id : null,
    archived: Boolean(r.archived),
    url: r.html_url
  }));
}

/**
 * Search GitHub repositories for existing solutions.
 * @param {string} need
 * @param {{limit?: number, fresh?: boolean}} [opts]
 * @returns {Promise<{status: 'ok'|'skipped', reason?: string, totalCount?: number, results: Array<object>}>}
 */
export async function searchGitHubRepos(need, { limit = 8, fresh = false } = {}) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const res = await cachedFetchJson(buildGitHubSearchUrl(need, limit), { ttlMs: SEARCH_TTL_MS, fresh, headers });
    if (res.status === 404 || !res.data) {
      return { status: 'skipped', reason: 'GitHub search returned no payload', results: [] };
    }
    return { status: 'ok', totalCount: res.data.total_count ?? null, results: normalizeGitHubResults(res.data) };
  } catch (err) {
    const msg = String(err && err.message || err);
    const reason = /403|429|rate/i.test(msg)
      ? 'GitHub rate limit hit (unauthenticated cap is 10 searches/min — set GITHUB_TOKEN to raise it)'
      : `GitHub unreachable (${msg.slice(0, 80)})`;
    return { status: 'skipped', reason, results: [] };
  }
}
