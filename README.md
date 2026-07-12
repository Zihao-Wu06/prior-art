# Prior Art

**Search prior art before you build.**

Prior Art is an evidence engine that stops AI coding agents from reinventing the wheel. Today it gives you a reuse ladder, dependency due diligence, a decision-note format an ADR can point to, and a wheel-reinvention audit (`pa audit`) that finds hand-rolled code your installed dependencies or standard library already cover. It also searches for prior art on demand: `pa search "<what you need>"` sweeps your own repo, the package registry, and GitHub before you build. Next up: the installed-capability index, knowledge packs, and an MCP server complete v0.3; a GitHub Action plus a public Wheel Reinvention Index land in v0.4.

## Why

AI coding agents fail in two directions, and most tools in this space only guard against one of them.

**Reinventing the wheel.** Left to their own judgment, agents hand-roll date pickers, auth flows, ID generators, and retry loops that the standard library, the platform, or an already-installed dependency already covers. The result is more code to maintain and more surface area for bugs the ecosystem solved years ago.

**Reaching for unvetted dependencies.** The opposite failure is just as real: an agent adds a package to solve a three-line problem, with no check on maintenance status, license, or supply-chain risk. Left-pad, xz-utils, and a steady stream of typosquats and abandoned packages are why "just add a dependency" isn't automatically the safe choice either.

Prior Art isn't a library salesman and it isn't a minimalism zealot. It's a due-diligence officer: whichever direction an agent leans, it asks for the same thing — evidence, and a record of the tradeoff.

## Quick start

> **Not on npm yet.** Until `priorart` is published, install from a clone:
>
> ```bash
> git clone https://github.com/Zihao-Wu06/prior-art && cd prior-art && npm link
> ```

```bash
pa init
pa report zod
```

`init` scaffolds a `.prior-art.json` config in your project; `report` pulls dependency health, security, and license signals for a single package. **`pa report` exits 1 when it finds HIGH flags** (known vulnerabilities, deprecation) — that is deliberate, so it can gate CI; account for it in `set -e` scripts. Network results are cached under `~/.cache/priorart/` (24h; `--fresh` bypasses).

Inside Claude Code:

```
/plugin marketplace add Zihao-Wu06/prior-art
/plugin install prior-art@prior-art
```

The plugin adds the Gate skill, the ADR skill, and the three-layer hook chain described below.

## Audit

`pa audit` scans a repo for hand-rolled code that an installed dependency or the standard library already covers. It works in two deterministic steps: mining candidates from a pattern catalog (JS/TS and Python), then resolving coverage against *your* installed dependencies and runtime — not a generic library list. It's designed to be verified by the model in-session via the `prior-art-audit` skill, which checks each finding against your code before proposing a fix.

```bash
pa audit                              # scan the current directory
pa audit --dir ../other-repo --json   # audit another repo, machine-readable output
pa audit --suggest                    # also flag well-known libraries you haven't installed
pa audit --ci                         # exit 1 when high-confidence findings exist, for CI gates
```

Heuristics propose, the skill (or you) verify: every finding carries its claimed replacement and caveats, and false positives are expected — treat the output as a worklist, not an oracle.

## What works today

Honest inventory — what's shipped vs. what's planned.

| Version | Ships |
|---|---|
| v0.1 | `pa report <pkg>` (7 ecosystems) · `pa init` · `pa adr new` / `pa adr list` · `pa stats` (ledger) · Claude Code plugin (Gate skill + ADR skill + 3-layer hooks) |
| v0.2 | `pa audit` — wheel-reinvention detector: finds hand-rolled code that installed deps or the stdlib already cover |
| v0.3 | `pa search` — prior-art discovery across your repo, the package registry (npm/crates), and GitHub, with per-channel coverage honesty |
| **v0.4** (today) | GitHub Action (PR-time dependency review + diff-scoped reinvention detection) · behavior benchmark runner + honesty gate · the [Wheel Reinvention Index](docs/wheel-reinvention-index.md) methodology |
| v0.3 (rest) | installed-capability index, knowledge packs, MCP server |

## The reuse ladder

Stop at the first rung that actually satisfies the need — don't keep climbing.

1. **do-nothing** — the need is speculative; don't build it yet.
2. **built-in** — the language or standard library already covers it.
3. **native-platform** — a browser, OS, database, framework, or protocol primitive covers it.
4. **installed-capability** — an already-installed dependency, a connected MCP server, or an installed skill covers it.
5. **existing-solution** — a whole existing project or self-hosted solution can be adopted or forked.
6. **open-source** — pull in a new, mature open-source library.
7. **commercial** — buy reliability, compliance, or time.
8. **in-house** — build it, because it's actual differentiation.

Every choice also carries an integration mode — **adopt / extend / compose / build** — describing *how* the option gets used. Mode is orthogonal to rung: it answers "how," not "which level."

## Decision notes & ADRs

Every non-trivial choice gets a one-line decision note:

```
Decision: use built-in: crypto.randomUUID [mode: adopt].
Tradeoff: no extra dependency vs. no custom ID format.
Rejected: uuid package, because Node 20's crypto.randomUUID already covers this.
Revisit if we need a non-v4 UUID variant.
```

Larger or harder-to-reverse choices get a full ADR under `docs/decisions/`, which adds an `## Evidence` block on top of the same format.

