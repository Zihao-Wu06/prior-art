// Real-manifest dependency parsers for the PR review's reconciliation step.
//
// The diff parsers in diff.js can only see a hunk's context window, so a
// dependency added deep inside an existing block (whose opening line is not in
// the diff) is invisible to them. Reconciliation fixes that: we read the
// ACTUAL manifest that CI checked out and confirm which of its real
// dependencies were declared on a diff's added lines. These are pure (content
// in, names out) and never throw.

/** Bare Python package name (drops extras, specifiers, markers). */
function pyName(raw) {
  return String(raw).trim().replace(/\[.*?\]/g, '').split(/[<>=!~;@\s]/)[0].toLowerCase().replace(/_/g, '-');
}

/** A TOML line with quoted strings blanked out, so `]` inside `"pkg[extra]"` is not structure. */
export function stripTomlStrings(line) {
  return String(line).replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}

/** pyproject.toml: PEP 621 `dependencies = [ … ]` arrays plus poetry dependency tables. */
function parsePyprojectDeps(text, deps) {
  let inArray = false;
  let inPoetryDeps = false;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (inArray) {
      for (const q of t.matchAll(/["']([^"']+)["']/g)) deps.set(pyName(q[1]), null);
      if (/\]/.test(stripTomlStrings(t))) inArray = false;
      continue;
    }
    const table = t.match(/^\[([^\]]+)\]/);
    if (table) {
      inPoetryDeps = /(^|\.)dependencies$/.test(table[1].trim()) && /poetry/.test(table[1]);
      continue;
    }
    if (/^dependencies\s*=\s*\[/.test(t)) {
      const rest = t.slice(t.indexOf('[') + 1);
      for (const q of rest.matchAll(/["']([^"']+)["']/g)) deps.set(pyName(q[1]), null);
      inArray = !/\]/.test(stripTomlStrings(rest));
      continue;
    }
    if (inPoetryDeps) {
      const kv = t.match(/^([A-Za-z0-9._-]+)\s*=/);
      if (kv && kv[1].toLowerCase() !== 'python') deps.set(kv[1].toLowerCase().replace(/_/g, '-'), null);
    }
  }
  return deps;
}

/** requirements*.txt: one requirement per line; comments, options and URL installs skipped. */
function parseRequirementsDeps(text, deps) {
  for (const line of text.split('\n')) {
    const t = line.replace(/\s+#.*$/, '').trim();
    if (!t || t.startsWith('#') || t.startsWith('-') || /:\/\//.test(t) || /^(git|hg|svn|bzr)\+/.test(t)) continue;
    const n = pyName(t);
    if (n) deps.set(n, null);
  }
  return deps;
}

/**
 * Parse a manifest's real dependency names from its file content.
 * @param {string} content
 * @param {string} ecosystem - 'npm' | 'pypi' | 'cargo' | 'go'
 * @param {string} [path] - manifest path; tells pyproject.toml from requirements*.txt
 * @returns {Map<string, string|null>} name -> version (null when unknown)
 */
export function parseManifestDeps(content, ecosystem, path) {
  const deps = new Map();
  const text = String(content || '');
  try {
    if (ecosystem === 'npm') {
      const pkg = JSON.parse(text);
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const obj = pkg && pkg[field];
        if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) deps.set(k, typeof v === 'string' ? v : null);
      }
      return deps;
    }
    if (ecosystem === 'pypi') {
      // pyproject.toml and requirements*.txt are different grammars: reading a
      // TOML file as requirements turned every `key = value` line (description,
      // readme, line-length, …) into a "dependency".
      const isToml = path ? /\.toml$/i.test(path) : /^\s*\[[^\]]+\]\s*(#.*)?$/m.test(text);
      return isToml ? parsePyprojectDeps(text, deps) : parseRequirementsDeps(text, deps);
    }
    if (ecosystem === 'cargo') {
      let inDeps = false;
      for (const line of text.split('\n')) {
        const t = line.trim();
        const table = t.match(/^\[([^\]]+)\]/);
        if (table) { inDeps = /(^|\.)(dependencies|dev-dependencies|build-dependencies)$/.test(table[1].trim()); continue; }
        if (inDeps) {
          const kv = t.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
          if (kv) {
            const v = (kv[2].match(/version\s*=\s*"([^"]+)"/) || kv[2].match(/^"([^"]+)"/) || [])[1] || null;
            deps.set(kv[1], v);
          }
        }
      }
      return deps;
    }
    if (ecosystem === 'go') {
      let inBlock = false;
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (/^require\s*\(/.test(t)) { inBlock = true; continue; }
        if (inBlock && /^\)/.test(t)) { inBlock = false; continue; }
        const single = t.match(/^require\s+(\S+)\s+(v\S+)/);
        if (single) { deps.set(single[1], single[2]); continue; }
        if (inBlock) {
          const entry = t.match(/^(\S+)\s+(v\S+)/);
          if (entry) deps.set(entry[1], entry[2]);
        }
      }
      return deps;
    }
  } catch {
    return deps;
  }
  return deps;
}

/** Escape a name for use in a RegExp. */
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does a single manifest line DECLARE the given dependency (as opposed to
 * merely mentioning it)? Ecosystem-specific and boundary-anchored so a
 * substring never counts.
 * @param {string} line - a diff body line (marker already stripped)
 * @param {string} name
 * @param {string} ecosystem
 * @returns {boolean}
 */
export function lineDeclaresDep(line, name, ecosystem) {
  const l = String(line || '');
  const n = String(name || '');
  if (!n) return false;
  const e = escapeRe(n);
  if (ecosystem === 'npm') return new RegExp(`(^|[\\s{,])"${e}"\\s*:`).test(l);
  if (ecosystem === 'cargo') return new RegExp(`^\\s*${e}\\s*=`).test(l);
  if (ecosystem === 'go') return new RegExp(`(^|\\s)${e}\\s+v`).test(l);
  if (ecosystem === 'pypi') {
    const t = l.trim();
    if (pyName(t) === n.toLowerCase()) return true;                 // requirements
    return new RegExp(`["']${e}(\\[|["'])`).test(l) || new RegExp(`^\\s*${e}\\s*=`).test(l);  // pyproject/poetry
  }
  return false;
}
