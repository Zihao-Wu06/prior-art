// The reuse ladder and decision-note format.
// Rung ids are a stable public contract: they appear in decision notes,
// ADR frontmatter, benchmark cases, and the PR check. Never rename casually.

/** @typedef {{id: string, label: string, summary: string}} Rung */

/** @type {Rung[]} */
export const RUNGS = [
  { id: 'do-nothing', label: 'Do nothing', summary: 'Skip speculative requirements and scaffolding.' },
  { id: 'built-in', label: 'Built-in', summary: 'Prefer language built-ins and the standard library.' },
  { id: 'native-platform', label: 'Native platform', summary: 'Prefer browser/OS/database/framework/protocol primitives.' },
  { id: 'installed-capability', label: 'Installed capability', summary: 'Prefer already-installed dependencies, connected MCP servers, and installed agent skills.' },
  { id: 'existing-solution', label: 'Existing solution', summary: 'Adopt or fork a whole existing project or template instead of greenfielding.' },
  { id: 'open-source', label: 'Open source', summary: 'Add a mature library when it lowers total cost of ownership.' },
  { id: 'commercial', label: 'Commercial', summary: 'Buy reliability/compliance/operations/time when cheaper than owning.' },
  { id: 'in-house', label: 'In-house', summary: 'Build only when reuse fails real constraints or the work is core differentiation.' }
];

/** How the chosen option gets integrated (orthogonal to the rung). */
export const INTEGRATION_MODES = ['adopt', 'extend', 'compose', 'build'];

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isValidRung(id) {
  return RUNGS.some(r => r.id === id);
}

/**
 * Render the one-line decision note.
 * @param {{rung: string, option: string, mode?: string|null, tradeoff: string, rejected: string, revisit: string}} decision
 * @returns {string}
 */
export function formatDecisionNote({ rung, option, mode, tradeoff, rejected, revisit }) {
  if (!isValidRung(rung)) throw new Error(`unknown rung: ${rung}`);
  if (mode && !INTEGRATION_MODES.includes(mode)) throw new Error(`unknown mode: ${mode}`);
  return `Decision: use ${rung}: ${option}${mode ? ` [mode: ${mode}]` : ''}. Tradeoff: ${tradeoff}. Rejected: ${rejected}. Revisit if ${revisit}.`;
}

const NOTE_PATTERN =
  /Decision:\s*use\s+([a-z0-9-]+):\s*(.+?)(?:\s*\[mode:\s*([a-z]+)\])?\.\s*Tradeoff:\s*(.+?)\.\s*Rejected:\s*(.+?)\.\s*Revisit if\s+(.+?)\.?\s*$/ims;

/**
 * Parse a decision note produced by formatDecisionNote (tolerant of surrounding text).
 * Never throws: non-matching text or an invalid rung both yield null.
 * No in-repo caller yet by design — the v0.4 PR check consumes this; it is
 * kept public and tested as the stable counterpart of formatDecisionNote.
 * @param {string} text
 * @returns {{rung: string, option: string, mode: string|null, tradeoff: string, rejected: string, revisit: string}|null}
 */
export function parseDecisionNote(text) {
  const m = String(text).match(NOTE_PATTERN);
  if (!m) return null;
  const [, rung, option, mode, tradeoff, rejected, revisit] = m;
  if (!isValidRung(rung)) return null;
  if (mode && !INTEGRATION_MODES.includes(mode)) return null;
  return {
    rung,
    option: option.trim(),
    mode: mode || null,
    tradeoff: tradeoff.trim(),
    rejected: rejected.trim(),
    revisit: revisit.trim()
  };
}
