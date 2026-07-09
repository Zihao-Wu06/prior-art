import { EVENT_TYPES, recordEvent, summarize } from '../../core/ledger.js';

const FRIENDLY_LABELS = {
  'lines-avoided': 'lines avoided',
  'dep-averted': 'dependencies averted',
  'dep-adopted': 'dependencies adopted',
  'wheel-found': 'wheels found',
  'wheel-fixed': 'wheels fixed'
};

/**
 * Show the prior-art ledger summary, or manually record one event when
 * invoked as `pa stats record <type> <amount> [note…]`.
 * @param {Record<string, string|boolean>} opts
 * @param {string[]} positionals - e.g. `['record', type, amount, ...noteWords]`.
 */
export async function run(opts, positionals) {
  const cwd = process.cwd();

  if (positionals[0] === 'record') {
    runRecord(cwd, positionals.slice(1));
    return;
  }

  printSummary(cwd);
}

function runRecord(cwd, args) {
  const [type, amountRaw, ...noteWords] = args;

  if (!EVENT_TYPES.includes(type)) {
    throw {
      message: `unknown event type "${type}" — use one of: ${EVENT_TYPES.join('|')}`,
      exitCode: 1
    };
  }

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount)) {
    throw { message: `amount must be a finite number, got "${amountRaw}"`, exitCode: 1 };
  }

  const note = noteWords.join(' ');

  recordEvent(cwd, { type, amount, note });
  console.log(`recorded ${type}: ${amount}${note ? ' — ' + note : ''}`);
}

function printSummary(cwd) {
  const { count, totals, first, last } = summarize(cwd);

  if (count === 0) {
    console.log(
      'Prior Art ledger — 0 events.\n' +
      'Nothing writes here automatically: the Prior Art skills record events during\n' +
      'Claude Code sessions (after verified fixes), and you can record one manually:\n' +
      '  pa stats record wheel-fixed 1 replaced deepClone with structuredClone\n' +
      '  pa stats record lines-avoided 120 reused the existing retry helper'
    );
    return;
  }

  console.log(`Prior Art ledger — ${count} event${count === 1 ? '' : 's'} (first ${first} last ${last})`);
  console.log('');

  const types = Object.keys(totals);
  const width = Math.max(...types.map(t => (FRIENDLY_LABELS[t] || t).length));
  for (const type of types) {
    const label = (FRIENDLY_LABELS[type] || type).padEnd(width);
    console.log(`  ${label}  ${totals[type]}`);
  }
}
