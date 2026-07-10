---
name: prior-art
description: Use when writing code, implementing a feature, adding or upgrading a dependency, choosing a library, framework, tool, or service, about to hand-roll a utility, helper, parser, client, or component, or reviewing whether custom code should exist at all — walk the reuse ladder, do due diligence in both directions, and leave evidence before you build.
---

# Prior Art: search before you build

The cheapest code is code you don't own. But every dependency is ownership too — its transitive tree, its release cadence, its next CVE, and its maintainer's bus factor all become yours the moment you import it. So this is a due-diligence gate in **both** directions: it stops you from hand-rolling what already exists, and from pulling in a dependency you don't need. It is not a library salesman. When the call is obvious, implement and move on — the ceremony below is only for the ones that aren't.

## Classify before you climb

Two questions set how hard to look and where to land:

- **Core or context?** Core is the thing users choose you for. Context is necessary plumbing no one rewards you for owning.
- **Commodity or novel?** Commodity problems have many mature solutions; novel ones have few or none.

|               | Context                                | Core                                    |
|---------------|----------------------------------------|-----------------------------------------|
| **Commodity** | Reuse aggressively, minimal ceremony   | Reuse the substrate, build the thin edge |
| **Novel**     | Reuse if it exists; expect to compose  | Build — this is your moat                |

Then scale scrutiny to **reversibility**. Two-way doors (a formatter, a helper you can swap in an afternoon) get a fast decision — don't over-research them. One-way doors (a database, an auth provider, a data model or platform you will build on) get real scrutiny and an **exit note**: how you would get out and what it would cost.

## The ladder

Stop at the first rung that truly satisfies the requirement. When two rungs both work, break the tie toward **less ownership** — unless correctness, safety, or UX would suffer.

| # | rung | it wins when |
|---|------|--------------|
| 1 | `do-nothing` | the requirement is speculative — the best code is the code you delete |
| 2 | `built-in` | the language or standard library already does it |
| 3 | `native-platform` | the browser/OS/database/framework/protocol offers a primitive |
| 4 | `installed-capability` | a dependency you already have, a connected MCP server, or an installed skill covers it |
| 5 | `existing-solution` | the task is "build an app or service" and a whole project or template can be adopted or forked |
| 6 | `open-source` | one mature library fills a real gap the lower rungs leave open |
| 7 | `commercial` | buying reliability, compliance, or time beats owning the problem |
| 8 | `in-house` | it is core differentiation, or every reuse option fails a real constraint |

## Fit over fame

When several options satisfy a rung, choose by the requirement's actual **shape** — directionality, volume and latency, consistency needs, failure modes, operational fit — not by stars or mindshare.

- **Caching:** an in-process LRU is the honest fit for a single instance that tolerates a cold start. The moment cache state must be shared across instances and survive deploys, the shape demands a networked cache — hop and operational cost included. Popularity decides neither way.
- **Full-text search:** if the corpus is small and you already run Postgres, `tsvector` is the fit and stays on the `installed-capability` rung. Once you need relevance ranking, typo tolerance, and faceting over millions of rows, the shape has outgrown the database and earns a dedicated search engine — not one row sooner.

## Search: quick vs full

- **quick** (default): repo + installed capabilities + trusted knowledge. Seconds. Enough for most in-flight calls.
- **full**: add registries, GitHub, and the web. Use it for any new-dependency decision, or whenever the user asks.

Channels: `repo / installed deps / MCP+skills / registries / GitHub / knowledge`. Run `pa audit` for wheels already built, and `pa search "<need>" [--eco npm|cargo] [--limit N]` for candidate discovery — it sweeps this repo, the package registry, and GitHub in one call and prints its own coverage line. Installed-capability and knowledge channels are still on the roadmap; check those directly for now, and vet anything you would add with `pa report`.

**Coverage honesty (hard rule).** Every time you report what you found, end with one line naming the channels you actually searched and the ones you skipped and why:

```
Checked: repo, installed deps, knowledge. Skipped: registries, GitHub (offline).
```

