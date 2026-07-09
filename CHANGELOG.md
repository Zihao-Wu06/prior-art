# Changelog

## 0.3.1 — 2026-07-09

- security/correctness fixes from the v0.3 cross-vendor review: GitHub search
  qualifier injection neutralized (user:/language:/stars: in a need is now
  literal text), and the HTTP cache is partitioned by auth mode so token-scoped
  GitHub results can never replay into unauthenticated runs

## 0.3.0 — 2026-07-09

- `pa search "<need>"`: prior-art discovery across three channels — this repo
  (definition-line scan), the package registry (npm / crates.io keyless search;
  PyPI honestly reported as unsearchable), and GitHub repositories (stars,
  last push, license, archived flags; GITHUB_TOKEN optional for higher limits)
- per-channel coverage honesty: every result ends with searched/skipped lines;
  a failed channel degrades to a reasoned skip, never a silent gap
- `--limit <n>` flag (default 8, max 20)

## 0.2.1 — 2026-07-09

- fixed all 9 findings from the v0.2 cross-vendor review: removed the shallow
  Object.assign claim from deep-merge, dropped over-generic name matches
  (generateId, parseParams), capped hint corroboration to the function block,
  line-level (not file-level) dedup so distinct wheel sites all fire,
  single-parameter arrow extraction, .mts/.cts collection, requires-python
  gating for Python builtins, --json on the empty-language path

## 0.2.0 — 2026-07-09

- `pa audit`: wheel-reinvention detector (JS/TS + Python pattern catalog, coverage resolution against installed deps and runtime builtins, --json/--dir/--include-tests/--suggest/--ci)
- new skill: prior-art-audit (in-session verification and fix layer)

## 0.1.1 — 2026-07-09

- fixed all 7 findings from the first cross-vendor code review (hook exit-code masking, 404 negative-TTL, CLI entrypoint guard, flag value validation, decision-note mode validation, ledger finiteness + atomic writes)

## 0.1.0 — 2026-07-09

- initial skeleton: reuse ladder core, keyless dependency report, ADR/ledger CLI, Claude Code plugin (gate skill + 3-layer hooks), bilingual docs, benchmark seed
