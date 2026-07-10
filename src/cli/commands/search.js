import { resolve as resolvePath } from 'node:path';
import { searchGitHubRepos } from '../../search/github.js';
import { searchRegistry } from '../../search/registries.js';
import { searchRepo } from '../../search/local.js';

const DEFAULT_LIMIT = 8;

/**
 * Prior-art discovery: search the repo, the package registry, and GitHub for
 * existing solutions to a described need.
 * @param {string} need - Natural-language capability description.
 * @param {Record<string, string|boolean>} opts - {eco, limit, json, fresh, dir}
 */
export async function run(need, opts) {
  const eco = String(opts.eco || 'npm');
  const limit = clampLimit(opts.limit);
  const rootDir = resolvePath(String(opts.dir || process.cwd()));

  // Channels run concurrently; each degrades to a skipped entry on failure.
  const [repo, registry, github] = await Promise.all([
    Promise.resolve().then(() => searchRepo(rootDir, need)),
    searchRegistry(eco, need, { limit, fresh: !!opts.fresh }),
    searchGitHubRepos(need, { limit, fresh: !!opts.fresh })
  ]);

  const notSearched = [
    'knowledge packs (ships later in v0.3)',
    'installed-capability index (ships later in v0.3)'
  ];

  if (opts.json) {
    console.log(JSON.stringify({
      need,
      ecosystem: eco,
      channels: { repo, registry, github },
      coverage: { notSearched }
    }, null, 2));
    return;
  }

  console.log(renderHuman({ need, eco, limit, repo, registry, github, notSearched }));
}

function clampLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(20, Math.floor(n)));
}

function pad(s, w) {
  return String(s).padEnd(w);
}

function renderHuman({ need, eco, repo, registry, github, notSearched }) {
  const lines = [];
  lines.push('Prior Art — prior-art search');
  lines.push(`need: "${need}"  ·  ecosystem: ${eco}`);
  lines.push('');

  // Rung 0: does this repo already have something related?
  lines.push('This repo:');
  if (repo.status !== 'ok') {
    lines.push(`  (skipped: ${repo.reason})`);
  } else if (!repo.results.length) {
    lines.push(`  nothing related found in ${repo.filesScanned} source files.`);
  } else {
    for (const r of repo.results) {
      lines.push(`  ${r.file}:${r.line}  ${r.snippet}`);
    }
    lines.push(`  ↑ related code already exists here — read it before building or adding anything.${repo.capped ? ' (stopped at 5 hits; more may exist)' : ''}`);
  }
  lines.push('');

  lines.push(`Registry (${registry.registry || eco}):`);
  if (registry.status !== 'ok') {
    lines.push(`  (skipped: ${registry.reason})`);
  } else if (!registry.results.length) {
    lines.push('  no matches.');
  } else {
    const nameW = Math.max(...registry.results.map(r => r.name.length), 4);
    for (const r of registry.results) {
      lines.push(`  ${pad(r.name, nameW)}  ${pad(r.signal || '', 14)} ${pad(r.updatedAt || '', 11)} ${r.description}`);
    }
    lines.push(`  → vet a candidate before adopting: pa report <name>${eco === 'npm' ? '' : ` --eco ${eco}`}`);
  }
  lines.push('');

  lines.push('GitHub:');
  if (github.status !== 'ok') {
    lines.push(`  (skipped: ${github.reason})`);
  } else if (!github.results.length) {
    lines.push('  no matches.');
  } else {
    const nameW = Math.max(...github.results.map(r => r.fullName.length), 4);
    for (const r of github.results) {
      const flags = r.archived ? '  [ARCHIVED]' : '';
      lines.push(`  ${pad(r.fullName, nameW)}  ⭐ ${pad(formatStars(r.stars), 7)} ${pad(r.updatedAt || '', 11)} ${pad(r.license || '?', 12)} ${r.description}${flags}`);
    }
  }
  lines.push('');

  const searched = [
    repo.status === 'ok' ? `repo (${repo.filesScanned} js/py files — other languages not scanned locally${repo.capped ? '; hit cap reached' : ''})` : null,
    registry.status === 'ok' ? `${registry.registry} registry (top ${registry.results.length})` : null,
    github.status === 'ok' ? `GitHub (top ${github.results.length}${github.totalCount ? ` of ${github.totalCount}` : ''})` : null
  ].filter(Boolean);
  const skipped = [
    repo.status !== 'ok' ? `repo (${repo.reason})` : null,
    registry.status !== 'ok' ? `${registry.registry || eco} registry (${registry.reason})` : null,
    github.status !== 'ok' ? `GitHub (${github.reason})` : null,
    ...notSearched
  ].filter(Boolean);

  lines.push(`Coverage: searched ${searched.length ? searched.join(', ') : 'nothing'}. Skipped: ${skipped.join('; ')}.`);
  lines.push('An empty channel means "no match found there", never "no solution exists" — check the skipped list before concluding.');
  lines.push('Decide with the ladder: adopt / extend / compose — or build, informed by what you found. Record it: pa adr new "<title>".');
  return lines.join('\n');
}

function formatStars(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
