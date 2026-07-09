# 0001. Plain ESM JavaScript, no TypeScript build

- Status: Accepted
- Date: 2026-07-09
- Rung: built-in
- Mode: adopt

## Context

v0.1 has to run via `npx priorart init` on a contributor's machine with zero setup. Any build step — compiling, bundling, or type-checking-then-emitting — adds a toolchain dependency between "clone" and "run." For a project at this stage, that friction lands on exactly the people it can least afford to lose.

## Decision

Use plain ESM JavaScript with JSDoc type annotations for editor and IDE type checking. No TypeScript compiler, no build step.

**Tradeoff:** No build step, `npx`-first, zero contributor toolchain — at the cost of weaker static guarantees than a real TypeScript compiler provides. JSDoc annotations catch less than `tsc` would, and it's easier for them to drift out of sync with the code.

**Rejected:** TypeScript, because compiling it before every run adds ownership — a build pipeline, a `dist/` directory to keep in sync, a new source of "works on my machine" bugs — that contradicts this project's own lowest-ownership creed. A tool that tells agents to prefer the option with the least owned surface area shouldn't own a build step it doesn't strictly need.

## Evidence

Pattern proven by prior art in the same niche: a zero-dependency, plain-JS ruleset project in this space has already shipped successfully on this exact setup — no build, run directly via `npx`, JavaScript plus JSDoc for types. Channels searched: internal reasoning and known ecosystem practice for CLI tools at this scale. Registries and GitHub were not searched — this is a style and tooling decision, not a "does a package already solve this" decision, so those channels don't apply.

## Consequences

Revisit if contributor count exceeds roughly 5, or if type-related bugs start recurring in ways JSDoc isn't catching.
