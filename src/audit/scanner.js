// Source-file collection and per-file candidate scanning for `pa audit`.
//
// Firing contract (mirrors the header of patterns.js):
//   nameOnly: true  — a name match fires alone; each bodyHint also fires alone.
//   nameOnly: false — a name match fires only with a bodyHint in the following
//                     window; bodyHints never fire alone.

import { readdirSync, statSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';

export const DEFAULT_IGNORE_DIRS = [
  'node_modules', '.git', 'dist', 'build', 'out', 'vendor',
  'venv', '.venv', '__pycache__', 'coverage', '.next', '.nuxt', '.cache', '.prior-art'
];

const JS_EXT = /\.(m?[jt]s|c[jt]s|jsx|tsx)$/;
const DECL_EXT = /\.d\.(ts|mts|cts)$/;
const TEST_PATH = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z]+$|(^|\/)conftest\.py$/;

// Keywords that the loose method-form name extractor would otherwise catch.
const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'async',
  'await', 'else', 'do', 'try', 'new', 'typeof', 'delete', 'void', 'yield', 'constructor'
]);

// Files can opt out of the audit entirely (pattern catalogs, generated code,
// fixtures that quote wheel signatures on purpose) with a marker comment in
// the first few lines: `prior-art: ignore-file`.
const IGNORE_MARKER = /prior-art:\s*ignore-file/i;
const IGNORE_MARKER_WINDOW = 10;

const HINT_WINDOW = 40;   // lines a name-gated pattern searches for corroboration
const MAX_PER_PATTERN_PER_FILE = 3;
const SNIPPET_MAX = 160;

/**
 * Recursively collect auditable source files.
 * @param {string} rootDir
 * @param {{includeTests?: boolean, maxFiles?: number, maxFileBytes?: number}} [opts]
 * @returns {{files: Array<{path: string, rel: string, lang: string}>, truncated: boolean}}
 */
export function collectSourceFiles(rootDir, { includeTests = false, maxFiles = 4000, maxFileBytes = 524288 } = {}) {
  const files = [];
  let truncated = false;

  const walk = dir => {
    if (truncated) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;
        try {
          if (lstatSync(full).isSymbolicLink()) continue;   // avoid cycles
        } catch {
          continue;
        }
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      let lang = null;
      if (JS_EXT.test(entry.name) && !DECL_EXT.test(entry.name)) lang = 'js';
      else if (entry.name.endsWith('.py')) lang = 'py';
      if (!lang) continue;

      const rel = relative(rootDir, full);
      if (!includeTests && TEST_PATH.test(rel)) continue;

      try {
        if (statSync(full).size > maxFileBytes) continue;
      } catch {
        continue;
      }

      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      files.push({ path: full, rel, lang });
    }
  };

  walk(rootDir);
  return { files, truncated };
}

/** Extract candidate function names defined on a line. */
function extractNames(line, lang) {
  const names = [];
  if (lang === 'py') {
    const m = line.match(/^\s*def\s+([a-z_][\w]*)\s*\(/i);
    if (m) names.push(m[1]);
    return names;
  }
  for (const re of [
    /(?:^|\s)function\s+([A-Za-z_$][\w$]*)\s*\(/,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/,
    /([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?function\b/,
    /^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/   // class/object method form (noisy → keyword-filtered)
  ]) {
    const m = line.match(re);
    if (m && !JS_KEYWORDS.has(m[1])) names.push(m[1]);
  }
  return names;
}

/** Rough size of the block starting at line index `start` (0-based). */
function estimateBlockLines(lines, start, lang) {
  const cap = Math.min(lines.length, start + 60);
  if (lang === 'py') {
    const defIndent = lines[start].match(/^\s*/)[0].length;
    let sawBody = false;
    for (let i = start + 1; i < cap; i++) {
      if (!lines[i].trim()) continue;
      const indent = lines[i].match(/^\s*/)[0].length;
      if (indent > defIndent) {
        sawBody = true;
        continue;
      }
      if (sawBody && indent <= defIndent) return Math.max(1, i - start);
    }
    return Math.max(1, cap - start);
  }
  let balance = 0;
  let opened = false;
  for (let i = start; i < cap; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { balance++; opened = true; }
      else if (ch === '}') balance--;
    }
    if (opened && balance <= 0) return Math.max(1, i - start + 1);
  }
  return Math.max(1, cap - start);
}

function makeMatch(patternId, lines, lineIdx, name, via, lang, blockLines) {
  return {
    patternId,
    line: lineIdx + 1,
    name,
    snippet: lines[lineIdx].trim().slice(0, SNIPPET_MAX),
    via,
    blockLines: blockLines ?? estimateBlockLines(lines, lineIdx, lang)
  };
}

/**
 * Scan one file's content against the pattern catalog for its language.
 * @param {string} content
 * @param {string} lang - 'js' | 'py'
 * @param {Array<object>} patterns - patterns for this lang (see patterns.js schema)
 * @returns {Array<{patternId: string, line: number, name: string|null, snippet: string, via: string, blockLines: number}>}
 */
export function scanFile(content, lang, patterns) {
  const lines = content.split('\n');
  for (let i = 0; i < Math.min(lines.length, IGNORE_MARKER_WINDOW); i++) {
    if (IGNORE_MARKER.test(lines[i])) return [];
  }
  const matches = [];
  const countByPattern = new Map();
  const claimedLines = new Set();   // `${patternId}:${line}` already reported

  const push = match => {
    const n = countByPattern.get(match.patternId) || 0;
    if (n >= MAX_PER_PATTERN_PER_FILE) return;
    countByPattern.set(match.patternId, n + 1);
    // Claim the whole block: one wheel is one finding, even when both the
    // name and a body hint inside the same function would match.
    for (let l = match.line; l < match.line + match.blockLines; l++) {
      claimedLines.add(`${match.patternId}:${l}`);
    }
    matches.push(match);
  };

  // Pass 1 — name-based firing.
  for (let i = 0; i < lines.length; i++) {
    const names = extractNames(lines[i], lang);
    if (!names.length) continue;
    for (const pattern of patterns) {
      if (!pattern.namePattern) continue;
      const name = names.find(n => pattern.namePattern.test(n));
      if (!name) continue;
      if (pattern.nameOnly) {
        push(makeMatch(pattern.id, lines, i, name, 'name', lang));
        continue;
      }
      // Corroboration must come from THIS function's body: cap the search
      // window to the estimated block so a hint in the next function can
      // never validate an unrelated generic name.
      const block = estimateBlockLines(lines, i, lang);
      const windowEnd = Math.min(lines.length, i + Math.min(block, HINT_WINDOW));
      let corroborated = false;
      for (let j = i; j < windowEnd && !corroborated; j++) {
        corroborated = pattern.bodyHints.some(h => h.test(lines[j]));
      }
      if (corroborated) {
        push(makeMatch(pattern.id, lines, i, name, 'name+body', lang, block));
      }
    }
  }

  // Pass 2 — body-only firing, exclusively for nameOnly patterns whose hints
  // are unambiguous alone. A name fire elsewhere in the file does not suppress
  // a distinct wheel site; only the exact same line is deduplicated.
  for (const pattern of patterns) {
    if (!pattern.nameOnly || !pattern.bodyHints.length) continue;
    for (let i = 0; i < lines.length; i++) {
      if (claimedLines.has(`${pattern.id}:${i + 1}`)) continue;
      if (pattern.bodyHints.some(h => h.test(lines[i]))) {
        push(makeMatch(pattern.id, lines, i, null, 'body', lang));
      }
    }
  }

  return matches;
}
