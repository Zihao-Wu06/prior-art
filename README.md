# Prior Art

**Search prior art before you build.**

Prior Art is an evidence engine that stops AI coding agents from reinventing the wheel. Today it gives you a reuse ladder, dependency due diligence, and a decision-note format an ADR can point to. A wheel-reinvention audit ships in v0.2, a discovery pipeline with an MCP server and knowledge packs in v0.3, and a GitHub Action plus a public Wheel Reinvention Index in v0.4.

## Why

AI coding agents fail in two directions, and most tools in this space only guard against one of them.

**Reinventing the wheel.** Left to their own judgment, agents hand-roll date pickers, auth flows, ID generators, and retry loops that the standard library, the platform, or an already-installed dependency already covers. The result is more code to maintain and more surface area for bugs the ecosystem solved years ago.

**Reaching for unvetted dependencies.** The opposite failure is just as real: an agent adds a package to solve a three-line problem, with no check on maintenance status, license, or supply-chain risk. Left-pad, xz-utils, and a steady stream of typosquats and abandoned packages are why "just add a dependency" isn't automatically the safe choice either.

Prior Art isn't a library salesman and it isn't a minimalism zealot. It's a due-diligence officer: whichever direction an agent leans, it asks for the same thing — evidence, and a record of the tradeoff.

## Quick start

```bash
npx priorart init
pa report zod
```

`init` scaffolds a `.prior-art.json` config in your project; `report` pulls dependency health, security, and license signals for a single package.

Inside Claude Code:

```
/plugin marketplace add zihaowu/prior-art
/plugin install prior-art@prior-art
```

The plugin adds the Gate skill, the ADR skill, and the three-layer hook chain described below.

## What works today

Honest inventory — what's shipped vs. what's planned.

| Version | Ships |
|---|---|
| **v0.1** (today) | `pa report <pkg>` (7 ecosystems) · `pa init` · `pa adr new` / `pa adr list` · `pa stats` (ledger) · Claude Code plugin (Gate skill + ADR skill + 3-layer hooks) |
| v0.2 | `pa audit` — wheel-reinvention detector |
| v0.3 | `pa search`, MCP server, knowledge packs |
| v0.4 | GitHub Action, benchmark runner, public Wheel Reinvention Index |

## The reuse ladder

Stop at the first rung that actually satisfies the need — don't keep climbing.

0. **do-nothing** — the need is speculative; don't build it yet.
1. **built-in** — the language or standard library already covers it.
2. **native-platform** — a browser, OS, database, framework, or protocol primitive covers it.
3. **installed-capability** — an already-installed dependency, a connected MCP server, or an installed skill covers it.
4. **existing-solution** — a whole existing project or self-hosted solution can be adopted or forked.
5. **open-source** — pull in a new, mature open-source library.
6. **commercial** — buy reliability, compliance, or time.
7. **in-house** — build it, because it's actual differentiation.

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
| `strict` | `standard`, plus a one-time pre-write nudge on `PreToolUse(Write)` — at most once per session per capability. |

Sensitivity is set via the `sensitivity` key in `.prior-art.json`; the default is `light`. This repo's own config dogfoods `standard`.

## Design principles

- **Zero runtime dependencies.** A tool preaching dependency discipline should have none of its own.
- **Keyless public data sources only** — deps.dev, OSV.dev. No signup between `npx` and a useful first report.
- **No build step.** Plain ESM JavaScript with JSDoc types; see [ADR-0001](docs/decisions/0001-plain-esm-javascript.md).
- **Sensitivity levels exist because annoyance kills adoption** — the gate is designed to be turned down, not fought with.

## Roadmap

Sequenced hardest-to-copy first, so the project stays worth using even if the easier parts get replicated elsewhere.

- **v0.2 — audit.** The wheel-reinvention detector: scan a repository for hand-rolled code that an installed dependency or the standard library already covers, and produce a report with file/line findings and estimated lines saved. This is the killer feature.
- **v0.3 — discovery.** A search pipeline across the repo, installed capabilities, registries, and GitHub; an MCP server exposing it as a tool; and the first knowledge packs (JS and Python).
- **v0.4 — closing the loop.** A GitHub Action for PR-time dependency review and diff-level reinvention detection, the full benchmark runner, and the first public Wheel Reinvention Index.

## Credits

Inspired by [buy-vs-build](https://github.com/stdin/buy-vs-build), [reuse-before-build](https://github.com/ShanedevPro/dont-reinvent-the-wheel-skill), and [ECC search-first](https://github.com/affaan-m/ECC/blob/main/skills/search-first/SKILL.md); prior-art adds the discovery, detection, and evidence layers.

## License

MIT

[中文文档](docs/README.zh-CN.md)
