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

## 3. Drop Unpaywall API Completely

Currently, the pipeline uses Unpaywall as a secondary source for PDF URLs. Given the once-monthly cadence and acceptable scale, this dependency adds complexity without proportional value.

**Rationale:**
- OpenAlex provides `open_access.oa_url` for ~60% of papers; this is sufficient
- Unpaywall requires additional HTTP requests and error handling (no retry logic, no rate limiting)
- Once-monthly runs mean missing a few PDFs is acceptable; next month's run may find more as they become OA
- The arXiv DOI fallback pattern synthesis (in `strapi.py`) already covers a significant subset

**Action Items:**

1. **Remove Unpaywall client initialization:** In `research_paper_graph/strapi.py`, remove the `unpaywall_email` parameter from `StrapiClient.__init__()`.
2. **Remove Unpaywall config:** In `research_paper_graph/config.py`, remove `unpaywall_email` from `RuntimeSettings` and `.env` documentation.
3. **Simplify PDF resolution:** In `strapi.py`, `ensure_publication_pdf()` should only try:
   - Direct OpenAlex `open_access.oa_url` (if present)
   - arXiv DOI pattern synthesis (e.g., `10.48550/arxiv.2301.12345` → `https://arxiv.org/pdf/2301.12345.pdf`)
   - Return `None` if neither available (no PDF for this publication)
4. **Remove PDF download stats:** Since there's only one strategy now, simplify the PDF result tracking in `upload_publications()` (remove `unpaywall_requested`, `unpaywall_resolved` counters).

## 4. Remove Preview Graph Build Phase

Currently, the pipeline runs two graph builds: a preview on the import batch, and a final global rebuild. With Strapi as the idempotent state store, the preview phase is redundant.

**Rationale:**
- Strapi already prevents duplicate inserts (via OpenAlexId, DOI, title matching in `find_existing_publication()`)
- The preview build's main purpose (identify duplicates before upload) is replaced by Strapi's existing-publication detection
- Removing it halves embedding computation and simplifies orchestration
- The global rebuild already produces the authoritative graph

**Action Items:**

1. **In `research_paper_graph/cli.py`:** Remove the `preview_graph = build_graph_artifacts(...)` call and the logic that skips duplicates based on `preview_graph.duplicate_ids`.
2. **Inline duplicate prevention:** Use only Strapi's `find_existing_publication()` to detect existing records; upload all non-duplicate papers directly without a preview phase.
3. **Simplify logging:** Remove "Papers: X to process, Y duplicates skipped before sync" message; trust Strapi's upsert logic.
4. **Outcome:** Faster runs (~2x speedup in embedding computation), simpler code, same final result.

## 5. Remove `--dry-run` CLI Flag

The `--dry-run` flag exists to preview changes without writing to Strapi. With once-monthly runs and Strapi's idempotent upserts, dry-run adds complexity that's rarely needed.

**Rationale:**
- Strapi writes are idempotent; re-running is safe
- Once-monthly cadence means mistakes are caught before next month's run
- The `quality_{label}.json` output is sufficient for validating correctness without a full dry-run
- Simplifies CLI interface and testing

**Action Items:**

1. **In `research_paper_graph/cli.py`:** Remove the `--dry-run` argument and all conditional logic checking `args.dry_run`.
2. **Simplify `run()` function:** Always execute Strapi writes; no more branching for dry-run mode.
3. **Update documentation:** Remove `--dry-run` from [paper-sync-cli-guide.md](paper-sync-cli-guide.md) and examples.

## 6. Collapse CLI Source Modes

Currently, `--strapi-people`, `--institution`, and `--person` are mutually exclusive modes. For operational simplicity, establish a single canonical mode with optional targeting.

**Rationale:**
- `--strapi-people` is the primary, recurring use case (monthly full sync)
- `--institution` and `--person` are one-off debugging/testing modes
- Most operational runs use `--strapi-people`; the others add CLI surface area without much benefit

**Action Items:**

1. **Make `--strapi-people` the default:** If no source flag is provided, assume `--strapi-people`.
2. **Keep `--person` and `--institution` as optional overrides:** These remain for ad-hoc testing but are not required.
3. **Simplify help text:** Emphasize that the normal monthly run is `python main.py` (no args).
4. **Update documentation:** Reflect that `python main.py` is the standard invocation.

## 7. Clarify Output Artifacts

Since intermediate JSON save-states are removed, clarify what outputs remain and their purpose.

**Action Items:**

1. **Final outputs after a run:**
   - `quality_{label}.json` — Statistical summary for CI/CD logging (communities found, cluster sizes, label alignment, etc.)
   - Strapi database state — Publications, GraphLinks, and embeddings synced live
   - **No more:** `papers_{label}.json`, `index_{label}.json`, `communities_{label}.json`
2. **Update CI/CD scripts:** If any automation parses `outputs/` folder, migrate to reading the `quality_{label}.json` artifact or Strapi API queries.
3. **Deprecate `outputs/` folder eventually:** After migration, this folder can be removed from version control (add to `.gitignore`).

## Implementation Notes

- **Low risk:** These changes are additive (remove features, not refactor core logic). Strapi already validates all data.
- **Backward compatible with the monthly cadence:** No urgent need to parallelize or add retries; sequential processing is fast enough for 1500–5000 papers.
- **Suggested order:** 3 (Unpaywall) → 4 (preview graph) → 2 (importEligible) → 1 (JSON save-states) → 5 (dry-run) → 6 (CLI) → 7 (outputs).
