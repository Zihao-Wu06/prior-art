---
name: prior-art-adr
description: Use when a buy-vs-build or reuse decision is durable, contested, or architectural — record it as an ADR with evidence and a concrete revisit trigger instead of a throwaway note.
---

# Prior Art: architecture decision records

Most decisions need at most the one-line note from the `prior-art` skill. Reach for an ADR when the decision is expensive to reverse, or when a future teammate will ask "why did we do it this way?"

## A note is enough vs an ADR is warranted

A one-line note is enough when the choice is reversible, uncontested, and self-explanatory. Write an ADR when any of these holds:

- you are adding a **new dependency** or standing up a **new service**;
- it is a **one-way door** — a database, an auth model, a public API contract, a data format you will be stuck with;
- the option was **contested**, or the runner-up was close;
- someone six months out would need the reasoning to change it safely.

## Writing one

```
pa adr new "<title>" --rung <id> --mode <id>
```

Title the decision, not the question — "Adopt Postgres for the event store," not "Which database?" `--rung` takes a ladder id (`do-nothing`, `built-in`, `native-platform`, `installed-capability`, `existing-solution`, `open-source`, `commercial`, `in-house`); `--mode` takes `adopt`, `extend`, `compose`, or `build`.

Fill each section short and factual — a paragraph or two, prose over adjectives:

- **Context** — the requirement's shape and the hard constraints: volume, latency, consistency, compliance, team.
- **Decision** — the rung, the option, and the mode, in a sentence or two.
- **Evidence** *(carry the weight here)* — paste the `pa report <pkg>` evidence line for every candidate you weighed, plus the coverage statement (`Checked: … Skipped: …`). Without it the ADR is an opinion; with it, it is auditable.
- **Alternatives** — the next-best option and the constraint that eliminated it.
- **Consequences** — what you are accepting, and a **concrete revisit trigger**: a date, a version, a load threshold, a headcount — never "revisit later." For example: "Revisit when write throughput passes 5k events/s, or when a managed event store drops below our self-hosting cost."

Run `pa adr list` first to see whether a record already covers this ground. New records land in `docs/decisions/`, numbered in sequence. In miniature:

```
# Adopt Postgres for the event store
Rung: existing-solution   Mode: adopt

Context — ~2k events/s, queryable by aggregate id, replayable in order; the team
  already operates Postgres; no compliance driver for a managed store.
Decision — Append-only events table with a per-aggregate sequence; installed-capability,
  no new service.
Evidence — `pa report pg`: active, 0 known advisories, license compatible.
  Checked: repo, installed deps, knowledge, registries. Skipped: none.
Alternatives — A dedicated event-store service, rejected because it adds an operational
  surface we do not need at this volume.
Consequences — Simpler ops now; revisit when sustained writes pass 5k events/s or
  replication lag exceeds 10s.
```

## Keep the record honest

- Records are numbered and immutable — the filename becomes a permanent id others will cite.
- Short beats thorough. If a section is empty, the decision probably was not ready.
- When the decision changes, **supersede** — write a new ADR that references the old one and mark the old one superseded. Never edit history; the trail of what changed and why is the whole point.
