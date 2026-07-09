// Append-only ledger of reuse outcomes, kept per-project at
// `<projectDir>/.prior-art/ledger.json`. Used to summarize how much a
// project has avoided (or accepted) by following the ladder.

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const EVENT_TYPES = ['lines-avoided', 'dep-averted', 'dep-adopted', 'wheel-found', 'wheel-fixed'];

function ledgerPath(projectDir) {
  return join(projectDir, '.prior-art', 'ledger.json');
}

/** Read the ledger file, tolerating a missing or malformed file. */
function readLedger(projectDir) {
  const file = ledgerPath(projectDir);
  if (!existsSync(file)) return { events: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && Array.isArray(parsed.events) ? parsed : { events: [] };
  } catch {
    return { events: [] };
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
  const ledger = readLedger(projectDir);
  const event = { ts: new Date().toISOString(), type, amount, note };
  ledger.events.push(event);
  // Atomic replace: a reader can never observe a torn/partial ledger, which
  // readLedger would otherwise treat as empty and silently wipe history.
  const file = ledgerPath(projectDir);
  writeFileSync(`${file}.tmp`, JSON.stringify(ledger, null, 2));
  renameSync(`${file}.tmp`, file);
  return event;
}

/**
 * Summarize the events recorded for a project.
 * @param {string} projectDir
 * @returns {{count: number, totals: Record<string, number>, first: string|null, last: string|null}}
 */
export function summarize(projectDir) {
  const { events } = readLedger(projectDir);
  if (!events.length) return { count: 0, totals: {}, first: null, last: null };

  const totals = {};
  for (const e of events) {
    totals[e.type] = (totals[e.type] || 0) + (e.amount ?? 0);
  }

  return {
    count: events.length,
    totals,
    first: events[0].ts,
    last: events[events.length - 1].ts
  };
}
