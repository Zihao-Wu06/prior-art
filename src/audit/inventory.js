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

/**
 * The lowest Node version a semver range admits — the right baseline for
 * built-in availability. Handles OR alternatives: the floor of
 * '>=22 <23 || >=20 <21' is 20, not 22. Upper bounds (< / <=) are ignored;
 * a branch with no lower bound means "no floor" for the whole range.
 */
export function enginesFloor(range) {
  if (!range) return null;
  let overall = null;
  for (const branch of String(range).split('||')) {
    let floor = null;
    const re = /(>=|<=|>|<|\^|~|=)?\s*v?(\d+(?:\.\d+){0,2})/g;
    let m;
    while ((m = re.exec(branch))) {
      const op = m[1];
      if (op === '<' || op === '<=') continue;
      const [maj, min = 0] = m[2].split('.').map(Number);
      if (!floor || maj > floor.maj || (maj === floor.maj && min > floor.min)) {
        floor = { maj, min, text: m[2] };
      }
    }
    if (!floor) return null;   // one unbounded alternative unbounds the range
    if (!overall || floor.maj < overall.maj || (floor.maj === overall.maj && floor.min < overall.min)) {
      overall = floor;
    }
  }
  return overall ? overall.text : null;
}

/** Read deps (runtime vs dev split), the engines.node floor, and workspace markers from package.json. */
function readPackageManifest(rootDir) {
  const empty = { runtimeDeps: [], devDeps: [], nodeRequires: null, workspaces: false };
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
    return {
      // Coverage resolution uses runtime deps only: recommending a
      // devDependency inside shipped code would itself introduce a bug.
      runtimeDeps: [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.peerDependencies || {})],
      devDeps: Object.keys(pkg.devDependencies || {}),
      nodeRequires: pkg.engines && pkg.engines.node ? enginesFloor(pkg.engines.node) : null,
      workspaces: Boolean(pkg.workspaces)
    };
  } catch {
    return empty;
  }
}

/** Pull dependency names + requires-python from pyproject.toml + requirements*.txt (tolerant, no TOML parser). */
function readPyDeps(rootDir, manifests) {
  const deps = new Set();
  let pythonRequires = null;

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
      const rp = text.match(/^requires-python\s*=\s*["']([^"']+)["']/m);
      if (rp) {
        const ver = rp[1].match(/(\d+\.\d+)/);
        if (ver) pythonRequires = ver[1];
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

  return { deps: [...deps], pythonRequires };
}

/**
 * Build the audit inventory for a project directory.
 * @param {string} rootDir
 * @returns {{languages: string[], node: {version: string, major: number}, npmDeps: string[], npmDevDeps: string[], nodeRequires: string|null, pyDeps: string[], pythonRequires: string|null, manifests: string[]}}
 */
export function buildInventory(rootDir) {
  const manifests = [];
  const languages = [];

  const hasPackageJson = existsSync(join(rootDir, 'package.json'));
  if (hasPackageJson) manifests.push('package.json');

  const manifest = hasPackageJson ? readPackageManifest(rootDir) : { runtimeDeps: [], devDeps: [], nodeRequires: null };
  const npmDeps = manifest.runtimeDeps;
  const py = readPyDeps(rootDir, manifests);
  const pyDeps = py.deps;
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
          if (/\.(m?[jt]s|c[jt]s|jsx|tsx)$/.test(entry.name)) sawJs = true;
          if (/\.py$/.test(entry.name)) sawPy = true;
        }
      }
    } catch { /* tolerate */ }
  }

  if (sawJs) languages.push('js');
  if (sawPy) languages.push('py');

  const monorepo = manifest.workspaces ||
    existsSync(join(rootDir, 'pnpm-workspace.yaml')) ||
    existsSync(join(rootDir, 'lerna.json'));

  return {
    languages,
    node: { version: process.version, major: Number(process.version.slice(1).split('.')[0]) },
    npmDeps,
    npmDevDeps: manifest.devDeps,
    nodeRequires: manifest.nodeRequires,
    pyDeps,
    pythonRequires: py.pythonRequires,
    monorepo,
    manifests
  };
}
