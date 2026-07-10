/**
 * PreToolUse (Write) hook.
 *
 * Fires at most once per session, only at sensitivity 'strict', when a
 * sizable new source file is about to be created. Writes a pause-and-check
 * nudge to stderr and exits 2 to block the write. Never throws for any
 * other reason — any unexpected failure exits 0 silently.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOURCE_EXT = /\.(m?[jt]sx?|py|go|rs|java|rb|cs|php)$/;
const SOURCE_DIR = /(^|[\\/])(src|lib|app|packages|pkg|server|client)[\\/]/;
const MIN_CONTENT_LENGTH = 1500;

const NUDGE =
  'Prior Art gate (strict): you are creating a sizable new source file. Pause once — could a built-in, platform feature, installed dependency/MCP/skill, or an existing project cover this? If you already checked, state what you checked and retry the write. This gate fires once per session.';

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

  const { session_id, tool_name, tool_input, cwd } = input;

  if (tool_name !== 'Write') return;

  const filePath = tool_input && tool_input.file_path;
  if (!filePath || !SOURCE_EXT.test(filePath) || !SOURCE_DIR.test(filePath)) return;

  const content = (tool_input && tool_input.content) || '';
  if (content.length <= MIN_CONTENT_LENGTH) return;

  if (existsSync(filePath)) return;

  const { loadConfig } = await import('../src/core/config.js');
  const config = loadConfig(cwd || process.cwd());
  if (config.sensitivity !== 'strict') return;

  const sentinel = join(tmpdir(), `priorart-nudge-${session_id || 'anon'}`);
  if (existsSync(sentinel)) return;

  writeFileSync(sentinel, String(Date.now()));
  process.stderr.write(NUDGE);
  process.exit(2);
}

try {
  await main();
} catch {
  // Never break the host session.
}
