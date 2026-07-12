// Pure grading for the behavior benchmark — NO IO, NO network, never throws.
//
// The benchmark measures one thing: does prepending the reuse-ladder gate make
// an agent name a rung/mode via the decision-note format? Grading is therefore
// deterministic keyword scoring over the frozen decision-note parser, so a run's
// numbers are reproducible and auditable rather than model-of-the-day vibes.

import { parseDecisionNote, isValidRung, INTEGRATION_MODES } from '../src/core/ladder.js';

/**
 * Extract a decision note from arbitrary agent output.
 *
 * Two passes, strict first:
 *   1. Run the frozen {@link parseDecisionNote} against the whole text, then each
 *      line. A hit returns the full parsed note (rung/option/mode/…).
 *   2. Tolerant fallback: the first line naming `use <rung-id>` for a valid rung
 *      (optionally `mode: <mode>`) yields `{rung, mode|null, _looseMatch:true}`.
 * Returns `null` when nothing matches. Never throws.
 *
 * @param {string} text - Raw agent output (any value is coerced to string).
 * @returns {({rung:string, option:string, mode:string|null, tradeoff:string, rejected:string, revisit:string}|{rung:string, mode:string|null, _looseMatch:true}|null)}
 */
export function extractDecisionNote(text) {
  if (text == null) return null;
  const str = String(text);
  if (!str.trim()) return null;

  // Pass 1 — strict, via the frozen parser. Whole text first (its regex spans
  // newlines), then line-by-line to isolate a note buried in prose.
  const whole = parseDecisionNote(str);
  if (whole) return whole;
  const lines = str.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseDecisionNote(line);
    if (parsed) return parsed;
  }

  // Pass 2 — tolerant, but only for text that actually reads like a decision.
  // Without this cue, a casual sentence ("we can use in-house tooling for
  // logging") would be credited as a rung pick and understate a model's
  // reinvention rate — so a decision cue must be present somewhere in the text.
  if (!/\bdecision\b|\btradeoff\b|\brejected\b|\brevisit\b|\bmode:/i.test(str)) return null;
  for (const line of lines) {
    const rungMatch = line.match(/\buse\s+([a-z0-9-]+)/i);
    if (!rungMatch) continue;
    const rung = rungMatch[1].toLowerCase();
    if (!isValidRung(rung)) continue;
    const modeMatch = line.match(/mode:\s*([a-z]+)/i);
    let mode = modeMatch ? modeMatch[1].toLowerCase() : null;
    if (mode && !INTEGRATION_MODES.includes(mode)) mode = null;
    return { rung, mode, _looseMatch: true };
  }

  return null;
}

/**
 * Grade one agent output against the expected rung/mode for a case.
 *
 * Scoring (max 4 points):
 *   +1  a decision note was parsed at all (strict or loose)
 *   +2  the rung matches the expected rung
 *   +1  the mode matches the expected mode
 * A null/empty/garbage output yields all-false and score 0. Never throws.
 *
 * @param {string} output - Raw agent output.
 * @param {{expectedRung?:string, expectedMode?:string}} expected
 * @returns {{parsed:boolean, rungCorrect:boolean, modeCorrect:boolean, score:number, note:object|null}}
 */
export function gradeOutput(output, expected) {
  const note = extractDecisionNote(output);
  const parsed = note != null;
  const expectedRung = expected ? expected.expectedRung : undefined;
  const expectedMode = expected ? expected.expectedMode : undefined;

  const rungCorrect = parsed && note.rung === expectedRung;
  const modeCorrect = parsed && note.mode != null && note.mode === expectedMode;

  let score = 0;
  if (parsed) score += 1;
  if (rungCorrect) score += 2;
  if (modeCorrect) score += 1;

  return { parsed, rungCorrect, modeCorrect, score, note };
}

/**
 * Aggregate per-case baseline/enabled grades into run-level totals.
 *
 * @param {Array<{id:string, baseline:{score?:number, rungCorrect?:boolean, modeCorrect?:boolean}, enabled:{score?:number, rungCorrect?:boolean, modeCorrect?:boolean}}>} perCase
 * @returns {{n:number, baselineTotal:number, enabledTotal:number, maxTotal:number, delta:number, rungHitsBaseline:number, rungHitsEnabled:number, byCase:Array<object>}}
 */
export function aggregate(perCase) {
  const list = Array.isArray(perCase) ? perCase : [];
  const n = list.length;
  let baselineTotal = 0;
  let enabledTotal = 0;
  let rungHitsBaseline = 0;
  let rungHitsEnabled = 0;
  const byCase = [];

  for (const c of list) {
    const b = (c && c.baseline) || {};
    const e = (c && c.enabled) || {};
    const bScore = Number(b.score) || 0;
    const eScore = Number(e.score) || 0;
    baselineTotal += bScore;
    enabledTotal += eScore;
    if (b.rungCorrect) rungHitsBaseline += 1;
    if (e.rungCorrect) rungHitsEnabled += 1;
    byCase.push({
      id: c ? c.id : undefined,
      baselineScore: bScore,
      enabledScore: eScore,
      baselineRungCorrect: !!b.rungCorrect,
      enabledRungCorrect: !!e.rungCorrect,
      baselineModeCorrect: !!b.modeCorrect,
      enabledModeCorrect: !!e.modeCorrect,
      delta: eScore - bScore
    });
  }

  return {
    n,
    baselineTotal,
    enabledTotal,
    maxTotal: n * 4,
    delta: enabledTotal - baselineTotal,
    rungHitsBaseline,
    rungHitsEnabled,
    byCase
  };
}
