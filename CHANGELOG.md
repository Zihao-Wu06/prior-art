# Changelog

## 0.2.0 — 2026-07-09

- `pa audit`: wheel-reinvention detector (JS/TS + Python pattern catalog, coverage resolution against installed deps and runtime builtins, --json/--dir/--include-tests/--suggest/--ci)
- new skill: prior-art-audit (in-session verification and fix layer)

## 0.1.1 — 2026-07-09

- fixed all 7 findings from the first cross-vendor code review (hook exit-code masking, 404 negative-TTL, CLI entrypoint guard, flag value validation, decision-note mode validation, ledger finiteness + atomic writes)

## 0.1.0 — 2026-07-09

- initial skeleton: reuse ladder core, keyless dependency report, ADR/ledger CLI, Claude Code plugin (gate skill + 3-layer hooks), bilingual docs, benchmark seed
