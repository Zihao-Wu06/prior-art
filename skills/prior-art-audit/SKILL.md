---
name: prior-art-audit
description: Use when asked to find reinvented wheels, audit for hand-rolled code an installed dependency or the standard library already covers, clean up a utils/helpers file, run pa audit, or verify and fix wheel-reinvention findings — read each flagged block, confirm the replacement is semantically equivalent, and fix only what the user approved.
---

# Prior Art: audit hand-rolled wheels

`pa audit` is a deterministic scanner. It matches function names and body signatures against a pattern catalog and emits **candidates** — each with a claimed built-in or dependency that already covers the wheel. It is fast and it is dumb: it cannot read intent, tell a deliberate variant from an accidental duplicate, or know whether the claimed replacement fits *this* call-site. That is your job. The engine narrows the search; you decide.

Treat every candidate as unproven until you have read the code.

## Run it

```
pa audit --json
```

Pass through what the user asked for: `--dir <path>` to scope the scan, `--include-tests` to cover test files (off by default — test fixtures are full of intentional throwaway code), `--suggest` to also surface well-known libraries that are NOT installed (info-level; adopting one is a new-dependency decision that needs `pa report` first). Take findings **highest-severity first**; a long tail of `clamp`-style two-liners rarely repays the same scrutiny as a hand-rolled deep clone or retry loop.

## Verify each finding

For every candidate, before you form any verdict:

1. **Read the actual block** — open the file at the reported line and read the whole function, not the matched line.
2. **Read the pattern's `fpNote`** (it rides along in the JSON). It names the specific way this replacement misleads.
3. **Check semantic equivalence for this site's usage.** The question is never "does a built-in exist" — it is "does the built-in do what *this code* relies on." Canonical traps:
   - `structuredClone` drops functions, class prototypes, and DOM nodes — a clone of an object with methods is not equivalent.
   - A JSON-clone wheel dropping `undefined` and turning `Date` into a string is the **wheel's own bug**, not a reason to reject the replacement — `structuredClone` is the fix. Reason per case which side the flaw is on.
   - A naive `debounce` has no leading/trailing/`maxWait`; if the site needs leading-edge, lodash is not a silent swap.
   - `AbortSignal.timeout` rejects a race but does **not** cancel the losing promise — if the site needs true cancellation, the wheel and the built-in differ.
   - `Math.floor(Math.random()*n)` is correct for non-security use; do not "upgrade" it to `crypto.randomInt` unless the value must be unpredictable.
   - `itertools.groupby` only groups **consecutive** keys — needs sorted input; `_.capitalize` lower-cases the tail where the wheel preserved it.
4. **Record a verdict**: **confirmed** (the replacement is equivalent for this usage) or **rejected** (say why in one line — "keeps class instances," "custom retry jitter is intentional," "below the cost of a dependency").

## Fix confirmed findings

Only when the user asked for fixes. For each confirmed finding, propose the **minimal diff** — swap the wheel for the cited API, delete the now-dead helper, update call-sites. Apply one at a time and **run the project's test suite after each replacement**; a green suite is the evidence the swap was behavior-preserving. If tests fail, revert that one and downgrade the finding to a reported mismatch.

## Ledger discipline

The ledger is a write — never a side effect of a read-only review. Offer to
record outcomes (or record them when the user asked you to fix/track), so the
project's `pa stats` reflects real, accepted work:

```
# once the user accepts a finding as real:
pa stats record wheel-found 1 "<file>:<line> <what>"

# after a fix lands with tests green:
pa stats record wheel-fixed 1 "<what>"
pa stats record lines-avoided <n> "<what>"     # n = net lines removed
```

## Report honestly

End with counts, then two coverage lines:

```
Verified 9 candidates: 6 confirmed, 3 rejected. Fixed 4, 62 net lines avoided.
Engine coverage: 5 files scanned, 2 skipped (node_modules, generated).
Verification coverage: read 9/9 findings. Skipped none.
```

Reproduce the engine's own `Coverage` line, then add **your** verification coverage — which findings you actually read versus took on faith. Coverage honesty is a hard rule of this plugin: claiming a clean audit while findings went unread is a defect, not a shortcut.

## Guardrails

- **Never bulk-apply.** No sweep of replacements without reading each site individually — the whole point of this layer is that the engine could not.
- **Honor the config.** Never replace code matching `alwaysBuild` in `.prior-art.json`; that code is owned on purpose. Respect `bannedDeps` before suggesting a dependency.
- **A mismatch is a finding, not silence.** When the wheel is real but the replacement differs, report it — "wheel exists but replacement differs: `AbortSignal.timeout` won't cancel the in-flight request" — so the human can judge. Rejecting a candidate silently throws away signal.
- **Don't trade a wheel for a worse dependency.** A confirmed wheel covered only by an unvetted package is a `pa report <pkg>` decision first, not an automatic swap.
- **Confirm the finding cleared.** After fixes land, re-run `pa audit` on the same scope; a candidate that still reports is either unfixed or a false match worth teaching the catalog about.
