# Graph layer recon (2026-05-19)

This is a short recon of how the graph layers work today, why they exist, and where they are used.

## Current data flow (plain English)

1. Build embeddings and links for all papers. Links come from cosine similarity over paper embeddings. See [research-paper-graph/research_paper_graph/graph.py](research-paper-graph/research_paper_graph/graph.py).
2. Run paper-level clustering (HDBSCAN) to get communities and secondary clusters. This is algorithmic grouping only. See [research-paper-graph/research_paper_graph/graph.py](research-paper-graph/research_paper_graph/graph.py).
3. Build topic superclusters by clustering topic embeddings. This produces topic groups and labels. See [research-paper-graph/research_paper_graph/graph.py](research-paper-graph/research_paper_graph/graph.py).
4. Write graph metadata and links to Strapi, including community ids, labels, and topic superclusters. See [research-paper-graph/research_paper_graph/strapi_sync.py](research-paper-graph/research_paper_graph/strapi_sync.py) and [research-paper-graph/research_paper_graph/strapi.py](research-paper-graph/research_paper_graph/strapi.py).
5. Assign macros to publications by matching paper embeddings against macro text embeddings. See [research-paper-graph/research_paper_graph/strapi_sync.py](research-paper-graph/research_paper_graph/strapi_sync.py).
6. Create mesos from topic superclusters and attach mesos to papers. Meso macro is a majority vote from paper macros. See [research-paper-graph/research_paper_graph/strapi_sync.py](research-paper-graph/research_paper_graph/strapi_sync.py).
7. Frontend loads publications, macros, mesos, and links for views. See [web/src/lib/strapi.js](web/src/lib/strapi.js) and [web/src/app/research/paper-graph/meso.js](web/src/app/research/paper-graph/meso.js).

## Why each layer exists (simple view)

- Links: this is the raw similarity graph. It is the base for all visuals and neighbor discovery. See [research-paper-graph/research_paper_graph/graph.py](research-paper-graph/research_paper_graph/graph.py).
- Communities (paper HDBSCAN): a coarse grouping of papers. It drives community labels, cross-cluster link flags, and some UI badges. See [research-paper-graph/research_paper_graph/graph.py](research-paper-graph/research_paper_graph/graph.py) and [research-paper-graph/research_paper_graph/strapi_sync.py](research-paper-graph/research_paper_graph/strapi_sync.py).
- Topic superclusters: a stable way to turn many raw topics into a small set of meso-level buckets. This is used to create the meso nodes. See [research-paper-graph/research_paper_graph/graph.py](research-paper-graph/research_paper_graph/graph.py).
- Mesos: UI-level topic buckets for the constellation view. Mesos are built from topic superclusters and attached to papers. See [research-paper-graph/research_paper_graph/strapi_sync.py](research-paper-graph/research_paper_graph/strapi_sync.py) and [web/src/app/research/paper-graph/meso.js](web/src/app/research/paper-graph/meso.js).
- Macros: curated, human-facing high-level domains. They drive routing and filtering in the UI. See [research-paper-graph/research_paper_graph/strapi_sync.py](research-paper-graph/research_paper_graph/strapi_sync.py) and [web/src/app/research/paper-graph/[communitySlug]/page.js](web/src/app/research/paper-graph/[communitySlug]/page.js).

## Where the data is actually used

- Community labels appear in the paper graph tooltip and are used for cross-cluster link styling. See [web/src/app/research/paper-graph/PaperGraphClient.js](web/src/app/research/paper-graph/PaperGraphClient.js).
- isCrossCluster on links is computed from community ids at upload time. See [research-paper-graph/research_paper_graph/strapi_sync.py](research-paper-graph/research_paper_graph/strapi_sync.py).
- Macros are the primary filter for the macro routes and macro constellation. See [web/src/app/research/paper-graph/[communitySlug]/page.js](web/src/app/research/paper-graph/[communitySlug]/page.js).
- Mesos are built from graphMeso tags to produce the constellation topics and meso links. See [web/src/app/research/paper-graph/meso.js](web/src/app/research/paper-graph/meso.js).
- Topic superclusters are persisted into metadata and parsed on the frontend, but are not currently rendered directly in UI components. See [web/src/lib/strapi.js](web/src/lib/strapi.js).

## Is anything zombie?

- Communities are used for isCrossCluster and for UI labels, so they are not dead. They are also a fallback filter in data access. See [research-paper-graph/research_paper_graph/strapi_sync.py](research-paper-graph/research_paper_graph/strapi_sync.py) and [web/src/lib/strapi.js](web/src/lib/strapi.js).
- Topic superclusters are used to create mesos during sync, but the stored metadata is not consumed in the UI right now. That makes the metadata part look unused, but the clustering is still required for meso creation. See [research-paper-graph/research_paper_graph/strapi_sync.py](research-paper-graph/research_paper_graph/strapi_sync.py).
- The community filter path looks legacy in UI (macro routes are the primary entry), but it could still be used for internal views or future features. See [web/src/lib/strapi.js](web/src/lib/strapi.js).

## Why meso bleed happens

- Topic superclusters are computed globally, before macro assignment. That means a topic cluster built from mixed macros can be attached to any paper that matches the topic set, even if its macro is different.
- Meso macro is assigned by majority vote after the fact, so the meso itself does not enforce macro boundaries.

## Macro-seeded HDBSCAN to stop bleed (concept)

Two viable ways to keep mesos inside a macro:

1. Per-macro topic clustering (simpler and explicit).
   - Split papers by macro first.
   - Build topic superclusters per macro.
   - Create mesos per macro, and only tag papers in that macro.

2. Macro-augmented topic embeddings (single pass).
   - Build a macro embedding and add it to each topic embedding for that macro.
   - Cluster the combined embeddings so topics in different macros are far apart.

Either way, update meso slugs so clusters from different macros cannot collide, and assign meso tags only inside the macro slice.
