// PR-time orchestrator: parse a unified diff, flag new dependencies that lack a
// decision note, and surface reinvented wheels — but only the ones introduced
// by THIS diff. All IO (git, spawning the audit) is injectable so the core is
// testable without a network or a working tree.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAddedDependencies, collectChangedSourceFiles, extractAddedLines } from './diff.js';
import { renderSummary, decideExit } from './render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = join(HERE, '..', 'cli', 'index.js');

/** Keywords whose proximity to a package name we treat as a documented decision. */
const DECISION_KEYWORDS = /decision|reuse|build/i;
const PROXIMITY = 120;

/**
 * A new dependency is "documented" when its name appears within ~120 chars of a
 * decision keyword anywhere in the supplied text (PR body + commit messages).
 * Pure and case-insensitive; uses substring search so scoped/namespaced names
 * (`@scope/pkg`, `github.com/x/y`) are matched literally, never as a regex.
 * @param {{name: string}} dep
 * @param {string} decisionText
 * @returns {boolean}
 */
export function isDocumented(dep, decisionText) {
  if (!dep || !dep.name) return false;
  const text = String(decisionText || '');
  if (!text) return false;
  const hay = text.toLowerCase();
  const needle = dep.name.toLowerCase();
  if (!needle) return false;
  for (let idx = hay.indexOf(needle); idx !== -1; idx = hay.indexOf(needle, idx + 1)) {
    const window = text.slice(Math.max(0, idx - PROXIMITY), idx + needle.length + PROXIMITY);
    if (DECISION_KEYWORDS.test(window)) return true;
  }
  return false;
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
  const needle = dep.name.toLowerCase();
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    try {
      if (readFileSync(join(dir, f), 'utf8').toLowerCase().includes(needle)) return true;
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

  // 1. New dependencies and whether each is backed by a decision.
  const addedDeps = parseAddedDependencies(diff);
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
