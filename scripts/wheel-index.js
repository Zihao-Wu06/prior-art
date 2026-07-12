// Wheel Reinvention Index — public aggregation of benchmark results.
//
// This module turns per-model benchmark result files (produced by
// scripts/benchmark.js — top-level `model`/`date` plus an aggregate whose
// `byCase[]` entries carry flat `baselineRungCorrect`/`enabledRungCorrect`
// booleans) into a ranked table of how often each model reinvents the wheel,
// and renders that ranking as a Markdown report.
//
// HONESTY CONTRACT: this file produces numbers, it never invents them.
// With no result files present, `aggregateIndex` returns `{empty:true}` and
// `renderIndexMarkdown` emits methodology plus an explicit "no runs recorded"
// note — never placeholder percentages or fabricated scores. A number only
// appears in the output when it was computed from a real result object.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';

/**
 * @typedef {Object} IndexRow
 * @property {string} model            Model id from the result's top-level `model`.
 * @property {number} cases            Number of scored behavior cases.
 * @property {number} baselineScore    Cases the un-gated (baseline) run got the rung right on.
 * @property {number} enabledScore     Cases the gate-enabled run got the rung right on.
 * @property {number} maxScore         Perfect score (equal to `cases`).
 * @property {number} delta            enabledScore - baselineScore (gate lift).
 * @property {number} reinventionRate  Fraction of cases where the BASELINE missed the
 *                                     expected reuse rung: (cases - baselineScore) / cases.
 */

/**
 * @typedef {Object} IndexAggregate
 * @property {IndexRow[]} rows          Rows sorted by reinventionRate descending.
 * @property {number}     generatedFrom Number of result objects that produced a row.
 * @property {boolean}    empty         True when no rows were produced (no/invalid inputs).
 */

/**
 * Did one condition ('baseline' | 'enabled') land on the expected reuse rung
 * for a byCase entry? Reads the producer's flat `<cond>RungCorrect` boolean
 * first; tolerates a nested `entry[cond].rungCorrect` shape and a raw
 * `rung`-vs-`expectedRung` comparison as fallbacks. Unknown → false.
 * @param {any} entry
 * @param {'baseline'|'enabled'} cond
 * @returns {boolean}
 */
function rungCorrect(entry, cond) {
  if (!entry || typeof entry !== 'object') return false;
  const flat = entry[`${cond}RungCorrect`];        // producer shape (benchmark.js)
  if (typeof flat === 'boolean') return flat;
  const nested = entry[cond];                       // tolerate {baseline:{rungCorrect}}
  if (nested && typeof nested === 'object') {
    if (typeof nested.rungCorrect === 'boolean') return nested.rungCorrect;
    if (nested.rung != null && entry.expectedRung != null) return nested.rung === entry.expectedRung;
  }
  return false;
}

/**
 * Did any case in a result error (agent throw / timeout / missing binary)?
 * An errored run measured nothing — its zeros must never become a published
 * score. benchmark.js records the signal in `raw[].baselineError/enabledError`.
 * @param {any} result
 * @returns {boolean}
 */
export function resultHasErrors(result) {
  const raw = result && Array.isArray(result.raw) ? result.raw : null;
  if (!raw) return false;
  return raw.some(r => r && (r.baselineError || r.enabledError));
}

/**
 * Score one benchmark result object into a row, or null if it has no cases or
 * any case errored (an errored run is never scored — see resultHasErrors).
 * Tolerant of missing fields; never throws.
 * @param {any} result
 * @returns {IndexRow|null}
 */
