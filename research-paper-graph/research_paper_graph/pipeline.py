import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone

from . import graph as gg


@dataclass
class GraphArtifacts:
    all_links: list
    duplicate_ids: set
    communities: dict
    community_labels: dict
    filtered_papers: list
    embedding_payloads: dict
    embeddings: object


def save_paper_snapshot(papers, label, logger=None):
    """Persist the fetched paper payload for reuse and debugging."""
    log = logger or logging.getLogger("paper-sync")
    os.makedirs("outputs", exist_ok=True)
    out_path = os.path.join("outputs", f"papers_{label}.json")

    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(papers, handle, indent=2)

    log.info(f"Saved to {out_path}")
    return out_path


def build_graph_artifacts(
    papers,
    label,
    *,
    similarity_threshold=0.5,
    duplicate_threshold=0.92,
    model_name="all-MiniLM-L6-v2",
    logger=None,
):
    """Generate graph links and community artifacts, persisting local outputs."""
    log = logger or logging.getLogger("paper-sync")

    log.info(
        f"Generating links (threshold={similarity_threshold}, dup={duplicate_threshold})..."
    )
    all_links, duplicate_ids, filtered_papers, embeddings = gg.generate_links(
        papers,
        similarity_threshold=similarity_threshold,
        duplicate_threshold=duplicate_threshold,
        model_name=model_name,
    )

    if len(filtered_papers) > 0:
        index_path = os.path.join("outputs", f"index_{label}.json")
        gg.save_index(embeddings, filtered_papers, index_path)

    indexed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    embedding_payloads = gg.build_embedding_payloads(
        filtered_papers,
        embeddings,
        model_name,
        indexed_at,
    )

    communities = {}
    community_labels = {}

    if len(filtered_papers) > 2:
        clean_links = [link for link in all_links if not link["is_duplicate"]]
        communities, community_labels = gg.detect_communities(
            filtered_papers,
            embeddings,
            clean_links,
            resolution=1.0,
        )

        comm_path = os.path.join("outputs", f"communities_{label}.json")
        with open(comm_path, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "assignments": communities,
                    "labels": community_labels,
                },
                handle,
                indent=2,
            )
        log.info(f"Saved community data to {comm_path}")

    return GraphArtifacts(
        all_links=all_links,
        duplicate_ids=duplicate_ids,
        communities=communities,
        community_labels=community_labels,
        filtered_papers=filtered_papers,
        embedding_payloads=embedding_payloads,
        embeddings=embeddings,
    )