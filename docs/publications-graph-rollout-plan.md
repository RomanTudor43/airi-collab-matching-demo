# Publications Graph + Listing Refactor Plan

This plan covers three linked changes:

- allow manual publications to participate in the graph when `graphEligible=true`
- make `graphEligible` default to `false`
- remove `listingEligible` and move listing control to Strapi filters + frontend query params

It also includes a pagination and search overhaul for the publications page to avoid loading the full dataset in the browser.

## Current state (for reference)

- Manual publications are filtered out before graph rebuilds in [research-paper-graph/research_paper_graph/strapi.py](research-paper-graph/research_paper_graph/strapi.py#L266-L307).
- The publications page loads all entries at once in [web/src/app/research/publications/page.js](web/src/app/research/publications/page.js#L1-L17) and filters/searches on the client in [web/src/app/research/publications/publicationsClient.js](web/src/app/research/publications/publicationsClient.js#L82-L200).
- Strapi fetch helper does not paginate and already supports basic filters in [web/src/lib/strapi.js](web/src/lib/strapi.js#L1010-L1089).
- `listingEligible` is written by the pipeline and exists in the schema in [server/src/api/publication/content-types/publication/schema.json](server/src/api/publication/content-types/publication/schema.json#L35-L42).

## Goals

- Make graph inclusion controlled by `graphEligible` only, regardless of `sourceKind`.
- Default new publications to `graphEligible=false` unless explicitly enabled.
- Remove `listingEligible` and rely on Strapi filters (e.g., `sourceKind`, `graphEligible`) for listing views.
- Paginate and search publications on the server, not in the browser.
- Reduce frontend memory usage and avoid client-only search across a partial page.

## Non-goals

- UI redesign of publications cards or typography.
- Full-text search engine integration (this plan uses Strapi filters).

## Phase 0: Decisions (fast, blocking)

- Decide the default listing scope for the publications page:
  - Option A: `sourceKind=manual` only
  - Option B: `sourceKind` in [`manual`, `openAlexAutomated`]
  - Option C: expose a toggle and default to manual
- Decide if manual publications should be graph-eligible by default when created by editors (this is separate from the schema default).

Option C has been chosen. The frontend should be able to show ALL papers, with a filter depending on the type. By the frontend, I mean the /research/publications page
Manual publications should NOT be graph-eligible by default. 

## Phase 1: Strapi schema + data model changes

1. Set `graphEligible` default to `false` in [server/src/api/publication/content-types/publication/schema.json](server/src/api/publication/content-types/publication/schema.json#L35-L40).
2. Remove `listingEligible` from the schema in the same file.
3. Regenerate Strapi types and confirm removal in [server/types/generated/contentTypes.d.ts](server/types/generated/contentTypes.d.ts).
4. Update editor guidance so the manual workflow is explicit (checkbox for graph inclusion).

## Phase 2: Pipeline updates (graph + imports)

1. Graph rebuild should include manual publications when `graphEligible=true`:
   - remove the `sourceKind` exclusion in [research-paper-graph/research_paper_graph/strapi.py](research-paper-graph/research_paper_graph/strapi.py#L266-L307)
   - keep `sourceKind` as a protection for macro/meso overwrite (already enforced in [research-paper-graph/research_paper_graph/strapi_sync.py](research-paper-graph/research_paper_graph/strapi_sync.py))
2. Update import payloads so automated imports still set `graphEligible=true` explicitly in [research-paper-graph/research_paper_graph/strapi.py](research-paper-graph/research_paper_graph/strapi.py#L100-L123).
3. Remove pipeline references to `listingEligible` in the Strapi client in [research-paper-graph/research_paper_graph/strapi.py](research-paper-graph/research_paper_graph/strapi.py).
4. Confirm graph rebuild still uses the global graph-eligible set in [research-paper-graph/research_paper_graph/cli.py](research-paper-graph/research_paper_graph/cli.py#L71-L119).

## Phase 3: Strapi API filtering + pagination

1. Extend `getPublications` to support pagination and server-side search in [web/src/lib/strapi.js](web/src/lib/strapi.js#L1010-L1089):
   - add params: `page`, `pageSize`, `query`, `sourceKind`, `graphEligibleOnly`
   - map `query` to Strapi filters using `$containsi` across title, authors, keywords, doi, and abstract
   - return `data` plus `meta.pagination` for total count
2. Remove `includeUnlisted` (or map it to a real filter based on the new `sourceKind` rules).
3. Add a small helper to normalize listing filters for publications so other pages (departments, projects, people) can opt in to the same filtering behavior.

## Phase 4: Publications page pagination + search

1. Convert [web/src/app/research/publications/page.js](web/src/app/research/publications/page.js#L1-L17) to pass query params and pagination settings instead of loading all publications.
2. Refactor [web/src/app/research/publications/publicationsClient.js](web/src/app/research/publications/publicationsClient.js#L82-L200) to:
   - treat pagination as server-driven
   - push search and filters into the query string
   - refetch when filters change (or use a router refresh)
   - show total count and page controls from Strapi metadata
3. Decide how to handle author filters at scale:
   - Option A: drop the author dropdown (too large)
   - Option B: server-side typeahead (query on-demand)

## Phase 5: Search index alignment

1. Update [web/src/lib/search-index.js](web/src/lib/search-index.js#L246-L268) to fetch publications using the new filter rules (likely `sourceKind` based, not `graphEligibleOnly`).
2. Ensure the search index does not pull the entire publication set without pagination.
3. Confirm global search results align with the publications page filters.

## Phase 6: QA + rollout

- Verify graph rebuild includes manual + graph-eligible records.
- Verify macro/meso assignments do not overwrite manual publications.
- Verify publication listings only show the intended source kinds.
- Verify search hits across the full corpus (not just the current page).
- Load test the publications page with large datasets (pagination + search).

## Suggested task breakdown

1. Schema + migration tasks (graphEligible default, drop listingEligible, regenerate types).
2. Pipeline tasks (include manual graphEligible, remove listingEligible handling).
3. Strapi query helpers (pagination + search + sourceKind filters).
4. Publications page refactor (server-driven pagination + search).
5. Search index alignment.
6. QA + backfill.

If you want, I can turn any phase into a detailed checklist or propose exact Strapi filter syntax for the search queries.
