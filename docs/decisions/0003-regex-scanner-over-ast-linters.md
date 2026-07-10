# 0003. Line-level regex scanner over AST linters for the audit engine

- Status: Accepted
- Date: 2026-07-10
- Rung: in-house
- Mode: build

## Context

`pa audit` needs to find hand-rolled code that installed dependencies or the
standard library already cover. Mature prior art overlaps with parts of this:
eslint-plugin-unicorn (`prefer-structured-clone`, `prefer-string-slice`, …)
for JS at AST precision, ruff/refurb rules for Python, and ast-grep for
polyglot structural search. Composing them was the obvious rung-5/6 option —
and this project's own hard rule says a decision this size gets an ADR.

## Decision

Build a small in-house engine: a line-level regex scanner over a curated
pattern catalog, with coverage resolution against the audited project's
actual inventory.

**Tradeoff:** what the linters cannot do is the product's core, not the
margin: (1) coverage resolution — "use `_.debounce`" is only correct advice
when lodash is *in this project's* dependencies and the built-in alternative
clears *this project's* engines floor; linters recommend unconditionally.
(2) One catalog spanning JS/TS and Python with one firing contract, instead
of three toolchains with three config surfaces. (3) Output shaped for an
agent verifier — every finding carries the claimed replacement, its version
gate, and an fpNote naming how the replacement can mislead; linters emit
pass/fail for humans. (4) Zero config and zero dependencies, which is the
project's own creed. Regex precision is strictly worse than AST — the design
compensates with the two-tier firing contract (distinctive names may fire
alone; generic names need body corroboration) and by defining the model,
not the engine, as the semantic judge.

**Rejected:** composing eslint-plugin-unicorn + ruff/refurb + ast-grep
because it buys AST precision at the cost of per-language toolchains and
runtime dependencies, and still leaves the differentiating layers
(inventory-aware resolution, verifier-oriented output) to be built in-house
anyway — the reuse would cover the cheap part and keep the expensive part.

## Evidence

Checked: repo (no existing scanner), installed capabilities (zero-dep
constraint rules out runtime linter deps), open-source landscape
(unicorn/ruff/refurb/ast-grep — overlapping rules confirmed, none do
inventory-aware coverage resolution or agent-verifier output). Skipped:
commercial SAST (wrong cost class for a zero-config CLI).

## Consequences

Revisit if the catalog approaches ~100 patterns or false-positive pressure
demands structural precision — the likely path then is ast-grep as an
optional engine behind the same catalog and finding schema, not a rewrite.
