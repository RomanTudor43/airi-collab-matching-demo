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
    secondary_clusters: dict
    filtered_papers: list
    embedding_payloads: dict
    embeddings: object
    topic_hierarchy: dict  # Topic supercluster data
    paper_topic_superclusters: dict
    quality_metrics: dict
    paper_metadata: dict


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
    paper_metadata = {}
    for paper in papers:
        paper_id = gg.paper_identifier(paper)
        if not paper_id:
            continue
        existing_metadata = paper.get("metadata")
        paper_metadata[paper_id] = existing_metadata if isinstance(existing_metadata, dict) else {}

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
    secondary_clusters = {}

    if len(filtered_papers) > 2:
        clean_links = [link for link in all_links if not link["is_duplicate"]]
        communities, community_labels, secondary_clusters = gg.detect_communities(
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
                    "secondary_clusters": secondary_clusters,
                },
                handle,
                indent=2,
            )
        log.info(f"Saved community data to {comm_path}")

    # Build topic hierarchy (superclusters)
    topic_hierarchy = {}
    paper_topic_superclusters = {}
    if len(filtered_papers) > 0:
        log.info("Building topic hierarchy...")
        topic_hierarchy = gg.build_topic_hierarchy(filtered_papers, model_name)
        paper_topic_superclusters = gg.build_paper_topic_superclusters(filtered_papers, topic_hierarchy)
        
        # Save topic hierarchy to JSON
        topic_path = os.path.join("outputs", f"topic_hierarchy_{label}.json")
        # Convert numpy array to list for JSON serialization
        serializable_hierarchy = {
            "topics": topic_hierarchy.get("topics", []),
            "topic_to_cluster": topic_hierarchy.get("topic_to_cluster", {}),
            "cluster_to_topics": topic_hierarchy.get("cluster_to_topics", {}),
            "cluster_labels": topic_hierarchy.get("cluster_labels", {}),
            "paper_superclusters": paper_topic_superclusters,
        }
        with open(topic_path, "w", encoding="utf-8") as handle:
            json.dump(serializable_hierarchy, handle, indent=2)
        log.info(f"Saved topic hierarchy to {topic_path}")

    quality_metrics = gg.compute_graph_quality_metrics(
        filtered_papers,
        embeddings,
        communities,
        community_labels,
        paper_topic_superclusters,
    )
    quality_path = os.path.join("outputs", f"quality_{label}.json")
    with open(quality_path, "w", encoding="utf-8") as handle:
        json.dump(quality_metrics, handle, indent=2)
    log.info(f"Saved quality metrics to {quality_path}")

    return GraphArtifacts(
        all_links=all_links,
        duplicate_ids=duplicate_ids,
        communities=communities,
        community_labels=community_labels,
        secondary_clusters=secondary_clusters,
        filtered_papers=filtered_papers,
        embedding_payloads=embedding_payloads,
        embeddings=embeddings,
        topic_hierarchy=topic_hierarchy,
        paper_topic_superclusters=paper_topic_superclusters,
        quality_metrics=quality_metrics,
        paper_metadata=paper_metadata,
    )
