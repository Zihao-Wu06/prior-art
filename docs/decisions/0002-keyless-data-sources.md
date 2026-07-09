# 0002. Keyless public data sources for dependency due diligence

- Status: Accepted
- Date: 2026-07-09
- Rung: open-source
- Mode: adopt

## Context

`pa report <pkg>` needs health, security, and license signals across multiple package ecosystems, and it needs to produce something useful the moment someone runs `npx priorart init` — no signup, no config file with a secret in it, no "get an API key first" step between install and first useful output.

## Decision

Use deps.dev and OSV.dev as the primary data sources, with npm registry metadata as an npm-specific extra. All three are free, public, and require no API key.

**Tradeoff:** Zero API keys and zero configuration, so `pa report` works on the first run for every user — at the cost of rate limits and coarser signal than a paid commercial tool would give. deps.dev and OSV are good at "is this maintained, and is it known-vulnerable," not at deeper SCA-grade analysis.

**Rejected:** Socket- and libraries.io-style keyed APIs, because a mandatory API key on day one is exactly the first-run friction this project exists to remove. A tool arguing against unnecessary dependencies shouldn't itself require a signup to produce its first report.

## Evidence

deps.dev covers 7 package ecosystems and surfaces OpenSSF Scorecard and SLSA provenance data; OSV.dev covers the same ecosystem set for vulnerability data. Channels searched: public API documentation for deps.dev and OSV.dev. Commercial alternatives (Socket, libraries.io-style keyed APIs) were considered from public documentation but not trialed, since the keyless requirement ruled them out for the default path before any hands-on evaluation.

## Consequences

Revisit if deps.dev's v3 API is deprecated without a compatible replacement, or if rate limits become a practical problem in CI usage.
