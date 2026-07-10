/**
 * SessionStart hook.
 *
 * Prints the Prior Art reuse-ladder gate as additional context, unless the
 * project's configured sensitivity is 'off'. Never throws — any failure
 * exits 0 silently so a broken or half-installed plugin never blocks the
 * host session.
 */

const RULE = [
  "Prior Art gate (reuse ladder — stop at the first rung that satisfies the real requirement): 1 do-nothing: skip speculative work",
  "2 built-in: language/stdlib",
  "3 native-platform: browser/OS/DB/framework/protocol primitives",
  "4 installed-capability: existing deps, connected MCP servers, installed skills",
  "5 existing-solution: adopt/fork a whole existing project",
  "6 open-source: add a mature library",
  "7 commercial: buy it",
  "8 in-house: only for core differentiation.",
  "Pick the option that fits the requirement's real shape, not the most popular one. Before adding any dependency, vet it: `pa report <pkg> [--eco pypi|cargo|go|maven|nuget|rubygems]`.",
  "For non-obvious calls write: Decision: use <rung>: <option> [mode: adopt|extend|compose|build]. Tradeoff: … Rejected: … because … Revisit if …",
  "Coverage honesty: state which channels you actually searched (repo, installed deps/MCP/skills, registries, GitHub, knowledge packs); never claim 'nothing exists' for a channel you did not search. Record durable decisions with `pa adr new`."
].join('\n');

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const raw = await readStdin();
  let input = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }

  const cwd = input.cwd || process.cwd();
  const { loadConfig } = await import('../src/core/config.js');
  const config = loadConfig(cwd);

  if (config.sensitivity === 'off') {
    return;
  }

  // Project policies are only real if the model actually sees them.
  const policies = [];
  if (Array.isArray(config.alwaysBuild) && config.alwaysBuild.length) {
    policies.push(`alwaysBuild (never outsource): ${config.alwaysBuild.join('; ')}`);
  }
  if (Array.isArray(config.alwaysReuse) && config.alwaysReuse.length) {
    policies.push(`alwaysReuse (never reimplement): ${config.alwaysReuse.join('; ')}`);
  }
  if (Array.isArray(config.priorities) && config.priorities.length) {
    policies.push(`priorities: ${config.priorities.join('; ')}`);
  }

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: policies.length
        ? `${RULE}\nProject policy (.prior-art.json): ${policies.join(' · ')}`
        : RULE
    }
  }));
}

try {
  await main();
} catch {
  // Never break the host session.
}
