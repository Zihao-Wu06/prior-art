// Repo-internal search channel: before reaching for the outside world, check
// whether this project already contains something related — the ladder's
// cheapest rung after do-nothing.

import { readFileSync } from 'node:fs';
import { collectSourceFiles } from '../audit/scanner.js';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'over',
  'need', 'want', 'have', 'add', 'get', 'set', 'use', 'can', 'how'
]);

const DEF_LINE = /(^|\s)(function\s+\w|const\s+\w+\s*=\s*(async\s*)?(\(|function|[A-Za-z_$][\w$]*\s*=>)|def\s+\w|class\s+\w)/;
const MAX_HITS = 5;

/** Tokenize a natural-language need into search tokens. */
export function tokenizeNeed(need) {
  return [...new Set(
    String(need).toLowerCase().split(/[^a-z0-9]+/)
      .filter(t => t.length > 2 && !STOPWORDS.has(t))
  )];
}

/**
 * Scan the project's own sources for definition lines related to the need.
 * @param {string} rootDir
 * @param {string} need
 * @returns {{status: 'ok'|'skipped', reason?: string, filesScanned: number, results: Array<{file: string, line: number, snippet: string}>}}
 */
export function searchRepo(rootDir, need) {
  const tokens = tokenizeNeed(need);
  if (!tokens.length) {
    return { status: 'skipped', reason: 'no usable tokens in the query', filesScanned: 0, results: [] };
  }
  // A hit needs every token for 1-2 token queries, or ≥2 tokens for longer ones.
  const required = tokens.length <= 2 ? tokens.length : 2;

  const { files } = collectSourceFiles(rootDir, {});
  const results = [];
  for (const file of files) {
    if (results.length >= MAX_HITS) break;
    let content;
    try {
      content = readFileSync(file.path, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && results.length < MAX_HITS; i++) {
      if (!DEF_LINE.test(lines[i])) continue;
      const lower = lines[i].toLowerCase();
      const hits = tokens.filter(t => lower.includes(t)).length;
      if (hits >= required) {
        results.push({ file: file.rel, line: i + 1, snippet: lines[i].trim().slice(0, 140) });
      }
    }
  }
  return { status: 'ok', filesScanned: files.length, results };
}
