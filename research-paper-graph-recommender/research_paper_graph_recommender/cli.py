"""Command-line entrypoint for the read-only collaboration recommender.

Mirrors the style of ``research_paper_graph/cli.py`` (argparse + run + main),
reuses that package's settings loader and embedding model, and performs Strapi
GET requests only.
"""

import argparse
import logging
import os

# Quiet HuggingFace download chatter before the model libraries are imported.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")

# research_paper_graph is made importable by this package's __init__.
from research_paper_graph.config import load_runtime_settings

from . import core
from .data import ReadOnlyStrapiClient

DRY_RUN_BANNER = "DRY RUN — no Strapi writes performed"

log = logging.getLogger("recommend")

# Load .env from the same place the existing package does (repo root), without
# introducing any new variables.
SETTINGS = load_runtime_settings(__file__)


def build_parser():
    p = argparse.ArgumentParser(
        prog="recommend",
        description="Recommend AIRi researchers and projects to contact for a "
                    "student's research interests (read-only; no Strapi writes).",
    )
    p.add_argument(
        "--interests", nargs="+", required=True,
        help='Free-text research interests, e.g. --interests "integrated circuits, ML, energy"',
    )
    p.add_argument("--top", type=int, default=5,
                   help="How many researchers and projects to return (default: 5).")
    p.add_argument("--top-k", type=int, default=5,
                   help="How many of a person's best-matching publications to average "
                        "into their score (mean of top-K; default: 5).")
    p.add_argument("--min-sim", type=float, default=0.30,
                   help="Relevance floor (cosine) used only for wording and the "
                        "weak-match note (default: 0.30). Does NOT gate results.")
    p.add_argument("--no-embeddings", action="store_true",
                   help="Force the keyword-overlap fallback (skip the embedding model).")
    p.add_argument("--verbose", action="store_true",
                   help="Print coverage stats and intermediate per-entity scores.")
    return p


def run(args):
    print(f"\n{DRY_RUN_BANNER}\n")

    interests_text = ", ".join(args.interests).strip()
    if not SETTINGS.strapi_token:
        log.info("No STRAPI_API_TOKEN set — using Strapi's public (anonymous) read access.")

    strapi = ReadOnlyStrapiClient(SETTINGS.strapi_api_url, SETTINGS.strapi_token)
    corpus = core.load_corpus(strapi)
    result = core.recommend(
        corpus, interests_text, SETTINGS.graph_ai_model,
        top=args.top, top_k=args.top_k, min_sim=args.min_sim,
        no_embeddings=args.no_embeddings,
    )
    if result["mode"] == "keyword" and not args.no_embeddings:
        log.warning("Falling back to keyword-overlap matching.")

    _print_result(result, args.top_k, args.verbose)
    print(f"\n{DRY_RUN_BANNER}.\n")


def _print_result(result, top_k, verbose):
    mode = result["mode"]
    floor = result["relevanceFloor"]
    query = result["query"]

    if verbose:
        c = result["coverage"]
        print("── Coverage (verbose) ───────────────────────────────────────────")
        print(f"  matching mode               : {c['mode']}")
        print(f"  model                       : {c['model']}")
        print(f"  graph-eligible publications : {c['graphEligiblePublications']}")
        print(f"  …with a stored embedding    : {c['withEmbedding']}")
        print(f"  …embedding usable for model : {c['withUsableEmbedding']}")
        print(f"  …with >=1 linked author     : {c['withLinkedAuthor']}")
        print(f"  publications actually scored: {c['scored']}")
        print(f"  people loaded               : {c['people']}")
        print(f"  projects loaded             : {c['projects']} "
              f"({c['projectsWithAbstract']} have an abstract)")
        print("─────────────────────────────────────────────────────────────────\n")

    researchers = result["researchers"]
    print(f'Top {len(researchers)} researchers for: "{query}"\n')
    if not researchers:
        print("  (no researchers with scored publications)\n")
    for r in researchers:
        display = f"{r['name']} ({r['title']})" if r.get("title") else r["name"]
        print(f" {r['rank']}. {display}")
        print(f"     why    : {r['reason']}")
        print(f"     contact: {r['contact']}  [{r['contactSource']}]")
        if verbose:
            print(f"     score  : {r['score']:.3f}  (mean of top {top_k}; top sim {r['topSim']:.2f})")
        print()

    if mode == "embedding" and researchers and researchers[0]["weak"]:
        print(f"  ⚠ Best similarity is low (top {researchers[0]['topSim']:.2f} < {floor:.2f}). "
              "The institute's indexed\n    publications may not cover this topic well — closest "
              "available, not strong matches.\n")

    projects = result["projects"]
    print(f'Top {len(projects)} projects for: "{query}"\n')
    if not projects:
        print("  (no matching projects found)\n")
    for r in projects:
        print(f" {r['rank']}. {r['title']}")
        print(f"     why    : {r['reason']}")
        print(f"     contact: {r['contact']}  [{r['contactSource']}]")
        if verbose:
            themes = ", ".join(r.get("themes") or []) or "—"
            print(f"     score  : {r['score']:.3f}; via: {r.get('via')}; themes: {themes}")
        print()


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    for noisy in ("httpx", "sentence_transformers", "urllib3", "filelock", "transformers"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    logging.getLogger("huggingface_hub").setLevel(logging.ERROR)

    run(args)


if __name__ == "__main__":
    main()
