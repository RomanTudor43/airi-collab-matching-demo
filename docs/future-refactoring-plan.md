# Future Pipeline Refactoring Plan

This document outlines the upcoming architecture changes to the research paper graph pipeline. It is designed to be easily implementable.

## 1. Remove JSON Save-States

Currently, the pipeline relies on local `.json` files inside the `outputs/` folder (e.g., `papers_{}.json`, `communities_{}.json`, `index_{}.json`) for caching and resuming execution.

**Action Items:**

1. **Remove intermediate file I/O:** In `research_paper_graph/pipeline.py`, remove all `open(..., "w")` operations that write intermediate artifacts.
2. **Remove `save_paper_snapshot`:** The system should operate entirely in-memory, transitioning data directly from the Harvesting phase to the Computing phase without saving to disk.
3. **Consolidate Logs:** You may keep a single `quality_{label}.json` output purely for statistical extraction and CI/CD logging, as terminal logs might be too noisy.

## 2. Opt-in `importEligible` Flag for Strapi People

Currently, `sources.py` fetches papers for *all* people mapped in Strapi, which can accidentally include non-research personnel.

**Action Items:**

1. **Strapi CMS Update:** Add a Boolean field (e.g., `importEligible` or `syncEligible`) to the `Person` or `Author` collection type in Strapi, defaulting to `true` or `false` based on your preference.
2. **API Query Update:** In `research_paper_graph/strapi.py`, modify `load_import_people()` to filter the query: append `"filters[importEligible][$eq]": "true"` to the payload.
3. **Seamless Integration:** Because `sources.py` relies on `load_import_people()`, no further pipeline changes are necessary. It will automatically prune ignored researchers.
