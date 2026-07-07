# Collaboration matching (`/collaborate`)

A student types free-text research interests on the `/collaborate` page and gets a
ranked list of AIRi researchers and projects to contact, each with a one-line reason
and a public contact. Matching runs entirely inside the Next.js app — there is no
separate service, container, or ML model.

## How it works

The page POSTs `{ interests: string[], top?: number }` to
[`/api/collaborate`](../web/src/app/api/collaborate/route.js), which uses three small
libs in `web/src/lib/`:

- [`collab-index.js`](../web/src/lib/collab-index.js) — loads the corpus from Strapi
  (graph-eligible publications with authors, people with public contact fields, team
  leads, projects) via the site's existing `fetchAPI` helper. All requests are GETs and
  cached with a 300-second revalidate, matching the search-index route's approach.
- [`collab-match.js`](../web/src/lib/collab-match.js) — pure scoring functions.
- [`collab-contacts.js`](../web/src/lib/collab-contacts.js) — contact resolution.

## Scoring

The query is tokenized (lowercase alphanumeric tokens, length > 2, minus a small
stopword list). A publication's score is the number of query tokens that appear in its
title + abstract + OpenAlex topics. From there:

- **Researchers** are ranked by the *mean of their top-5* publication scores (mean, not
  sum, so prolific authors don't win on volume alone). Only publications with at least
  one shared term count, so an unrelated query genuinely returns nobody.
- **Projects** take the stronger of two signals: token overlap on their own
  abstract + themes, or the score of their best linked publication ("propagation").

**Why keyword-only, no embeddings:** an earlier prototype used the paper-graph
embedding model (`all-MiniLM-L6-v2`) in a separate Python microservice. An architecture
review found that at the current corpus size the embedding path added infrastructure (a
torch container, a second HTTP hop, a stale-forever cache) without measurable quality
gain — the same persona queries resolve correctly with token overlap, because OpenAlex
topics and project abstracts already contain the phrases students search for. The
Python package survives as a CLI-only dev tool
([`research-paper-graph-recommender/`](../research-paper-graph-recommender/README.md)).

## Weak-match handling

A result is **weak** when its best publication (or project) shares fewer than
`min(2, query token count)` terms with the query. Weak results are never mixed into the
main list: the page shows however many results genuinely clear the floor (possibly
zero), then a visually muted "low confidence" section for the closest weak ones. This
exists because padding to a fixed top-5 with confident-looking scores misled users when
few strong matches existed.

## Contact resolution and privacy

Only contact info **already public in Strapi** is ever surfaced:

- **Person:** own email → own public social link → their team's coordinator (the
  member with `isLead`) → institute fallback.
- **Project:** project contact entry (email preferred) → a contributor's public
  email → institute fallback.
- Institute fallback: `airi@campus.utcluj.ro`.

The `team` content type is not publicly readable in production (403 without a token);
`fetchAPI` degrades that to an empty result, so the coordinator step is silently
skipped and resolution falls through to the institute address.

## Known limitation

Result diversity is bounded by data coverage, not code: only authors whose publications
were marked `importEligible` and synced from OpenAlex have indexed publications, so
results concentrate on them. Broadening results means flagging more researchers and
re-running the existing paper sync — no code change.

## Re-introducing embeddings later

If author coverage grows and vocabulary-gap queries ("make robots see" vs. "computer
vision") start failing, the upgrade path is contained: publications already store
`embedding` / `embeddingModel` fields written by the paper-graph pipeline, and they are
publicly readable. Add a Node-side encoder for the same model (e.g.
`@huggingface/transformers` running `all-MiniLM-L6-v2` as ONNX), fetch the stored
vectors in `collab-index.js`, and add a cosine scorer beside the keyword one in
`collab-match.js` — the aggregation, contacts, route, and page all stay as they are.
