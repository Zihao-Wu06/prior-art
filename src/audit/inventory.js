// Project inventory for the audit: which languages are present, which
// dependencies are installed, and what runtime we can assume for built-ins.
// Never throws on malformed inputs — a broken manifest degrades to "unknown".

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Normalize a Python requirement line/name to a bare package name. */
function normalizePyName(raw) {
  const name = String(raw)
    .replace(/^\s+|\s+$/g, '')
    .replace(/\[.*?\]/g, '')                      // extras: pkg[extra]
    .split(/[<>=!~;@\s]/)[0]                      // version/marker specifiers
    .toLowerCase()
    .replace(/_/g, '-');
  return name;
}

/** Pull dependency names out of package.json, [] when absent/malformed. */
function readNpmDeps(rootDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
    return [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {})
    ];
  } catch {
    return [];
  }
}

/** Pull dependency names from pyproject.toml + requirements*.txt (tolerant, no TOML parser). */
function readPyDeps(rootDir, manifests) {
  const deps = new Set();

  const pyproject = join(rootDir, 'pyproject.toml');
  if (existsSync(pyproject)) {
    manifests.push('pyproject.toml');
    try {
      const text = readFileSync(pyproject, 'utf8');
      // Grab the [project] dependencies = [ ... ] array and pull quoted strings.
      const m = text.match(/^dependencies\s*=\s*\[([\s\S]*?)\]/m);
      if (m) {
        for (const q of m[1].matchAll(/["']([^"']+)["']/g)) deps.add(normalizePyName(q[1]));
      }
    } catch { /* tolerate */ }
  }

  let entries = [];
  try {
    entries = readdirSync(rootDir);
  } catch { /* tolerate */ }
  for (const f of entries) {
    if (!/^requirements[^/]*\.txt$/.test(f)) continue;
    manifests.push(f);
    try {
      for (const line of readFileSync(join(rootDir, f), 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#') || t.startsWith('-')) continue;
        const name = normalizePyName(t);
        if (name) deps.add(name);
      }
    } catch { /* tolerate */ }
  }

  return [...deps];
}

/**
 * Build the audit inventory for a project directory.
 * @param {string} rootDir
 * @returns {{languages: string[], node: {version: string, major: number}, npmDeps: string[], pyDeps: string[], manifests: string[]}}
 */
export function buildInventory(rootDir) {
  const manifests = [];
  const languages = [];

  const hasPackageJson = existsSync(join(rootDir, 'package.json'));
  if (hasPackageJson) manifests.push('package.json');

  const npmDeps = hasPackageJson ? readNpmDeps(rootDir) : [];
  const pyDeps = readPyDeps(rootDir, manifests);
  const hasPyManifest = manifests.some(m => m !== 'package.json');

  let sawJs = hasPackageJson;
  let sawPy = hasPyManifest || existsSync(join(rootDir, 'setup.py'));

  // No manifest? Cheap glance at up to ~200 entries for source extensions.
  if (!sawJs || !sawPy) {
    try {
      const stack = [rootDir];
      let seen = 0;
      while (stack.length && seen < 200 && !(sawJs && sawPy)) {
        const dir = stack.pop();
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (++seen > 200) break;
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') stack.push(join(dir, entry.name));
            continue;
          }
          if (/\.(m?[jt]sx?|cjs)$/.test(entry.name)) sawJs = true;
          if (/\.py$/.test(entry.name)) sawPy = true;
        }
      }
    } catch { /* tolerate */ }
  }

  if (sawJs) languages.push('js');
  if (sawPy) languages.push('py');

  return {
    languages,
    node: { version: process.version, major: Number(process.version.slice(1).split('.')[0]) },
    npmDeps,
    pyDeps,
    manifests
  };
}
