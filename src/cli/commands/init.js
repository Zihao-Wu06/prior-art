import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG_NAME = '.prior-art.json';
const DECISIONS_DIR = 'docs/decisions';
const TEMPLATE_NAME = '0000-template.md';

const DEFAULT_CONFIG = {
  sensitivity: 'standard',
  strictness: 'standard',
  priorities: [],
  alwaysBuild: [],
  alwaysReuse: [],
  notes: 'Prior Art config — sensitivity: off|light|standard|strict controls how actively the Claude Code plugin nudges; see README.'
};

const TEMPLATE = `# NNNN. <title>

- Status: Proposed | Accepted | Superseded
- Date: <YYYY-MM-DD>
- Rung: <do-nothing|built-in|native-platform|installed-capability|existing-solution|open-source|commercial|in-house>
- Mode: <adopt|extend|compose|build>

## Context

<What requirement and constraints prompted this decision?>

## Decision

<The option chosen.>

**Tradeoff:** <why it wins>
**Rejected:** <next-best option> because <constraint>

## Evidence

<Paste \`pa report\` evidence lines and search-coverage notes here: which channels were searched (repo, installed deps/MCP/skills, registries, GitHub, knowledge packs), which were skipped and why. Never claim "nothing exists" for a channel that was not searched.>

## Consequences

Revisit if <specific trigger>.
`;

/**
 * Scaffold a Prior Art project in the current working directory: write
 * `.prior-art.json` and create `docs/decisions/` with its ADR template.
 * Never overwrites a file that already exists.
 * @param {Record<string, string|boolean>} opts
 */
export async function run(opts) {
  const cwd = process.cwd();

  const configPath = join(cwd, CONFIG_NAME);
  if (existsSync(configPath)) {
    console.log(`${CONFIG_NAME} exists, left untouched`);
  } else {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    console.log(`wrote ${CONFIG_NAME}`);
  }

  const decisionsDir = join(cwd, DECISIONS_DIR);
  mkdirSync(decisionsDir, { recursive: true });

  const templatePath = join(decisionsDir, TEMPLATE_NAME);
  if (existsSync(templatePath)) {
    console.log(`${DECISIONS_DIR}/${TEMPLATE_NAME} exists, left untouched`);
  } else {
    writeFileSync(templatePath, TEMPLATE);
    console.log(`wrote ${DECISIONS_DIR}/${TEMPLATE_NAME}`);
  }

  console.log(`
Next steps:
  1. Install the Claude Code plugin:
       /plugin marketplace add Zihao-Wu06/prior-art
       /plugin install prior-art@prior-art
  2. Using another agent (Codex, etc.)? Copy rules/prior-art.md into your AGENTS.md.
  3. Try it out:
       pa report <pkg>
       pa adr new "<title>"
       pa audit`);
}
