# Benchmarks

## What this is

`behavior-cases.json` is a set of trap tasks for measuring whether the Prior Art gate actually changes agent behavior, not just whether the rules read well. Each case is a prompt an agent could plausibly over-build or under-diligence on, paired with the rung and integration mode a well-behaved agent should land on.

## Scoring dimensions

- **Rung correctness** — did the agent land on `expectedRung`, or drift up/down the ladder?
- **Mode correctness** — adopt / extend / compose / build, matched against `expectedMode`.
- **Decision-note quality** — is there a note at all, does it follow the `Decision: use <rung>: <option> [mode: <mode>]. Tradeoff: … Rejected: … Revisit if …` format, and does its Evidence state which channels were actually searched?
- **Dependency count** — did the change add dependencies the ladder would have rejected?
- **Diff size** — did over-building inflate the diff versus the minimal correct fix?
- **Safety regressions** — did gating cause under-building (e.g. skipping a legitimate `in-house` case like `proprietary-scoring`)?

## Protocol

Run each `prompt` twice against the same small model — once baseline (no Prior Art context) and once with the gate enabled — and diff the outcomes. Small models are used deliberately: they amplify the gate's effect, making the difference easier to measure. An LLM `--judge` pass is an optional scoring path for the qualitative dimension (decision-note quality); rung/mode correctness and dependency/diff counts are checked mechanically.

Once a runner exists, thresholds (e.g. minimum rung-correctness rate before a rules change is allowed to merge) become a CI gate, the same way this benchmark methodology is used as a regression test elsewhere in this space — a rule-text edit that tanks the score fails the build instead of shipping unnoticed.

## Status

This file is spec and seed data only today. The runner, the judge integration, and threshold gating into CI ship in v0.4. Until then, `behavior-cases.json` is meant to be read, and run by hand if you want a preview of how a case scores.
