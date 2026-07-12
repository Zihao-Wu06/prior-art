// Behavior benchmark runner: does the reuse-ladder gate change what an agent
// decides? For each case we ask the SAME agent twice — the bare prompt
// (baseline) and the gate prepended (enabled) — grade both, and report the gap.
//
// HONESTY: this module never invents numbers. It only reports what a real
// injected agent returned, and the CLI's `--dry` mode is loudly labelled
// SYNTHETIC. The default agent shells out to `claude -p`; there is no
// hard-coded "measured" result anywhere in this file.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gradeOutput, aggregate } from './grade.js';
import { formatDecisionNote } from '../src/core/ladder.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/** Read the default gate text (the single-source-of-truth rule file). */
function loadDefaultGate() {
  return readFileSync(join(REPO_ROOT, 'rules', 'prior-art.md'), 'utf8');
}

/** Load the frozen behavior cases. */
function loadCases() {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'benchmarks', 'behavior-cases.json'), 'utf8'));
  return raw.cases;
}

/**
 * Call the injected agent, coercing output to a string and swallowing throws
 * so one bad case scores 0 instead of aborting the run.
 * @param {(prompt:string)=>Promise<string>} agent
 * @param {string} prompt
 * @returns {Promise<{output:string, error:string|null}>}
 */
async function callAgent(agent, prompt) {
  try {
    const out = await agent(prompt);
    return { output: out == null ? '' : String(out), error: null };
  } catch (err) {
    return { output: '', error: err && err.message ? err.message : String(err) };
  }
}

/**
 * Score one output. Keyword grading is the default; an injected `judge` may
 * override it by returning a `{score, rungCorrect, modeCorrect, ...}` object.
 * @param {string} output
 * @param {{expectedRung?:string, expectedMode?:string}} expected
 * @param {object} caseObj
 * @param {?(output:string, expected:object, caseObj:object)=>Promise<object>} judge
 */
async function grade(output, expected, caseObj, judge) {
  if (typeof judge === 'function') {
    const j = await judge(output, expected, caseObj);
    if (j && typeof j === 'object' && typeof j.score === 'number') return j;
  }
  return gradeOutput(output, expected);
}

/**
 * Run the benchmark over `cases` using an INJECTED agent.
 *
 * @param {Array<{id:string, prompt:string, expectedRung:string, expectedMode:string}>} cases
 * @param {{agent:(prompt:string)=>Promise<string>, gate?:string, judge?:Function}} options
 *   - `agent`   required async fn `(prompt) => output`.
 *   - `gate`    rule text prepended in the enabled condition (defaults to rules/prior-art.md).
 *   - `judge`   optional async scorer overriding keyword grading.
 * @returns {Promise<object>} aggregate(...) plus `raw` per-case outputs.
 */
export async function runBenchmark(cases, options = {}) {
  const { agent, gate, judge } = options;
  if (typeof agent !== 'function') {
    throw new Error('runBenchmark requires an injected async `agent` fn (prompt)->Promise<string>');
  }
  const gateText = gate != null ? gate : loadDefaultGate();
  const list = Array.isArray(cases) ? cases : [];

  const perCase = [];
  const raw = [];
  for (const c of list) {
    const expected = { expectedRung: c.expectedRung, expectedMode: c.expectedMode };
    const base = await callAgent(agent, c.prompt);
    const en = await callAgent(agent, gateText + '\n\n' + c.prompt);
    const baseline = await grade(base.output, expected, c, judge);
    const enabled = await grade(en.output, expected, c, judge);
    perCase.push({ id: c.id, baseline, enabled });
    raw.push({
      id: c.id,
      expectedRung: c.expectedRung,
      expectedMode: c.expectedMode,
      baselineOutput: base.output,
      enabledOutput: en.output,
      baselineError: base.error,
      enabledError: en.error
    });
  }

  return { ...aggregate(perCase), raw };
}

/**
 * Render a markdown report. Includes a per-case table, totals + delta, and an
 * explicit provenance line (agent/model + date). When `meta.synthetic` is true
 * a bold banner makes clear the numbers measure no real model.
 *
 * @param {object} agg - Output of {@link runBenchmark} (or {@link aggregate}).
 * @param {{model?:string, agent?:string, date?:string, synthetic?:boolean, cases?:Array}} [meta]
 * @returns {string} markdown
 */
