// Coverage resolution: turns a raw scanner match into a reportable finding by
// answering "who already provides this?" against the project's inventory.
// Priority: satisfied built-in > installed dependency > unsatisfied built-in
// (info) > suggested library (info, opt-in) > drop.

/** Parse '17', 17, '14.17', 'v22.16.0' into {major, minor}. */
function parseVersion(v) {
  const parts = String(v).replace(/^v/, '').split('.').map(Number);
  return { major: parts[0] || 0, minor: parts[1] || 0 };
}

// Generic "available version satisfies required floor" — works for Node
// ('v22.16.0' vs 17 / '14.17') and Python ('3.9' vs '3.12') alike.
function nodeSatisfies(since, availableVersion) {
  const s = parseVersion(since);
  const n = parseVersion(availableVersion);
  return n.major > s.major || (n.major === s.major && n.minor >= s.minor);
}

/**
 * Resolve one scanner match against the inventory.
 * @param {{patternId: string, line: number, snippet: string, via: string, blockLines: number, file: string}} match
 * @param {object} pattern - the catalog entry that fired
 * @param {object} inventory - from buildInventory()
 * @param {{suggest?: boolean}} [opts]
 * @returns {object|null} finding, or null when nothing actionable covers it
 */
export function resolveFinding(match, pattern, inventory, { suggest = false } = {}) {
  const lang = pattern.langs.includes('py') && match.file.endsWith('.py') ? 'py' : 'js';
  const builtin = pattern.coveredBy.builtin;
  const deps = pattern.coveredBy.deps || [];

  const base = {
    patternId: pattern.id,
    title: pattern.title,
    category: pattern.category,
    file: match.file,
    line: match.line,
    snippet: match.snippet,
    via: match.via,
    blockLines: match.blockLines,
    fpNote: pattern.fpNote
  };

  if (builtin) {
    if (lang === 'py') {
      const sincePy = builtin.since && builtin.since.python;
      if (!sincePy) {
        return { ...base, level: 'high', action: 'use-builtin', coveredBy: `built-in ${builtin.api}` };
      }
      // Gate version-dependent Python builtins on requires-python; without a
      // declared floor we cannot assume the runtime, so downgrade to info.
      if (inventory.pythonRequires && nodeSatisfies(sincePy, inventory.pythonRequires)) {
        return { ...base, level: 'high', action: 'use-builtin', coveredBy: `built-in ${builtin.api} — Python ≥ ${sincePy}` };
      }
      const installedPy = matchInstalledDep(deps, inventory, lang);
      if (installedPy) {
        return { ...base, level: 'high', action: 'use-installed', coveredBy: `installed dependency: ${installedPy.name} — ${installedPy.api}` };
      }
      const reason = inventory.pythonRequires
        ? `project requires-python is ${inventory.pythonRequires}`
        : 'project python version unknown';
      return { ...base, level: 'info', action: 'use-builtin', coveredBy: `built-in ${builtin.api} requires Python ≥ ${sincePy} (${reason})` };
    }
    const since = builtin.since && builtin.since.node;
    if (!since || nodeSatisfies(since, inventory.node.version)) {
      const suffix = since ? ` — Node ≥ ${since}` : '';
      return { ...base, level: 'high', action: 'use-builtin', coveredBy: `built-in ${builtin.api}${suffix}` };
    }
    // Built-in exists but this runtime predates it; fall through to installed
    // deps first, and only then report the version-gated built-in as info.
    const installed = matchInstalledDep(deps, inventory, lang);
    if (installed) {
      return { ...base, level: 'high', action: 'use-installed', coveredBy: `installed dependency: ${installed.name} — ${installed.api}` };
    }
    return {
      ...base,
      level: 'info',
      action: 'use-builtin',
      coveredBy: `built-in ${builtin.api} requires Node ≥ ${since} (current v${inventory.node.major})`
    };
  }

  const installed = matchInstalledDep(deps, inventory, lang);
  if (installed) {
    return { ...base, level: 'high', action: 'use-installed', coveredBy: `installed dependency: ${installed.name} — ${installed.api}` };
  }

  if (suggest && deps.length) {
    return {
      ...base,
      level: 'info',
      action: 'consider-library',
      coveredBy: `known library (not installed): ${deps.map(d => `${d.name} — ${d.api}`).join('; ')}`
    };
  }

  return null;
}

function matchInstalledDep(deps, inventory, lang) {
  const installed = new Set(lang === 'py' ? inventory.pyDeps : inventory.npmDeps);
  return deps.find(d => installed.has(d.name)) || null;
}