function scoreResult(result) {
  if (!result || typeof result !== 'object') return null;
  if (resultHasErrors(result)) return null;
  const byCase = Array.isArray(result.byCase) ? result.byCase : null;
  if (!byCase || byCase.length === 0) return null;

  const model = result.model || (result.meta && result.meta.model) || 'unknown';
  let baselineScore = 0;
  let enabledScore = 0;
  for (const entry of byCase) {
    if (rungCorrect(entry, 'baseline')) baselineScore++;
    if (rungCorrect(entry, 'enabled')) enabledScore++;
  }
  const cases = byCase.length;
  return {
    model: String(model),
    cases,
    baselineScore,
    enabledScore,
    maxScore: cases,
    delta: enabledScore - baselineScore,
    reinventionRate: cases > 0 ? (cases - baselineScore) / cases : 0
  };
}

/**
 * Aggregate parsed benchmark result objects into a ranked index.
 * Rows are sorted by reinvention rate descending (worst offenders first),
 * with model id as a deterministic tie-break.
 * @param {any[]} resultObjects Array of parsed benchmark result JSON objects.
 * @returns {IndexAggregate}
 */
export function aggregateIndex(resultObjects) {
  const input = Array.isArray(resultObjects) ? resultObjects : [];
  const rows = [];
  let excludedErrored = 0;
  for (const result of input) {
    if (resultHasErrors(result)) { excludedErrored += 1; continue; }
    const row = scoreResult(result);
    if (row) rows.push(row);
  }
  rows.sort((a, b) =>
    b.reinventionRate - a.reinventionRate || a.model.localeCompare(b.model)
  );
  return { rows, generatedFrom: rows.length, excludedErrored, empty: rows.length === 0 };
}

/** Format a 0..1 fraction as a one-decimal percentage string, e.g. 0.6667 -> "66.7%". */
function pct(fraction) {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Signed integer, e.g. 5 -> "+5", -2 -> "-2", 0 -> "0". */
function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Render the public Wheel Reinvention Index Markdown document.
 *
 * When `agg.empty` is true, the output contains methodology and an explicit
 * "No benchmark runs recorded" note and emits NO numeric/percentage claims.
 *
 * `asOf` is required by the caller so this function stays pure and
 * deterministic — it never reads the clock itself. If omitted it renders
 * `unspecified` rather than fabricating a date.
 *
 * @param {IndexAggregate} agg
 * @param {{asOf?: string}} [opts]
 * @returns {string}
 */
export function renderIndexMarkdown(agg, opts = {}) {
  const asOf = opts && opts.asOf ? opts.asOf : 'unspecified';
  const empty = !agg || agg.empty || !Array.isArray(agg.rows) || agg.rows.length === 0;

  const lines = [];
  lines.push('# Wheel Reinvention Index');
  lines.push('');
  lines.push(
    '<!-- Generated by scripts/wheel-index.js. Do not edit by hand; run `npm run index` to regenerate. -->'
  );
  lines.push('');
  lines.push(`_As of ${asOf}._`);
  lines.push('');

  lines.push('## Methodology');
  lines.push('');
  lines.push(
    'The Wheel Reinvention Index measures how often a language model reinvents the ' +
      'wheel — reaches for a hand-rolled or freshly-installed solution when a lower ' +
      'rung on the [reuse ladder](../src/core/ladder.js) already covers the need. ' +
      'Each model runs the [behavior cases](../benchmarks/behavior-cases.json) twice: ' +
      'once **baseline** (no Prior Art gate) and once **gate-enabled**. For every case ' +
      'we score whether the model landed on the expected reuse rung.'
  );
  lines.push('');
  lines.push(
    '**Reinvention rate** is the fraction of cases where the *baseline* (un-gated) ' +
      'model failed to pick the expected reuse rung — how often it would have ' +
      'reinvented or over-built with nothing stopping it. **Delta** is the number of ' +
      'additional cases the gate-enabled run got right versus baseline. Higher ' +
      'reinvention rate is worse; higher delta means the gate helped more.'
  );
  lines.push('');

  lines.push('## Ranking');
  lines.push('');
  if (empty) {
    lines.push(
      'No benchmark runs recorded yet — run `npm run benchmark` across the models you ' +
        'care about to produce `benchmarks/results/*.json`, then `npm run index` to ' +
        'regenerate this table.'
    );
    lines.push('');
    lines.push(
      'This page reports only measurements from real benchmark runs. Until result ' +
        'files exist it stays in this empty state rather than showing placeholder ' +
        'scores.'
    );
  } else {
    lines.push('| Model | Cases | Baseline correct | Gate-enabled correct | Delta | Reinvention rate |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const r of agg.rows) {
      lines.push(
        `| ${r.model} | ${r.cases} | ${r.baselineScore} | ${r.enabledScore} | ` +
          `${signed(r.delta)} | ${pct(r.reinventionRate)} |`
      );
    }
    lines.push('');
    lines.push(
      `Ranked by reinvention rate (worst first). Generated from ${agg.generatedFrom} ` +
        `benchmark result file(s).`
    );
  }
  if (agg && agg.excludedErrored > 0) {
    lines.push('');
    lines.push(
      `> ${agg.excludedErrored} result file(s) were excluded because their agent ` +
        `errored (e.g. \`claude\` not on PATH, auth failure, or a timeout) — an ` +
        `errored run measured nothing and is never scored here.`
    );
  }
  lines.push('');

  lines.push('## Reproducibility');
  lines.push('');
  lines.push('1. Run the benchmark for each model: `npm run benchmark` (writes `benchmarks/results/<model>.json`).');
  lines.push('2. Regenerate this document: `npm run index` (optionally `--as-of <YYYY-MM-DD>`).');
  lines.push('3. Every number above is recomputed from the committed result files — none are entered by hand.');
  lines.push('');
  lines.push(
    'Scoring is defined in `scripts/wheel-index.js`; the cases live in ' +
      '`benchmarks/behavior-cases.json`. See `benchmarks/README.md` for the run protocol.'
  );
  lines.push('');

  return lines.join('\n');
}

/**
 * Load parsed benchmark result objects from a directory of `*.json` files.
 * Ignores non-`.json` entries, skips files that fail to read or parse, and
 * never throws (a missing directory yields `[]`).
 * @param {string} dir Directory of benchmark result files (e.g. benchmarks/results).
 * @returns {any[]} Parsed JSON objects, one per readable `.json` file.
 */
export function loadResults(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (parsed && typeof parsed === 'object') out.push(parsed);
    } catch {
      // Skip unreadable / malformed result files rather than failing the run.
    }
  }
  return out;
}

