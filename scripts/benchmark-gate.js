// The HONEST regression: does the grading pipeline DISCRIMINATE?
//
// This checks the SCORING, not any model. It feeds canned baseline outputs
// (vague prose, no decision note) and canned enabled outputs (a correct
// decision note per case) through grade + aggregate, then asserts the harness
// separates them: enabled beats baseline by a clear margin and rung hits jump
// from zero to all. If someone breaks grading so the two conditions look
// identical, this check fails — which is exactly the property a benchmark that
// claims "the gate changes behavior" must guarantee about its own instrument.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { formatDecisionNote } from '../src/core/ladder.js';
import { gradeOutput, aggregate } from './grade.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadCases() {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'benchmarks', 'behavior-cases.json'), 'utf8'));
  return raw.cases;
}

/**
 * Run the discrimination self-check over the frozen behavior cases.
 * @returns {{ok:boolean, detail:object}} `ok` true iff grading separates
 *   weak baseline from strong enabled outputs as expected.
 */
export function runGateCheck() {
  const cases = loadCases();

  const perCase = cases.map(c => {
    const expected = { expectedRung: c.expectedRung, expectedMode: c.expectedMode };
    // Baseline: agrees to build, names no rung, writes no decision note.
    const baselineOut = `Sure, I'll add ${c.id}. Here's a quick implementation with a fresh dependency.`;
    // Enabled: the exact correct decision note for this case.
    const enabledOut = formatDecisionNote({
      rung: c.expectedRung,
      option: `the ${c.expectedRung} option`,
      mode: c.expectedMode,
      tradeoff: 'lowest ownership that satisfies the requirement',
      rejected: 'the hand-rolled alternative',
      revisit: 'the requirement changes'
    });
    return {
      id: c.id,
      baseline: gradeOutput(baselineOut, expected),
      enabled: gradeOutput(enabledOut, expected)
    };
  });

  const agg = aggregate(perCase);
  // Margin: at least +1 point per case on average, on top of clearing baseline.
  const margin = agg.n;
  const ok =
    agg.n > 0 &&
    agg.baselineTotal === 0 &&
    agg.rungHitsBaseline === 0 &&
    agg.rungHitsEnabled === agg.n &&
    agg.enabledTotal > agg.baselineTotal + margin;

  return {
    ok,
    detail: {
      n: agg.n,
      baselineTotal: agg.baselineTotal,
      enabledTotal: agg.enabledTotal,
      maxTotal: agg.maxTotal,
      delta: agg.delta,
      rungHitsBaseline: agg.rungHitsBaseline,
      rungHitsEnabled: agg.rungHitsEnabled,
      margin
    }
  };
}

// Allow `node scripts/benchmark-gate.js` to run the check and set the exit code.
const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  const result = runGateCheck();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