export function renderReport(agg, meta = {}) {
  const lines = [];
  lines.push('# Prior Art behavior benchmark');
  lines.push('');
  if (meta.synthetic) {
    lines.push('**SYNTHETIC — not a measurement of any real model.**');
    lines.push('');
  }
  const model = meta.model || meta.agent || 'unknown-agent';
  const date = meta.date || new Date().toISOString();
  lines.push(`Provenance: agent/model = \`${model}\`, generated ${date}.`);
  lines.push('Scoring: parsed note +1, rung match +2, mode match +1 (max 4/case).');

  // A run where the agent errored measured nothing — its zeros must never be
  // read as "the gate did nothing". Surface the error count loudly.
  const raw = agg.raw || [];
  const errored = raw.filter(r => r && (r.baselineError || r.enabledError)).length;
  if (errored > 0) {
    const total = raw.length || (agg.byCase || []).length;
    lines.push('');
    lines.push(`**WARNING: ${errored}/${total} cases had an agent error — the scores below are NOT a valid measurement.** (e.g. \`claude\` not on PATH, auth failure, or a timeout.) Fix the agent and re-run before trusting or publishing these numbers.`);
  }
  lines.push('');

  // Expected rung/mode come from the raw outputs (or meta.cases as a fallback).
  const expectedById = new Map();
  for (const r of agg.raw || []) expectedById.set(r.id, { rung: r.expectedRung, mode: r.expectedMode });
  for (const c of meta.cases || []) {
    if (!expectedById.has(c.id)) expectedById.set(c.id, { rung: c.expectedRung, mode: c.expectedMode });
  }

  lines.push('| case | expected rung / mode | baseline | enabled |');
  lines.push('| --- | --- | --- | --- |');
  for (const c of agg.byCase || []) {
    const exp = expectedById.get(c.id) || {};
    const expText = `${exp.rung || '?'}${exp.mode ? ' / ' + exp.mode : ''}`;
    lines.push(`| ${c.id} | ${expText} | ${c.baselineScore}/4 | ${c.enabledScore}/4 |`);
  }
  lines.push('');

  const sign = agg.delta >= 0 ? '+' : '';
  lines.push(`Totals: baseline ${agg.baselineTotal}/${agg.maxTotal}, enabled ${agg.enabledTotal}/${agg.maxTotal}, delta ${sign}${agg.delta}.`);
  lines.push(`Rung hits: baseline ${agg.rungHitsBaseline}/${agg.n}, enabled ${agg.rungHitsEnabled}/${agg.n}.`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Count cases whose baseline or enabled agent call errored.
 * @param {object} agg
 * @returns {number}
 */
export function erroredCount(agg) {
  return (agg && Array.isArray(agg.raw) ? agg.raw : []).filter(r => r && (r.baselineError || r.enabledError)).length;
}

// ---------------------------------------------------------------------------
// CLI — only runs when invoked directly (see the entrypoint guard at the end).
// ---------------------------------------------------------------------------

/**
 * Default agent: headless `claude -p`, prompt piped over stdin.
 * @param {string|undefined} model
 * @returns {(prompt:string)=>Promise<string>}
 */
function claudeAgent(model) {
  return (prompt) => new Promise((res, rej) => {
    const args = ['-p'];
    if (model) args.push('--model', model);
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', rej);
    child.on('close', code => {
      if (code === 0) res(out);
      else rej(new Error(`claude exited ${code}: ${err.slice(0, 500)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Built-in FAKE agent for `--dry`: scripted weak-baseline / strong-enabled
 * outputs so the pipeline can be exercised offline. Output is SYNTHETIC by
 * construction — it is derived from each case's expected answer, not a model.
 * @param {Array} cases
 */
function makeFakeAgent(cases) {
  return async (prompt) => {
    const enabled = /reuse ladder|prior art|decision:\s*use/i.test(prompt);
    const c = cases.find(x => prompt.includes(x.prompt));
    if (!enabled || !c) {
      return 'Sure — here is a straightforward implementation, adding a small dependency for it.';
    }
    return [
      'Following the reuse ladder:',
      formatDecisionNote({
        rung: c.expectedRung,
        option: `the ${c.expectedRung} option`,
        mode: c.expectedMode,
        tradeoff: 'lowest ownership that satisfies the requirement',
        rejected: 'the hand-rolled alternative',
        revisit: 'the requirement outgrows this choice'
      })
    ].join('\n');
  };
}

/** Tiny flag parser for the benchmark CLI: --model <v>, --judge <v>, --dry. */
function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') flags.dry = true;
    else if (a === '--model') flags.model = argv[++i];
    else if (a === '--judge') flags.judge = argv[++i];
  }
  return flags;
}

/** Sanitize a label for use in a filename. */
function safeLabel(s) {
  return String(s || 'claude').replace(/[^a-z0-9._-]/gi, '_');
}

async function cli(argv) {
  const flags = parseFlags(argv);
  const cases = loadCases();
  const date = new Date().toISOString();

  if (flags.dry) {
    // Offline smoke run: prints only, writes nothing, marked synthetic.
    const agent = makeFakeAgent(cases);
    const agg = await runBenchmark(cases, { agent });
    process.stdout.write(renderReport(agg, { model: 'FAKE (dry run)', synthetic: true, date, cases }) + '\n');
    process.stdout.write('(dry run — synthetic; no files written)\n');
    return;
  }

  let judge = null;
  if (flags.judge) {
    const mod = await import(pathToFileURL(resolve(process.cwd(), flags.judge)).href);
    judge = mod.judge || mod.default;
    if (typeof judge !== 'function') throw new Error(`--judge module must export a \`judge\` fn: ${flags.judge}`);
  }

  const model = flags.model || 'claude';
  const agent = claudeAgent(flags.model);
  const agg = await runBenchmark(cases, { agent, judge });
  const report = renderReport(agg, { model, synthetic: false, date, cases });

  const label = safeLabel(flags.model);
  const stamp = date.replace(/[:.]/g, '-');
  const outDir = join(REPO_ROOT, 'benchmarks', 'results');
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `behavior-${label}-${stamp}`);
  writeFileSync(`${base}.json`, JSON.stringify({ model, date, ...agg }, null, 2));
  writeFileSync(`${base}.md`, report);

  process.stdout.write(report + '\n');
  process.stdout.write(`Wrote ${base}.json and ${base}.md\n`);
}

// Run only when invoked directly, so importing this module for tests never
// shells out to `claude`. realpath handles symlinked bins.
const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  cli(process.argv.slice(2)).catch(err => {
    console.error('benchmark error: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  });
}
