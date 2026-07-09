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
    return { ...DEFAULTS, ...parsed, _path: path };
  } catch (err) {
    return { ...DEFAULTS, _path: null, _error: err.message };
  }
}