/**
 * Resolve the "as of" date without letting the pure renderer touch the clock:
 * `--as-of <date>` on argv wins, then the `PRIOR_ART_AS_OF` env stamp, then
 * today's date (only ever read here, in the CLI path).
 * @param {string[]} argv
 * @param {Record<string,string|undefined>} env
 * @returns {string}
 */
function resolveAsOf(argv, env) {
  const idx = argv.indexOf('--as-of');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  if (env && env.PRIOR_ART_AS_OF) return env.PRIOR_ART_AS_OF;
  return new Date().toISOString().slice(0, 10);
}

/**
 * CLI: read benchmarks/results/, write docs/wheel-reinvention-index.md.
 * @param {string[]} argv
 * @param {Record<string,string|undefined>} env
 */
function cliMain(argv, env) {
  const asOf = resolveAsOf(argv, env);
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, '..');
  const results = loadResults(join(root, 'benchmarks', 'results'));
  const agg = aggregateIndex(results);
  const md = renderIndexMarkdown(agg, { asOf });
  const outFile = join(root, 'docs', 'wheel-reinvention-index.md');
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, md);
  const state = agg.empty ? 'empty (no runs recorded)' : `${agg.rows.length} model(s)`;
  console.log(`wrote ${outFile} — ${state}`);
}

// Run only when invoked directly (`node scripts/wheel-index.js`), never on import.
const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  cliMain(process.argv.slice(2), process.env);
}