Reporting "nothing exists" while channels went unsearched is a violation, not a shortcut.

## Due diligence before adopting

Before you add anything new, run it through the report and read the flags:

```
pa report <pkg> [--eco npm|pypi|go|maven|cargo|nuget|rubygems]
```

Watch for: deprecated, known vulnerabilities, staleness (no recent maintenance), thin bus factor (a lone maintainer), install/postinstall scripts, license conflicts, and low adoption. Paste the **Evidence** line it prints into your decision record. Signals inform the call; they do not make it — a pristine package that is wrong for the shape is still wrong, and a low-star package that fits can still win. Fit and core-vs-context stay human judgment.

## Write the decision down

- **Obvious** (reading a file with the stdlib): just implement. No note.
- **Non-obvious**: one line, this exact format — a parser reads it:

```
Decision: use <rung>: <option> [mode: <mode>]. Tradeoff: <why it wins>. Rejected: <next-best> because <constraint>. Revisit if <specific trigger>.
```

Example:

```
Decision: use built-in: node:crypto randomUUID [mode: adopt]. Tradeoff: covers our id needs with zero new surface. Rejected: the uuid package because it adds a dependency for what the runtime already ships. Revisit if we need time-sortable ids such as ULID.
```

- **Durable or architectural** (a new dependency, a new service, a one-way door): open an ADR and fill its Evidence section, coverage line included. Hand off to the `prior-art-adr` skill:

```
pa adr new "<title>" --rung <id> --mode <id>
```

## Integration modes

The note names both the rung **and** the mode:

- **adopt** — use it as-is, no wrapper.
- **extend** — a thin wrapper that adds only what is missing.
- **compose** — combine two or three small pieces into the capability.
- **build** — write it yourself, informed by what you found.

## Rationalizations to catch

These are the things a model tells itself right before it reinvents a wheel. Name the thought; apply the corrective.

| The thought | The corrective |
|-------------|----------------|
| "This need is too specific to have prior art." | Specific needs are usually a config of a general one. Search first, conclude after — the niche you think is yours alone usually has a battle-tested option. |
| "It's faster to write than to search." | You are pricing five minutes of typing against five minutes of searching and ignoring the years of edge cases, maintenance, and CVEs you would own. |
| "The existing options aren't a perfect fit." | Perfect fit is rare and rarely required. A 90% fit you extend beats a 100% fit you maintain forever — build only when the gap is core. |
| "The user didn't ask me to look." | Due diligence is implied by the task, not the prompt. Silently hand-rolling a solved problem is exactly what review would flag. |
| "I'll replace this quick version later." | "Later" is a bet you usually lose; the stub becomes load-bearing. Decide now, and if you truly must stub, leave the note so the debt stays visible. |
| "I already know the right library for this." | Your knowledge has a cutoff and libraries move. The one you remember as healthy may be deprecated or compromised — verify with `pa report` before you commit. |
| "One more dependency won't hurt." | Each one is a standing liability whose transitive tree and maintainer become yours. Add on evidence, not reflex. |
| "Rolling my own is safer than a black box." | For crypto, auth, and parsing the opposite holds — audited libraries have survived attacks your handwritten version never has. Never hand-roll a trust boundary. |

## Guardrails

- Never outsource **core differentiation**, **trust-boundary or security logic**, or **code small and clear enough to beat the cost of a dependency**.
- Never reimplement anything matching `alwaysReuse`; never outsource anything matching `alwaysBuild`; weight tradeoffs by the project's `priorities`. (All three lists live in `.prior-art.json`.)

## Verify it paid off

After a non-obvious choice, confirm the reuse actually cut code, failure modes, or operational burden. If it did, record the win:

```
pa stats record lines-avoided <n> "<what>"     # or: pa stats record dep-averted 1 "<what>"
```

A sound choice that is badly integrated — a wrapper that leaks, two sources of truth, a dependency you use 5% of — is a finding to fix, not a victory to log.
