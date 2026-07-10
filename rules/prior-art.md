<!-- Single source of truth. Copies for other agents (Cursor, Codex, Copilot, AGENTS.md, and friends) are generated from this file — edit here only; sync tooling ships with v0.2. -->

# Prior Art — search prior art before you build

The cheapest code is code you don't own — but every dependency is ownership too (its supply chain, its upgrade tax, and its next CVE become yours). Do due diligence in **both** directions: don't hand-roll what already exists, and don't add what you don't need.

**Classify first.** Core differentiation or context? Commodity or novel? Reuse context and commodity aggressively; build core and novel. Scale scrutiny to reversibility — two-way doors decide fast, one-way doors get real scrutiny and an exit note.

**Reuse ladder** — stop at the first rung that truly satisfies the requirement; ties break toward less ownership unless correctness, safety, or UX would suffer:
1. `do-nothing` — drop speculative or unneeded requirements
2. `built-in` — language and standard library
3. `native-platform` — browser/OS/database/framework/protocol primitives
4. `installed-capability` — dependencies already installed, connected MCP servers, installed skills
5. `existing-solution` — adopt or fork a whole project or template (first stop when the task is "build an app or service")
6. `open-source` — add one mature library
7. `commercial` — buy reliability, compliance, or time
8. `in-house` — build it; core differentiation, or reuse fails a real constraint

**Fit over fame.** When several options satisfy a rung, choose by the requirement's actual shape — directionality, volume/latency, consistency, failure modes, operational fit — not popularity.

**Due diligence.** Before adopting anything new, run `pa report <pkg> [--eco npm|pypi|go|maven|cargo|nuget|rubygems]`, read the flags (deprecated, vulnerabilities, staleness, bus factor, install scripts, license conflicts, low adoption), and paste the Evidence line into the decision record.

**Coverage honesty.** Whenever you report search results, name what you checked and what you skipped — e.g. `Checked: repo, installed deps, knowledge. Skipped: registries, GitHub (offline).` Never claim "nothing exists" when channels went unsearched.

**Record non-obvious decisions in this exact one-line format (a parser reads it):**
`Decision: use <rung>: <option> [mode: <mode>]. Tradeoff: <why it wins>. Rejected: <next-best> because <constraint>. Revisit if <specific trigger>.`

Rung ids: `do-nothing, built-in, native-platform, installed-capability, existing-solution, open-source, commercial, in-house`. Modes: `adopt, extend, compose, build`. Durable, contested, or architectural decisions get an ADR: `pa adr new "<title>" --rung <id> --mode <id>`.

**Guardrails.** Never outsource core differentiation, trust-boundary or security logic, or tiny code clearer than a dependency; never reimplement `alwaysReuse` items or outsource `alwaysBuild` items (both lists live in `.prior-art.json`, alongside `priorities` that weight the tradeoff).
