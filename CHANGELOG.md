# Changelog

## 0.4.0 — 2026-07-10

Closing the loop. Three deliverables, built in parallel and put through an
adversarial review pass before landing.

### Added
- **GitHub Action** (`action.yml`, composite) — PR-time review: lists new
  dependencies and whether each is backed by a decision note, and flags
  reinvented wheels **introduced by the diff** (findings outside the changed
  lines are excluded). `strict` input fails the check on undocumented deps or
  high-confidence wheels. Pure parsers/renderer in `src/action/`
  (`diff.js`, `render.js`, `pr-review.js`) with an injectable audit;
  `src/action/cli.js` does the IO (entrypoint-guarded).
- **Behavior benchmark runner** (`scripts/benchmark.js`, `grade.js`,
  `benchmark-gate.js`) — measures whether the reuse-ladder gate changes an
  agent's rung/mode choice. `npm run benchmark:gate` (in `npm test`) proves
  the grader discriminates; `npm run benchmark:dry` is an offline synthetic
  smoke run; `npm run benchmark -- --model <id>` is the real run.
- **Wheel Reinvention Index** (`scripts/wheel-index.js`,
  `docs/wheel-reinvention-index.md`) — ranks models by how often the un-gated
  baseline reinvents the wheel. Ships **empty**: no measured numbers until a
  real run.

### Honesty
- The repo asserts no benchmark numbers. A run whose agent errored is reported
  as an error, never as a zero-score measurement. The Index empty state prints
  methodology only, never placeholder percentages.

### Fixed (from the v0.4 adversarial review, pre-merge)
- benchmark→index schema mismatch: the Index consumer read a shape the
  runner never emits, which would have published every model as
  `unknown | 0/0 | 100%` on the first real run. Consumer aligned to the
  producer's flat `byCase[].baselineRungCorrect` / top-level `model`, with an
  end-to-end producer→consumer regression test.
- benchmark report now surfaces an agent-error count instead of silently
  rendering an all-errored run as an all-zero result.
- action `cli.js` entrypoint-guarded so importing it has no side effects.

## 0.3.4 — 2026-07-10

Third full review (independent agent): all confirmed correctness/security
findings fixed.

- **P0** GitHub search cache is partitioned per token fingerprint (token A's
  auth-scoped results can never replay for token B or anonymous runs), and
  the cache is owner-only (dir 0700, files 0600, pre-existing entries
  repaired on read)
- SPDX classification is expression-aware: `MIT OR GPL-3.0` is permissive
  (consumer's choice), `LGPL AND GPL` is strong-copyleft (both apply),
  `UNLICENSED` is proprietary (new class + warn flag) — string-contains
  matching removed
- `engines.node` floors parse real ranges: the floor of
  `>=22 <23 || >=20 <21` is 20, not 22
- ledger: corrupt files are backed up (`ledger.json.corrupt-<ts>`) before a
  fresh start — never silently wiped; per-process temp names remove the
  shared-tmp rename race; ADR numbering takes the next free slot instead of
  overwriting on collision; CJK ADR titles slug correctly
- `pa report --require-complete`: exit 3 when any signal source was
  unreachable; the Evidence line itself now carries skipped-source notes
  (it travels into ADRs alone); project license resolves from the project
  root, npm-only for now
- malformed `.prior-art.json` keeps anchoring the project root (no more
  split ledgers), and config warnings/errors print to stderr instead of
  silently degrading; `alwaysBuild`/`alwaysReuse`/`priorities` are now
  injected into the session context so the model actually sees them
- audit: monorepo roots print an explicit root-manifest-only warning
  (workspaces/pnpm-workspace/lerna detected); coverage line reports
  oversized/unreadable file gaps; CI workflow now runs `audit --ci`
- search: CJK queries tokenize (repo channel no longer blind to 中文);
  repo-channel hit cap is disclosed; strict-gate path matching works on
  Windows separators
- skills: the trust-boundary guardrail no longer contradicts the red-flags
  table (adopt audited primitives, own the responsibility); the audit skill
  no longer writes the ledger as a side effect of read-only review;
  EventEmitter fpNote fact-checked (listeners run in registration order)
- npm pack now includes the Chinese README and CHANGELOG

## 0.3.3 — 2026-07-10

All confirmed findings from the second full review (independent agent, cold
clone) fixed:

- **P0** `pa report` scopes its OSV query to the latest version — historical,
  long-fixed CVEs no longer count against the current release (lodash/express
  /zod were all flagged HIGH and failed CI gating before this)
- **P0** `pa adr new` no longer crashes when the scaffolded template is
  missing: the template is now a shared built-in constant (and the file is
  committed to the repo)
- audit's JS built-in gating uses the audited project's `engines.node` floor
  when declared, not the CLI's own runtime (symmetric with requires-python)
- devDependencies are inventoried separately and never offered as runtime
  coverage
- unknown flags are rejected with an error instead of being silently
  swallowed into positionals (`--` ends option parsing for literal words)
- all fetches carry a 15s AbortSignal.timeout
- ledger and ADRs resolve the project root (the `.prior-art.json` owner) —
  running from a subdirectory can no longer create a second ledger
- sensitivity values are normalized and validated (with a `_warning`)
- hooks ship `commandWindows` variants
- skills/rules no longer reference config keys that don't exist; audit
  skill's `--suggest` description corrected
- CI workflow added (Node 20/22); ADR-0003 records the regex-vs-AST-linters
  build decision; `pa search` coverage line declares the repo channel is
  js/py-only

## 0.3.2 — 2026-07-09

Fixes from the first blind user test (an agent evaluating the tool cold, no
guidance): `pa --help`/`-h` now exit 0; README documents `pa report`'s
exit-1-on-HIGH semantics, install-from-clone (npm publish pending), and the
`~/.cache/priorart/` location; ladder numbering unified to 1–8 everywhere
(README said 0–7 while the hooks injected 1–8); strict-mode wording corrected
to once-per-session; stale `pa stats` empty-state text rewritten; dead
`strictness` config key removed; retry pattern now catches `retryWithBackoff`
-style names; Roadmap/Search section untangled; duplicate "(today)" markers
dropped.

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
