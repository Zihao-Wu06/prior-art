// Append-only ledger of reuse outcomes, kept per-project at
// `<projectDir>/.prior-art/ledger.json`. Used to summarize how much a
// project has avoided (or accepted) by following the ladder.

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const EVENT_TYPES = ['lines-avoided', 'dep-averted', 'dep-adopted', 'wheel-found', 'wheel-fixed'];

function ledgerPath(projectDir) {
  return join(projectDir, '.prior-art', 'ledger.json');
}

/** Read the ledger file, distinguishing missing from corrupt. */
function readLedger(projectDir) {
  const file = ledgerPath(projectDir);
  if (!existsSync(file)) return { events: [], corrupt: false };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && Array.isArray(parsed.events)) return { events: parsed.events, corrupt: false };
    return { events: [], corrupt: true };
  } catch {
    return { events: [], corrupt: true };
  }
}

/**
 * Append an event to the project's ledger, creating the ledger dir/file as needed.
 * @param {string} projectDir
 * @param {{type: string, amount?: number, note?: string}} event
 * @returns {{ts: string, type: string, amount: number, note: string}}
 */
export function recordEvent(projectDir, { type, amount = 1, note = '' }) {
  if (!EVENT_TYPES.includes(type)) throw new Error(`unknown event type: ${type}`);
  if (!Number.isFinite(amount)) throw new Error(`amount must be a finite number, got: ${amount}`);

  mkdirSync(join(projectDir, '.prior-art'), { recursive: true });
  const file = ledgerPath(projectDir);
  const { events, corrupt } = readLedger(projectDir);
  // A corrupt ledger is never silently wiped: back it up first, then start
  // fresh, and tell the caller where the history went.
  let recoveredFrom = null;
  if (corrupt) {
    recoveredFrom = `${file}.corrupt-${Date.now()}`;
    try {
      renameSync(file, recoveredFrom);
    } catch {
      recoveredFrom = null;
    }
  }
  const event = { ts: new Date().toISOString(), type, amount, note };
  events.push(event);
  // Atomic replace via a per-process temp name — a shared '.tmp' races under
  // concurrent writers (observed ENOENT on rename). Concurrent read-modify-
  // write remains last-writer-wins by design for this low-stakes tally.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ events }, null, 2));
  renameSync(tmp, file);
  return recoveredFrom ? { ...event, _recoveredFrom: recoveredFrom } : event;
}

/**
 * Summarize the events recorded for a project.
 * @param {string} projectDir
 * @returns {{count: number, totals: Record<string, number>, first: string|null, last: string|null}}
 */
export function summarize(projectDir) {
  const { events, corrupt } = readLedger(projectDir);
  if (!events.length) return { count: 0, totals: {}, first: null, last: null, corrupt };

  const totals = {};
  for (const e of events) {
    totals[e.type] = (totals[e.type] || 0) + (e.amount ?? 0);
  }

  return {
    count: events.length,
    totals,
    first: events[0].ts,
    last: events[events.length - 1].ts,
    corrupt
  };
}
