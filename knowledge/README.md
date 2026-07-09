# Knowledge packs

## What these are

A knowledge pack is a curated, human-maintained map from "common capability" to "current known-good options, and what to watch out for." They exist to offset a model's knowledge cutoff: an LLM's training data goes stale, but "is moment still the right choice for JS date handling" shouldn't require a live web search every time an agent needs the answer. Packs are meant to be refreshed on a schedule (CI-driven) rather than written once and left to rot.

## Schema (sketch)

```yaml
capability: <string>       # e.g. "date handling"
ecosystem: <string>        # e.g. "js"
updated: <YYYY-MM-DD>
recommend:
  - name: <string>
    why: <string>
    caveat: <string>       # optional
avoid:
  - name: <string>
    why: <string>
```

## Status

Knowledge packs land in v0.3 as part of the discovery pipeline. `js/dates.example.yaml` in this directory is a seed example showing the intended shape for the first real pack — it is not yet consumed by any command.

## Contributing

Follow the schema above and open a PR. A pack is only useful if its recommendations are current, so entries without a clear `why` or that look stale will be asked to update before merge.
