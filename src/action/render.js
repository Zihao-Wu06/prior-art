// Pure Markdown rendering + exit-code policy for the PR review. No IO, no
// colors, no throwing. Output is GitHub-flavored Markdown suitable for a PR
// comment or the job's $GITHUB_STEP_SUMMARY.

/** @typedef {import('./diff.js').AddedDep} AddedDep */

/** Escape the pipe/backtick characters that would break a Markdown table cell. */
function cell(text) {
  return String(text == null ? '' : text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Render the PR review as a Markdown block.
 * @param {{addedDeps?: AddedDep[], undocumentedDeps?: AddedDep[], auditFindings?: Array<object>, strict?: boolean}} input
 * @returns {string}
 */
export function renderSummary({ addedDeps = [], undocumentedDeps = [], auditFindings = [], strict = false } = {}) {
  const undoc = new Set(undocumentedDeps.map(d => `${d.ecosystem} ${d.name} ${d.manifest}`));
  const highCount = auditFindings.filter(f => f && f.level === 'high').length;
  const lines = [];

  lines.push('## Prior Art — PR review');
  lines.push('');

  // ── New dependencies ────────────────────────────────────────────────────
  if (addedDeps.length) {
    lines.push(`### New dependencies (${addedDeps.length})`);
    lines.push('');
    lines.push('| Package | Ecosystem | Version | Decision note |');
    lines.push('| --- | --- | --- | --- |');
    for (const d of addedDeps) {
      const documented = !undoc.has(`${d.ecosystem} ${d.name} ${d.manifest}`);
      lines.push(`| ${cell(d.name)} | ${cell(d.ecosystem)} | ${cell(d.version || '—')} | ${documented ? 'documented' : 'MISSING'} |`);
    }
    lines.push('');
    if (undocumentedDeps.length) {
      lines.push(`${undocumentedDeps.length} new dependenc${undocumentedDeps.length === 1 ? 'y is' : 'ies are'} not backed by a decision note.`);
      lines.push('Record one with `pa adr new …` or explain the choice in the PR description (name the package near the word "Decision", "reuse", or "build").');
      lines.push('');
    }
  } else {
    lines.push('### New dependencies');
    lines.push('');
    lines.push('None added in this diff.');
    lines.push('');
  }

  // ── Reinvented wheels in this diff ──────────────────────────────────────
  lines.push('### Reinvented wheels in this diff');
  lines.push('');
  if (auditFindings.length) {
    for (const f of auditFindings) {
      const tag = f.level === 'high' ? 'high' : 'info';
      lines.push(`- **${cell(f.title)}** (${tag}) — \`${cell(f.file)}:${f.line}\` — covered by ${cell(f.coveredBy)}`);
    }
    lines.push('');
  } else {
    lines.push('None found in the changed lines.');
    lines.push('');
  }

  // ── Verdict ─────────────────────────────────────────────────────────────
  const blocking = strict && (undocumentedDeps.length > 0 || highCount > 0);
  if (blocking) {
    const bits = [];
    if (undocumentedDeps.length) bits.push(`${undocumentedDeps.length} undocumented dependenc${undocumentedDeps.length === 1 ? 'y' : 'ies'}`);
    if (highCount) bits.push(`${highCount} high-confidence wheel${highCount === 1 ? '' : 's'}`);
    lines.push(`**Verdict: changes requested** — ${bits.join(' and ')} in strict mode.`);
  } else if (undocumentedDeps.length || highCount) {
    const bits = [];
    if (undocumentedDeps.length) bits.push(`${undocumentedDeps.length} undocumented dependenc${undocumentedDeps.length === 1 ? 'y' : 'ies'}`);
    if (highCount) bits.push(`${highCount} high-confidence wheel${highCount === 1 ? '' : 's'}`);
    lines.push(`**Verdict: advisory** — ${bits.join(' and ')} flagged (not blocking; run with \`strict: true\` to enforce).`);
  } else {
    lines.push('**Verdict: clean** — no undocumented dependencies and no reinvented wheels in this diff.');
  }

  return lines.join('\n') + '\n';
}

/**
 * Exit-code policy: only strict mode can fail the check.
 * @param {{undocumentedDeps?: Array<object>, highFindings?: number|Array<object>, strict?: boolean}} input
 * @returns {0|1}
 */
export function decideExit({ undocumentedDeps = [], highFindings = 0, strict = false } = {}) {
  const highCount = Array.isArray(highFindings) ? highFindings.length : Number(highFindings) || 0;
  const undocCount = Array.isArray(undocumentedDeps) ? undocumentedDeps.length : Number(undocumentedDeps) || 0;
  return strict && (undocCount > 0 || highCount > 0) ? 1 : 0;
}
