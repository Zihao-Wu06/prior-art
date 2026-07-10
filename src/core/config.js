// Project config: a single `.prior-art.json`, discovered by walking up from
// the working directory. Loading must never throw — a broken config file is
// a degraded state (reported via `_error`), not a crash.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** @typedef {{sensitivity: string, priorities: string[], alwaysBuild: string[], alwaysReuse: string[]}} Config */

/** @type {Config} */
export const DEFAULTS = {
  // off: silent | light: session context only | standard: + prompt gate | strict: + write nudge
  sensitivity: 'light',
  priorities: [],
  alwaysBuild: [],
  alwaysReuse: []
};

export const SENSITIVITY_LEVELS = ['off', 'light', 'standard', 'strict'];

/**
 * Walk up from startDir to the filesystem root looking for `.prior-art.json`,
 * merge it over DEFAULTS, and return the result. Never throws.
 * @param {string} [startDir]
 * @returns {Config & {_path: string|null, _error?: string}}
 */
export function loadConfig(startDir = process.cwd()) {
  let dir = resolve(startDir);
  let path = null;
  for (;;) {
    const candidate = join(dir, '.prior-art.json');
    if (existsSync(candidate)) {
      path = candidate;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (!path) return { ...DEFAULTS, _path: null };

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const merged = { ...DEFAULTS, ...parsed, _path: path };
    if (parsed.sensitivity !== undefined) {
      const norm = String(parsed.sensitivity).toLowerCase();
      if (SENSITIVITY_LEVELS.includes(norm)) {
        merged.sensitivity = norm;
      } else {
        merged.sensitivity = DEFAULTS.sensitivity;
        merged._warning = `invalid sensitivity "${parsed.sensitivity}" — using "${DEFAULTS.sensitivity}" (valid: ${SENSITIVITY_LEVELS.join('|')})`;
      }
    }
    return merged;
  } catch (err) {
    // Keep the discovered path: a malformed config still anchors the project
    // root, so ledger/ADR writes from a subdir don't split into a second copy.
    return { ...DEFAULTS, _path: path, _error: err.message };
  }
}

/**
 * The project root is the directory owning `.prior-art.json` (walking up),
 * falling back to startDir when no config exists. Every command that writes
 * project state (the ledger, ADRs) must resolve through this so that a run
 * from `src/` can never create a second ledger or decisions dir.
 * @param {string} [startDir]
 * @returns {string}
 */
export function findProjectRoot(startDir = process.cwd()) {
  const cfg = loadConfig(startDir);
  return cfg._path ? dirname(cfg._path) : resolve(startDir);
}
