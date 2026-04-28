"""Command-line entrypoints for the research paper graph sync."""

import argparse
import logging

from .config import load_runtime_settings
from . import graph as gg
from .pipeline import build_graph_artifacts, save_paper_snapshot
from .sources import fetch_papers
from .strapi_sync import (
    create_client,
    replace_graph_links,
    update_macro_assignments,
    update_graph_metadata,
    upload_publications,
)

SETTINGS = load_runtime_settings(__file__)

log = logging.getLogger("paper-sync")


def _apply_runtime_graph_settings(settings):
    """Override graph module clustering knobs from environment settings."""
    gg.HDBSCAN_MIN_CLUSTER_SIZE = settings.graph_hdbscan_min_cluster_size
    gg.HDBSCAN_MIN_SAMPLES = settings.graph_hdbscan_min_samples
    gg.SECONDARY_CLUSTER_DISTANCE_THRESHOLD = settings.graph_secondary_cluster_distance_threshold
    gg.TOPIC_HDBSCAN_MIN_CLUSTER_SIZE = settings.graph_topic_hdbscan_min_cluster_size
    gg.TOPIC_HDBSCAN_MIN_SAMPLES = settings.graph_topic_hdbscan_min_samples


def build_parser():
    p = argparse.ArgumentParser(
        prog="paper-sync",
        description="Sync publications and rebuild the global graph.",
    )
    source_group = p.add_mutually_exclusive_group(required=False)
    source_group.add_argument(
        "--strapi-people",
        action="store_true",
        help="Import papers only from people loaded from Strapi",
    )
    source_group.add_argument(
        "--institution",
        type=str,
        help="Import papers for one institution",
    )
    source_group.add_argument(
        "--person",
        type=str,
        help="Import papers for one person by name",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip all Strapi writes (local preview artifacts are still generated)",
    )
    return p


def run(args):
    _apply_runtime_graph_settings(SETTINGS)

    sim_thresh = SETTINGS.graph_similarity_threshold
    dup_thresh = SETTINGS.graph_duplicate_threshold
    model_name = SETTINGS.graph_ai_model

    papers, label = fetch_papers(
        institution=args.institution,
        person=args.person,
        settings=SETTINGS,
        logger=log,
    )
    log.info(f"Fetched {len(papers)} papers ({label})")

    save_paper_snapshot(papers, label, logger=log)

    preview_graph = build_graph_artifacts(
        papers,
        label,
        similarity_threshold=sim_thresh,
        duplicate_threshold=dup_thresh,
        model_name=model_name,
        logger=log,
    )

    papers_to_upload = [paper for paper in papers if paper["openAlexId"] not in preview_graph.duplicate_ids]
    skipped_papers = len(papers) - len(papers_to_upload)

    log.info(f"Papers: {len(papers_to_upload)} to process, {skipped_papers} duplicates skipped before sync")

    if args.dry_run:
        log.info("[DRY RUN] Strapi writes are disabled; generated local preview artifacts only.")
        return

    strapi = create_client(SETTINGS)
    pub_map, _stats = upload_publications(strapi, papers_to_upload, logger=log)

    global_papers, global_pub_map = strapi.load_graph_eligible_publications()
    global_graph = build_graph_artifacts(
        global_papers,
        "global",
        similarity_threshold=sim_thresh,
        duplicate_threshold=dup_thresh,
        model_name=model_name,
        logger=log,
    )

    links_to_upload = [link for link in global_graph.all_links if not link["is_duplicate"]]
    log.info(f"Global rebuild: {len(global_papers)} eligible publications, {len(links_to_upload)} links")

    replace_graph_links(
        strapi,
        links_to_upload,
        global_pub_map,
        communities=global_graph.communities,
        logger=log,
    )

    update_graph_metadata(strapi, global_graph, global_pub_map, logger=log)

    update_macro_assignments(
        strapi,
        global_graph,
        global_papers,
        global_pub_map,
        model_name,
        logger=log,
    )

    log.info("Done.")


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    has_source_selector = bool(
        getattr(args, "strapi_people", False)
        or getattr(args, "institution", None)
        or getattr(args, "person", None)
    )
    if not has_source_selector:
        parser.print_help()
        return

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    run(args)