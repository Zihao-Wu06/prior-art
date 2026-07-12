// PR-time orchestrator: parse a unified diff, flag new dependencies that lack a
// decision note, and surface reinvented wheels — but only the ones introduced
// by THIS diff. All IO (git, spawning the audit) is injectable so the core is
// testable without a network or a working tree.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAddedDependencies, collectChangedSourceFiles, extractAddedLines, collectChangedManifests, extractRemovedLines } from './diff.js';
import { parseManifestDeps, lineDeclaresDep } from './manifest.js';
import { renderSummary, decideExit } from './render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = join(HERE, '..', 'cli', 'index.js');

/** Decision keyword, as a WHOLE word — `build` must not match inside `rebuilds`. */
const DECISION_KEYWORDS = /\b(decision|reuse|build)\b/i;
const PROXIMITY = 120;
// Characters that can legitimately appear inside a package name (`@scope/pkg`,
// `github.com/x/y`, `lodash.merge`). A name occurrence is only a real mention
// when it is NOT flanked by one of these — otherwise `ms` matches in `terms`.
const NAME_BOUNDARY = '[a-z0-9@/._+-]';

/** Escape a package name for safe use inside a RegExp. */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A new dependency is "documented" when its name appears — as a whole token,
 * not a substring — within ~120 chars of a whole-word decision keyword in the
 * supplied text (PR body + commit messages). Boundary-anchored so `ms` is not
 * "documented" by `terms` and `build` is not matched inside `rebuilds`.
 * @param {{name: string}} dep
 * @param {string} decisionText
 * @returns {boolean}
 */
export function isDocumented(dep, decisionText) {
  if (!dep || !dep.name) return false;
  const text = String(decisionText || '');
  if (!text) return false;
  const name = dep.name.toLowerCase();
  if (!name) return false;
  let re;
  try {
    re = new RegExp(`(?<!${NAME_BOUNDARY})${escapeRe(name)}(?!${NAME_BOUNDARY})`, 'gi');
  } catch {
    return false;
  }
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const window = text.slice(Math.max(0, m.index - PROXIMITY), m.index + name.length + PROXIMITY);
    if (DECISION_KEYWORDS.test(window)) return true;
  }
  return false;
}

/** Whole-token, case-insensitive test that `text` mentions the package name. */
function mentionsName(text, name) {
  const n = String(name || '').toLowerCase();
  if (!n) return false;
  try {
    return new RegExp(`(?<!${NAME_BOUNDARY})${escapeRe(n)}(?!${NAME_BOUNDARY})`, 'i').test(String(text).toLowerCase());
  } catch {
    return false;
  }
}

/** Does any docs/decisions/*.md under rootDir mention this dependency by name? Tolerant of a missing tree. */
function decisionDocsMention(dep, rootDir) {
  if (!dep || !dep.name || !rootDir) return false;
  const dir = join(rootDir, 'docs', 'decisions');
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    try {
      if (mentionsName(readFileSync(join(dir, f), 'utf8'), dep.name)) return true;
    } catch { /* tolerate */ }
  }
  return false;
}

/** Does the finding's captured source line appear among the file's added lines? */
function findingIsInAddedLines(finding, addedLines) {
  const snip = String(finding.snippet || '').trim();
  if (!snip || !addedLines.length) return false;
  return addedLines.some(line => {
    const norm = line.trim().slice(0, 160);   // mirror scanner's snippet normalization
    return norm === snip || (snip.length >= 12 && norm.includes(snip));
  });
}

/**
 * Added dependencies, reconciled against the real on-disk manifests. The diff
 * parsers only see a hunk's context window, so a dep added deep inside an
 * existing block (opener not in the diff) is invisible to them. Here we read
 * each changed manifest that CI checked out and confirm which of its REAL
 * dependencies were declared on an added line (and not merely bumped) — the
 * robust path — then union with the pure diff-only detections as a fallback
 * when no working tree is available (e.g. tests without a rootDir file).
 * @param {string} diff
 * @param {string} rootDir
 * @returns {Array<{ecosystem: string, name: string, version: string|null, manifest: string}>}
 */
