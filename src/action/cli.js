#!/usr/bin/env node
// Thin IO wrapper around the PR-review orchestrator. Reads the diff and PR
// context from the environment (as the composite action wires them), runs the
// review, writes the Markdown to $GITHUB_STEP_SUMMARY when present, and exits
// with the review's exit code. All logic lives in pr-review.js so it stays
// testable; this file only touches the environment and the filesystem.

import { readFileSync, appendFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { run } from './pr-review.js';

/** Interpret a GitHub Actions truthy input. */
function truthy(v) {
  return /^(1|true|yes|on)$/i.test(String(v || '').trim());
}

async function main() {
  const env = process.env;

  let diffText = '';
  const diffFile = env.DIFF_FILE;
  if (diffFile) {
    try {
      diffText = readFileSync(diffFile, 'utf8');
    } catch (err) {
      console.error(`prior-art: could not read DIFF_FILE (${diffFile}): ${err.message}`);
    }
  }

  const decisionText = env.DECISION_TEXT || env.PR_BODY || '';
  const strict = truthy(env.STRICT);
  const rootDir = env.GITHUB_WORKSPACE || process.cwd();

  const { exitCode, summary } = await run({ diffText, decisionText, rootDir, strict });

  const stepSummary = env.GITHUB_STEP_SUMMARY;
  if (stepSummary) {
    try {
      appendFileSync(stepSummary, summary + '\n');
    } catch (err) {
      console.error(`prior-art: could not write GITHUB_STEP_SUMMARY: ${err.message}`);
    }
  }

  process.exit(exitCode);
}

// Only run when invoked directly — importing this module (e.g. in tests) must
// not read env, post a summary, or terminate the process.
const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch(err => {
    // Never fail the job with a stack trace from the harness itself; a broken
    // wrapper should not block a PR. Report and exit clean.
    console.error(`prior-art: unexpected error: ${err && err.stack ? err.stack : err}`);
    process.exit(0);
  });
}