Coverage honesty is not optional. An Evidence block has to state which channels were actually searched — repo, installed deps/MCP/skills, registries, GitHub, knowledge packs — and which were skipped, and why. Claiming "nothing exists" without having searched those channels is treated as a defect in the note, not a shortcut.

A full ADR also carries Status, Date, Rung, and Mode as front-matter, plus Context and Consequences sections around the Decision/Tradeoff/Rejected/Evidence content — see [ADR-0001](docs/decisions/0001-plain-esm-javascript.md) for a worked example.

## Sensitivity levels

Annoyance is the main way tools like this get uninstalled, so the gate escalates only as far as you configure it to.

| Level | Behavior |
|---|---|
| `off` | No hooks fire. |
| `light` | `SessionStart` injects compressed ladder context only. |
| `standard` | `light`, plus a prompt-level gate on `UserPromptSubmit` for build/implement-shaped requests. |
| `strict` | `standard`, plus a one-time pre-write nudge on `PreToolUse(Write)` — at most once per session. |

Sensitivity is set via the `sensitivity` key in `.prior-art.json`; the default is `light`. This repo's own config dogfoods `standard`.

## Design principles

- **Zero runtime dependencies.** A tool preaching dependency discipline should have none of its own.
- **Keyless public data sources only** — deps.dev, OSV.dev. No signup between `npx` and a useful first report.
- **No build step.** Plain ESM JavaScript with JSDoc types; see [ADR-0001](docs/decisions/0001-plain-esm-javascript.md).
- **Sensitivity levels exist because annoyance kills adoption** — the gate is designed to be turned down, not fought with.

## Roadmap

Sequenced hardest-to-copy first, so the project stays worth using even if the easier parts get replicated elsewhere.

- **v0.2 — audit. Shipped.** The wheel-reinvention detector: scans a repository for hand-rolled code that an installed dependency or the standard library already covers, and produces a report with file/line findings and estimated lines saved.
- **v0.3 — discovery.** `pa search` (repo + registry + GitHub channels) is live. Still to come: the installed-capability index, the first knowledge packs (JS and Python), and an MCP server exposing the pipeline to any agent.
- **v0.4 — closing the loop. Shipped.** A GitHub Action for PR-time dependency review and diff-scoped reinvention detection, a behavior benchmark runner that measures whether the gate changes an agent's decisions, and the Wheel Reinvention Index methodology. The Index ships **empty on purpose** — the repo asserts no measured numbers; you produce them by running the benchmark against real models.

## Search

`pa search "<what you need>"` checks three places before you write or install anything:

```
pa search retry with exponential backoff
pa search "markdown table parser" --eco cargo --limit 5
```

1. **This repo** — related definitions that already exist here (the cheapest rung).
2. **The package registry** — npm or crates.io keyless search (PyPI has no keyless search API; the report says so instead of pretending).
3. **GitHub** — top repositories by stars, with last-push date, license, and archived flags. Unauthenticated GitHub allows 10 searches/min; set `GITHUB_TOKEN` to raise it.

Every result block ends with a coverage line naming the channels searched and skipped — an empty channel means "no match found there", never "no solution exists". Vet candidates with `pa report <pkg>` and record the call with `pa adr new`.

## GitHub Action: PR-time review

Add `.github/workflows/prior-art.yml`:

```yaml
name: Prior Art
on: pull_request
jobs:
  prior-art:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: Zihao-Wu06/prior-art@v0.4
        with:
          strict: 'false'   # 'true' fails the check on undocumented deps or high-confidence wheels
```

It posts a job summary that (1) lists new dependencies and whether each is backed by a decision note (PR body / commit proximity, or a `docs/decisions/*.md` reference), and (2) flags reinvented wheels **introduced by the diff** — findings outside the changed lines are excluded. In `strict` mode the check fails when a new dependency lacks a decision note or a high-confidence wheel is added.

## Benchmark & the Wheel Reinvention Index

Does the reuse-ladder gate actually change an agent's decisions? That's a measurable claim, and until it's measured this project won't assert it. The benchmark runs each [behavior case](benchmarks/behavior-cases.json) through an agent twice — baseline vs. gate-enabled — and grades whether it picked the right rung and mode.

```
npm run benchmark:gate          # honest regression: proves the *grader* discriminates (in `npm test`)
npm run benchmark:dry           # offline smoke run against a FAKE agent — output is labelled SYNTHETIC, nothing written
npm run benchmark -- --model <id>   # real run: baseline vs gate-enabled via `claude -p`, writes benchmarks/results/
npm run index                   # (re)generate docs/wheel-reinvention-index.md from result files
```

The repo ships **no measured numbers**. The [Wheel Reinvention Index](docs/wheel-reinvention-index.md) is a methodology page that stays empty until you run the benchmark across models — a run that errored (e.g. `claude` not on PATH) is reported as an error, never as a zero-score result.

## Credits

Inspired by [buy-vs-build](https://github.com/stdin/buy-vs-build), [reuse-before-build](https://github.com/ShanedevPro/dont-reinvent-the-wheel-skill), and [ECC search-first](https://github.com/affaan-m/ECC/blob/main/skills/search-first/SKILL.md); prior-art adds the discovery, detection, and evidence layers.

## License

MIT

[中文文档](docs/README.zh-CN.md)