export function reconcileAddedDeps(diff, rootDir) {
  const candidates = [];
  const seen = new Set();
  const push = d => {
    const key = `${d.ecosystem} ${d.name} ${d.manifest}`;
    if (!d.name || seen.has(key)) return;
    seen.add(key);
    candidates.push(d);
  };

  // Two detection paths, unioned: the pure diff parser (works when the block
  // opener is in the diff) and real-manifest reconciliation (works when it is
  // not — the common large-block case). CI has the working tree checked out.
  for (const d of parseAddedDependencies(diff)) push(d);

  if (rootDir) {
    for (const { path, ecosystem } of collectChangedManifests(diff)) {
      let content;
      try {
        content = readFileSync(join(rootDir, path), 'utf8');
      } catch {
        continue;   // no working tree for this file — diff-only detection stands
      }
      const realDeps = parseManifestDeps(content, ecosystem);
      if (!realDeps.size) continue;
      const added = extractAddedLines(diff, path);
      for (const [name, version] of realDeps) {
        if (added.some(l => lineDeclaresDep(l, name, ecosystem))) {
          push({ ecosystem, name, version: version || null, manifest: path });
        }
      }
    }
  }

  // A dependency also declared on a REMOVED line of its manifest is a version
  // bump or a move, not a genuinely new dependency — exclude it uniformly, so
  // both detection paths agree.
  const removedByManifest = new Map();
  return candidates.filter(d => {
    if (!removedByManifest.has(d.manifest)) removedByManifest.set(d.manifest, extractRemovedLines(diff, d.manifest));
    return !removedByManifest.get(d.manifest).some(l => lineDeclaresDep(l, d.name, d.ecosystem));
  });
}

/** Default audit runner: shell out to the project's own `pa audit --json` and return its findings. */
async function defaultAudit({ rootDir }) {
  try {
    const res = spawnSync(process.execPath, [CLI_ENTRY, 'audit', '--dir', rootDir, '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    if (res.error || typeof res.stdout !== 'string') return [];
    const parsed = JSON.parse(res.stdout);
    return Array.isArray(parsed.findings) ? parsed.findings : [];
  } catch {
    return [];   // a broken audit must never break the PR check
  }
}

/**
 * Run the PR review over a unified diff.
 * @param {{diffText?: string, decisionText?: string, rootDir?: string, strict?: boolean, audit?: (ctx: {rootDir: string, changedFiles: Array<{path: string, lang: string}>}) => Promise<Array<object>>}} input
 * @returns {Promise<{exitCode: 0|1, summary: string, addedDeps: Array<object>, undocumentedDeps: Array<object>, findings: Array<object>, notes: string[]}>}
 */
export async function run({ diffText, decisionText, rootDir, strict, audit } = {}) {
  const notes = [];
  const diff = String(diffText || '');
  const decision = String(decisionText || '');
  const root = rootDir || process.cwd();
  const isStrict = Boolean(strict);
  const auditFn = typeof audit === 'function' ? audit : defaultAudit;

  if (!diff.trim()) {
    notes.push('No diff supplied — nothing to review.');
  }

  // 1. New dependencies (reconciled against real manifests) and whether each
  //    is backed by a decision.
  const addedDeps = reconcileAddedDeps(diff, root);
  const undocumentedDeps = addedDeps.filter(
    d => !isDocumented(d, decision) && !decisionDocsMention(d, root)
  );

  // 2. Changed source files → the scope for wheel detection.
  const changedFiles = collectChangedSourceFiles(diff);
  const changedPaths = new Set(changedFiles.map(f => f.path));

  // 3. Run the audit (injected or default) and keep only findings that live in
  //    a changed file AND whose captured line was actually added in this diff.
  let rawFindings = [];
  try {
    rawFindings = await auditFn({ rootDir: root, changedFiles });
    if (!Array.isArray(rawFindings)) rawFindings = [];
  } catch (err) {
    notes.push(`Audit step failed: ${err && err.message ? err.message : 'unknown error'} — continuing without wheel findings.`);
    rawFindings = [];
  }

  const addedByFile = new Map();
  const findings = rawFindings.filter(f => {
    if (!f || !changedPaths.has(f.file)) return false;
    if (!addedByFile.has(f.file)) addedByFile.set(f.file, extractAddedLines(diff, f.file));
    return findingIsInAddedLines(f, addedByFile.get(f.file));
  });
  const highFindings = findings.filter(f => f.level === 'high');

  // 4. Render + decide.
  const summary = renderSummary({ addedDeps, undocumentedDeps, auditFindings: findings, strict: isStrict });
  const body = notes.length ? summary + '\n' + notes.map(n => `> ${n}`).join('\n') + '\n' : summary;
  console.log(body);

  const exitCode = decideExit({ undocumentedDeps, highFindings, strict: isStrict });
  return { exitCode, summary: body, addedDeps, undocumentedDeps, findings, notes };
}
