import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNGS, isValidRung, INTEGRATION_MODES } from '../../core/ladder.js';
import { findProjectRoot } from '../../core/config.js';
import { ADR_TEMPLATE } from '../../core/adr-template.js';

const DECISIONS_DIR = 'docs/decisions';
const TEMPLATE_NAME = '0000-template.md';

/**
 * Create or list architecture decision records under `docs/decisions/`.
 * @param {string|undefined} sub - 'new' | 'list'.
 * @param {string[]} positionals - Words after the subcommand (title words for `new`).
 * @param {Record<string, string|boolean>} opts - `--rung`, `--mode`.
 */
export async function run(sub, positionals, opts) {
  const dir = join(findProjectRoot(process.cwd()), DECISIONS_DIR);
  if (!existsSync(dir)) {
    throw { message: 'docs/decisions not found — run `pa init` first', exitCode: 2 };
  }

  if (sub === 'new') {
    await runNew(dir, positionals, opts);
    return;
  }

  if (sub === 'list') {
    runList(dir);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

function printUsage() {
  console.log('Usage: pa adr new <title words…> [--rung <rung>] [--mode <mode>]\n       pa adr list');
}

async function runNew(dir, positionals, opts) {
  const title = positionals.join(' ').trim();
  if (!title) {
    throw { message: 'usage: pa adr new <title words…>', exitCode: 1 };
  }

  const existing = readdirSync(dir)
    .map(f => {
      const m = f.match(/^(\d{4})-/);
      return m ? Number(m[1]) : null;
    })
    .filter(n => n !== null && n !== 0);
  const next = existing.length ? Math.max(...existing) + 1 : 1;
  const nnnn = String(next).padStart(4, '0');

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  // Prefer the scaffolded template (users may customize it); fall back to the
  // built-in so a missing file can never block recording a decision.
  const templatePath = join(dir, TEMPLATE_NAME);
  let content = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : ADR_TEMPLATE;

  content = content.replace('NNNN. <title>', `${nnnn}. ${title}`);

  const today = new Date().toISOString().slice(0, 10);
  content = content.replace('<YYYY-MM-DD>', today);

  content = content.replace('Status: Proposed | Accepted | Superseded', 'Status: Proposed');

  if (opts.rung) {
    if (!isValidRung(opts.rung)) {
      throw {
        message: `unknown rung "${opts.rung}" — use one of: ${RUNGS.map(r => r.id).join('|')}`,
        exitCode: 1
      };
    }
    content = content.replace(/^- Rung: .*$/m, `- Rung: ${opts.rung}`);
  }

  if (opts.mode) {
    if (!INTEGRATION_MODES.includes(opts.mode)) {
      throw {
        message: `unknown mode "${opts.mode}" — use one of: ${INTEGRATION_MODES.join('|')}`,
        exitCode: 1
      };
    }
    content = content.replace(/^- Mode: .*$/m, `- Mode: ${opts.mode}`);
  }

  const filename = `${nnnn}-${slug}.md`;
  const outPath = join(dir, filename);
  writeFileSync(outPath, content);
  console.log(outPath);
}

function runList(dir) {
  const files = readdirSync(dir)
    .filter(f => /^\d{4}-.*\.md$/.test(f) && f !== TEMPLATE_NAME)
    .sort();

  if (files.length === 0) {
    console.log('No decision records yet — create one with `pa adr new "<title>"`.');
    return;
  }

  const rows = files.map(f => {
    const content = readFileSync(join(dir, f), 'utf8');
    const nnnnMatch = f.match(/^(\d{4})-/);
    const nnnn = nnnnMatch ? nnnnMatch[1] : '????';
    const headingMatch = content.match(/^#\s*\d{4}\.\s*(.+)$/m);
    const title = headingMatch ? headingMatch[1].trim() : '(untitled)';
    const statusMatch = content.match(/^- Status:\s*(.+)$/m);
    const status = statusMatch ? statusMatch[1].trim() : '?';
    const rungMatch = content.match(/^- Rung:\s*(.+)$/m);
    const rung = rungMatch ? rungMatch[1].trim() : '?';
    return { nnnn, status, rung, title };
  });

  const header = { nnnn: 'NNNN', status: 'status', rung: 'rung', title: 'title' };
  const nnnnW = Math.max(header.nnnn.length, ...rows.map(r => r.nnnn.length));
  const statusW = Math.max(header.status.length, ...rows.map(r => r.status.length));
  const rungW = Math.max(header.rung.length, ...rows.map(r => r.rung.length));
  const line = r => `${r.nnnn.padEnd(nnnnW)}  ${r.status.padEnd(statusW)}  ${r.rung.padEnd(rungW)}  ${r.title}`;

  console.log(line(header));
  for (const row of rows) {
    console.log(line(row));
  }
}
