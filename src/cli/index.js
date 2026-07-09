#!/usr/bin/env node
/**
 * Prior Art CLI entry point.
 *
 * A tiny hand-rolled argv parser (zero dependencies): the first positional
 * argument selects the command; `--json` and `--fresh` are boolean flags;
 * `--eco`, `--rung`, and `--mode` are single-value flags; everything else is
 * passed through as positionals to the command module.
 */

import { readFileSync } from 'node:fs';

const USAGE = `Prior Art (pa) — search prior art before you build.

Usage: pa <command> [options]

Commands:
  init                                    Scaffold .prior-art.json and docs/decisions/ here.
  report <pkg>                            Dependency due-diligence report (deps.dev + OSV + npm).
  adr new <title words…>                  Create a new architecture decision record.
  adr list                                List existing decision records.
  stats                                   Show the prior-art ledger summary.
  stats record <type> <amount> [note…]    Manually record a ledger event.
  audit                                   Wheel-reinvention audit (arrives in v0.2).
  search                                  Prior-art discovery across sources (arrives in v0.3).
  help                                    Show this help.

Options:
  --json               Machine-readable output where supported.
  --fresh               Bypass local cache for network-backed commands.
  --eco <system>         Package ecosystem (default npm): npm|pypi|go|maven|cargo|nuget|rubygems.
  --rung <rung>           Reuse-ladder rung id (used by \`pa adr new\`).
  --mode <mode>            Integration mode: adopt|extend|compose|build (used by \`pa adr new\`).
  --version, -v             Print the installed version.
`;

/**
 * Parse CLI arguments into a command name, flag options, and remaining
 * positionals.
 * @param {string[]} argv - Raw arguments, e.g. `process.argv.slice(2)`.
 * @returns {{command: string|undefined, opts: Record<string, string|boolean>, positionals: string[]}}
 */
export function parseArgv(argv) {
  const opts = {};
  const positionals = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--version' || arg === '-v') {
      opts.version = true;
      i += 1;
      continue;
    }
    if (arg === '--eco' || arg === '--rung' || arg === '--mode') {
      opts[arg.slice(2)] = argv[i + 1];
      i += 2;
      continue;
    }
    if (arg === '--json' || arg === '--fresh') {
      opts[arg.slice(2)] = true;
      i += 1;
      continue;
    }
    positionals.push(arg);
    i += 1;
  }
  const [command, ...rest] = positionals;
  return { command, opts, positionals: rest };
}

/** Read the installed version from package.json without a build step. */
function readVersion() {
  const pkgUrl = new URL('../../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'));
  return pkg.version;
}

function printAudit() {
  console.log(
    'pa audit — the wheel-reinvention detector — arrives in v0.2.\n' +
    'It will scan a repo for hand-rolled code that installed dependencies or the standard library already cover.\n' +
    'Follow the roadmap in README.md.'
  );
}

function printSearch() {
  console.log(
    'pa search — the prior-art discovery search — arrives in v0.3.\n' +
    'It will search for prior art across the repo, installed deps/MCP servers/skills, registries, GitHub, and knowledge packs.\n' +
    'Follow the roadmap in README.md.'
  );
}

/**
 * Run the CLI for a given argv slice (excluding `node` and the script path).
 * Exported so it can be driven directly in tests.
 * @param {string[]} argv
 */
export async function main(argv) {
  const { command, opts, positionals } = parseArgv(argv);

  if (opts.version) {
    console.log(readVersion());
    return;
  }

  if (!command || command === 'help') {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case 'init': {
      const { run } = await import('./commands/init.js');
      await run(opts);
      break;
    }
    case 'report': {
      const name = positionals[0];
      if (!name) {
        console.log(USAGE);
        process.exitCode = 1;
        return;
      }
      const { run } = await import('./commands/report.js');
      await run(name, opts);
      break;
    }
    case 'adr': {
      const [sub, ...titleWords] = positionals;
      const { run } = await import('./commands/adr.js');
      await run(sub, titleWords, opts);
      break;
    }
    case 'stats': {
      const { run } = await import('./commands/stats.js');
      await run(opts, positionals);
      break;
    }
    case 'audit':
      printAudit();
      break;
    case 'search':
      printSearch();
      break;
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch(err => {
  const message = err && err.message ? err.message : String(err);
  console.error('error: ' + message);
  process.exit((err && err.exitCode) || 1);
});
