# Collaboration-Matching Recommender (CLI dev tool, read-only)

Given a student's free-text research interests, this CLI prints a ranked list
of AIRi researchers and projects to contact, each with a one-sentence reason for
the match.

**This package is a standalone dev tool for local experimentation only.** It is
not wired into the running site and nothing in `web/` or the Docker stack
depends on it. The live `/collaborate` page uses a keyword-matching
implementation inside the Next.js app instead — see
[`docs/collaborate-matching.md`](../docs/collaborate-matching.md) for that
feature and for why embeddings were deferred (at current author coverage the
embedding path added infrastructure without measurable quality gain; this CLI
remains the place to experiment with the embedding approach until the data
justifies moving it into the site).

It is a **non-invasive, read-only sibling** of [`research-paper-graph`](../research-paper-graph).
It reuses that package as a library (the same `all-MiniLM-L6-v2` embedding model,
the same Strapi GET utilities, the same `.env`) and **never writes to Strapi and
never edits the existing package**. Every run prints
`DRY RUN — no Strapi writes performed`.

## Setup

This package has its own virtual environment, independent of the existing one.

1. Create a virtual environment.

```bash
python3 -m venv venv
```

2. Activate it.

```bash
source venv/bin/activate
```

3. Install dependencies.

```bash
pip install -r requirements.txt
```

If `requirements.txt` fails in a fresh environment (typically the `torch` wheel),
install the CPU-only build first, exactly as the existing package recommends:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install sentence-transformers requests numpy scikit-learn python-dotenv
```

4. Configure credentials. This tool reads the **same repository `.env`** the
   `research-paper-graph` package uses — it does **not** add any new variables
   and does **not** modify the file. It needs:

   - `STRAPI_API_TOKEN` — a valid Strapi API token (read access is enough); if
     empty, the tool uses Strapi's public (anonymous) read access.
   - `STRAPI_URL` — the Strapi base URL. **Note the gotcha:** the Python
     packages read `STRAPI_URL` (default `http://localhost:1337`), whereas the
     frontend/`.env.example` uses `PUBLIC_STRAPI_URL`. If you point the tool at a
     non-local Strapi, set `STRAPI_URL` in `.env` accordingly.

## Run

Show usage:

```bash
python recommend.py --help
```

Examples (the four test personas):

```bash
python recommend.py --interests "integrated circuits design and pre-silicon verification" --top 5
python recommend.py --interests "biomedical imaging and deep learning" --top 5
python recommend.py --interests "energy systems forecasting and smart grids" --top 5
python recommend.py --interests "robotics and autonomous systems" --top 5
```

Useful flags:

- `--top N` — how many researchers and projects to return (default 5).
- `--top-k N` — per person, how many of their best-matching publications to
  average into their score (mean of top-K; default 5).
- `--min-sim F` — cosine threshold for counting a publication as a "match" in
  the reason text and the weak-match note (default 0.30). Does not gate results.
- `--verbose` — print coverage stats (total graph-eligible publications, how
  many have a usable embedding, how many have ≥1 linked author) and per-entity
  scores.
- `--no-embeddings` — force the keyword-overlap fallback (for testing).

## How it works

1. Embed the interests string with the **same** sentence-transformers model
   paper-graph uses (`research_paper_graph.graph.build_text_embeddings`), so the
   query lives in the same vector space as the stored publication embeddings.
2. Cosine-similarity the query against each graph-eligible publication's stored
   `embedding` (read from Strapi; already L2-normalized).
3. Resolve top publications to their authors via the `authors` relation and rank
   people by the **mean of their top-k** publication similarities (`matched` =
   count above `--min-sim`).
4. **Projects** take the stronger of two signals: cosine of their own `abstract`
   vs the query, or the score of their best linked publication (propagation).
5. Every recommendation comes with a short reason and a contact, using only
   already-public Strapi data (see Privacy).

### Fallback

If the embedding model can't be loaded or the query can't be encoded at runtime
(e.g., the model weights can't be downloaded offline), or if `--no-embeddings` is
passed, the tool falls back to keyword overlap between the interests and each
publication's OpenAlex `topics` / title, then aggregates the same way. (Note:
the deps in `requirements.txt` — including sentence-transformers — must be
installed either way, because importing the reused package pulls them in.)

### Privacy

Only contact info already public in Strapi is surfaced, in this order:

- **Person:** own `email` → own public `socialLinks` → their team's coordinator
  (the `members` entry with `isLead = true`) → institute address.
- **Project:** project `contactInfo` entries → a contributor's public email →
  institute address.

The institute last-resort address is hardcoded to `airi@campus.utcluj.ro`
(the public contact on the GitHub org and the site footer). If a definitive
Strapi field is identified later, swap it in `contacts.py`.

## Known limitations

- **Author coverage is partial by design.** A publication only has linked authors
  if an `importEligible` person's name matched at import time, so people-matching
  depends on that coverage. `--verbose` reports how many publications have ≥1
  linked author.

## Notes

- The existing [`research-paper-graph/README.md`](../research-paper-graph/README.md)
  links to `docs/paper-graph-generation.md` and `docs/paper-sync-cli-guide.md`
  via a stale absolute path (`/home/shumy/...`); **those files do not exist in
  this repo.** The accurate references are
  [`paper-graph-user-manual.md`](../paper-graph-user-manual.md) and
  [`docs/publications-graph-rollout-plan.md`](../docs/publications-graph-rollout-plan.md).
  (This note is here rather than in the existing README, which is left untouched.)

## Uninstall

Delete this folder (`research-paper-graph-recommender/`). The site's
`/collaborate` feature is independent of it and keeps working.
