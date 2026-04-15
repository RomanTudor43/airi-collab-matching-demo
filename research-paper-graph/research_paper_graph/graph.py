import json
import hashlib
import logging
import os
from collections import Counter, defaultdict
from functools import lru_cache

import numpy as np
from sentence_transformers import SentenceTransformer

log = logging.getLogger(__name__)


# HDBSCAN clustering parameters for macro-level grouping.
# min_cluster_size: Minimum papers to form a cluster (smaller = more clusters)
# min_samples: Core point density requirement (smaller = less conservative)
HDBSCAN_MIN_CLUSTER_SIZE = 20
HDBSCAN_MIN_SAMPLES = 5

# Target range for macro clusters (used to tune parameters if needed)
TARGET_CLUSTER_RANGE = (6, 10)

# Label for papers that don't fit any cluster (noise points in HDBSCAN)
NOISE_CLUSTER_LABEL = "Interdisciplinary & Emerging"


@lru_cache(maxsize=None)
def _load_sentence_transformer(model_name):
    log.info(f"Loading model ({model_name})...")
    return SentenceTransformer(model_name)


def build_embeddings(papers, model_name="all-MiniLM-L6-v2"):
    """Generate embeddings for papers that have abstracts, reusing stored vectors when valid."""
    papers_with_text = [paper for paper in papers if paper.get("abstract")]
    if len(papers_with_text) < 2:
        log.warning("Not enough papers with abstracts to generate embeddings.")
        return papers_with_text, np.array([])

    reused_count = 0
    encode_positions = []
    encode_inputs = []
    embedding_rows = [None] * len(papers_with_text)

    for index, paper in enumerate(papers_with_text):
        stored_embedding = _get_reusable_embedding(paper, model_name)
        if stored_embedding is not None:
            embedding_rows[index] = stored_embedding
            reused_count += 1
            continue

        encode_positions.append(index)
        encode_inputs.append(f"{paper['title']} {paper['abstract']}")

    encoded_count = len(encode_inputs)
    if encoded_count:
        model = _load_sentence_transformer(model_name)
        log.info(f"Encoding {encoded_count} papers...")
        encoded_embeddings = model.encode(encode_inputs, show_progress_bar=True, convert_to_numpy=True)
        for position, embedding in zip(encode_positions, encoded_embeddings):
            embedding_rows[position] = embedding

    if reused_count:
        log.info(f"Reused {reused_count} stored embeddings")

    embeddings = np.asarray(embedding_rows, dtype=np.float32)
    embeddings = _normalize_embeddings(embeddings)

    return papers_with_text, embeddings


def paper_identifier(paper):
    return paper.get("graphId") or paper.get("openAlexId")


def build_embedding_payloads(filtered_papers, embeddings, model_name, indexed_at):
    """Create Strapi-ready embedding metadata keyed by graph paper identifier."""
    if len(filtered_papers) == 0 or len(embeddings) == 0:
        return {}

    payloads = {}
    for paper, embedding in zip(filtered_papers, embeddings):
        paper_id = paper_identifier(paper)
        payloads[paper_id] = {
            "embedding": embedding.tolist(),
            "embeddingModel": model_name,
            "embeddingUpdatedAt": indexed_at,
            "embeddingSourceHash": embedding_source_hash(paper),
            "lastGraphIndexedAt": indexed_at,
        }
    return payloads


def embedding_source_hash(paper):
    raw = json.dumps(
        {
            "title": paper.get("title") or "",
            "abstract": paper.get("abstract") or "",
        },
        sort_keys=True,
        ensure_ascii=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _get_reusable_embedding(paper, model_name):
    stored_embedding = paper.get("embedding")
    if not stored_embedding:
        return None
    if paper.get("embeddingModel") != model_name:
        return None
    if paper.get("embeddingSourceHash") != embedding_source_hash(paper):
        return None

    try:
        embedding = np.asarray(stored_embedding, dtype=np.float32)
    except (TypeError, ValueError):
        return None

    if embedding.ndim != 1 or embedding.size == 0:
        return None
    return embedding


def _normalize_embeddings(embeddings):
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1
    return embeddings / norms


def generate_links(
    papers,
    similarity_threshold=0.5,
    duplicate_threshold=0.92,
    model_name="all-MiniLM-L6-v2",
):
    """Compute similarity links between papers using brute-force similarity."""
    filtered_papers, embeddings = build_embeddings(papers, model_name)

    if len(embeddings) == 0:
        return [], set(), filtered_papers, embeddings

    links = []
    duplicate_pairs = []

    log.info("Computing full similarity matrix...")
    similarity_matrix = embeddings @ embeddings.T

    for source_index in range(len(filtered_papers)):
        for target_index in range(source_index + 1, len(filtered_papers)):
            score = float(similarity_matrix[source_index][target_index])
            if score < similarity_threshold:
                continue

            is_duplicate = score >= duplicate_threshold
            source_paper_id = paper_identifier(filtered_papers[source_index])
            target_paper_id = paper_identifier(filtered_papers[target_index])
            if is_duplicate:
                duplicate_pairs.append((source_paper_id, target_paper_id))

            links.append(
                {
                    "source_paper_id": source_paper_id,
                    "target_paper_id": target_paper_id,
                    "source_title": filtered_papers[source_index]["title"],
                    "target_title": filtered_papers[target_index]["title"],
                    "score": round(score, 4),
                    "is_duplicate": False,
                }
            )

    duplicate_paper_ids, canonical_by_duplicate = _resolve_duplicate_groups(filtered_papers, duplicate_pairs)

    for link in links:
        source_paper_id = link["source_paper_id"]
        target_paper_id = link["target_paper_id"]
        link["is_duplicate"] = source_paper_id in duplicate_paper_ids or target_paper_id in duplicate_paper_ids
        if source_paper_id in duplicate_paper_ids:
            link["source_canonical_paper_id"] = canonical_by_duplicate[source_paper_id]
        if target_paper_id in duplicate_paper_ids:
            link["target_canonical_paper_id"] = canonical_by_duplicate[target_paper_id]

    duplicate_links = sum(1 for link in links if link["is_duplicate"])
    log.info(f"Links: {len(links)} total | {len(links) - duplicate_links} clean | {duplicate_links} duplicates")
    log.info(f"Duplicate papers: {len(duplicate_paper_ids)}")

    return links, duplicate_paper_ids, filtered_papers, embeddings


def _resolve_duplicate_groups(filtered_papers, duplicate_pairs):
    if not duplicate_pairs:
        return set(), {}

    papers_by_id = {paper_identifier(paper): paper for paper in filtered_papers}
    adjacency = defaultdict(set)
    for source_paper_id, target_paper_id in duplicate_pairs:
        adjacency[source_paper_id].add(target_paper_id)
        adjacency[target_paper_id].add(source_paper_id)

    duplicate_paper_ids = set()
    canonical_by_duplicate = {}
    visited = set()

    for current_paper_id in adjacency:
        if current_paper_id in visited:
            continue

        component = _collect_component(current_paper_id, adjacency, visited)
        canonical_paper_id = _choose_canonical_paper(component, papers_by_id)
        for member_paper_id in component:
            if member_paper_id == canonical_paper_id:
                continue
            duplicate_paper_ids.add(member_paper_id)
            canonical_by_duplicate[member_paper_id] = canonical_paper_id

    return duplicate_paper_ids, canonical_by_duplicate


def _collect_component(start_paper_id, adjacency, visited):
    stack = [start_paper_id]
    component = []

    while stack:
        current_paper_id = stack.pop()
        if current_paper_id in visited:
            continue
        visited.add(current_paper_id)
        component.append(current_paper_id)
        stack.extend(adjacency[current_paper_id] - visited)

    return component


def _choose_canonical_paper(component_paper_ids, papers_by_id):
    return max(component_paper_ids, key=lambda paper_id: _paper_rank_tuple(papers_by_id[paper_id]))


def _paper_rank_tuple(paper):
    title = paper.get("title") or ""
    abstract = paper.get("abstract") or ""
    topics = paper.get("topics") or []
    authors = paper.get("authors") or []
    cited_by = paper.get("cited_by") or 0
    doi = paper.get("doi") or ""
    openalex_id = paper.get("openAlexId") or ""

    return (
        1 if doi else 0,
        len(abstract.strip()),
        len(topics),
        len(authors),
        cited_by,
        len(title.strip()),
        openalex_id,
    )


# Threshold for secondary cluster membership (cosine distance)
# Papers closer than this to another cluster centroid get a secondary affiliation
# At 0.7, approximately 20% of papers get secondary affiliations
SECONDARY_CLUSTER_DISTANCE_THRESHOLD = 0.7


def detect_communities(filtered_papers, embeddings, links, resolution=1.0):
    """Detect communities using HDBSCAN clustering on embeddings.
    
    HDBSCAN finds density-based clusters without requiring a pre-specified count.
    Papers that don't fit any cluster (noise) are assigned to their nearest cluster.
    
    Returns:
        communities: dict mapping paper_id -> primary cluster_id
        labels: dict mapping cluster_id -> human-readable label
        secondary_clusters: dict mapping paper_id -> list of secondary cluster_ids
    """
    if len(filtered_papers) < 2 or len(embeddings) < 2:
        log.warning("Not enough papers for community detection")
        return {}, {}, {}

    paper_ids = [paper_identifier(paper) for paper in filtered_papers]

    # Try HDBSCAN first, fall back to Louvain if it fails
    result = _cluster_with_hdbscan(filtered_papers, embeddings, paper_ids)
    
    if not result[0]:  # communities dict is empty
        log.warning("HDBSCAN produced no clusters, falling back to Louvain")
        communities, labels = _cluster_with_louvain(filtered_papers, links, paper_ids, resolution)
        secondary_clusters = {}  # Louvain doesn't support soft membership
    else:
        communities, labels, secondary_clusters = result

    cluster_counts = Counter(communities.values())
    n_with_secondary = sum(1 for v in secondary_clusters.values() if v)
    log.info(f"Final clustering: {len(cluster_counts)} clusters, {n_with_secondary} papers with secondary affiliations")

    return communities, labels, secondary_clusters


def _cluster_with_hdbscan(filtered_papers, embeddings, paper_ids):
    """Perform HDBSCAN clustering on paper embeddings.
    
    Uses 'leaf' cluster selection for better granularity (6-10 clusters),
    then assigns noise points to their nearest cluster centroid.
    Also computes secondary cluster affiliations for papers near multiple centroids.
    
    Returns:
        communities: dict mapping paper_id -> primary cluster_id
        labels: dict mapping cluster_id -> label
        secondary_clusters: dict mapping paper_id -> list of secondary cluster_ids
    """
    try:
        import hdbscan
        from sklearn.metrics.pairwise import cosine_distances
    except ImportError:
        log.warning("hdbscan not installed — skipping HDBSCAN clustering")
        return {}, {}, {}

    log.info(f"Running HDBSCAN clustering (min_cluster_size={HDBSCAN_MIN_CLUSTER_SIZE}, min_samples={HDBSCAN_MIN_SAMPLES})...")
    
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=HDBSCAN_MIN_CLUSTER_SIZE,
        min_samples=HDBSCAN_MIN_SAMPLES,
        metric='euclidean',
        cluster_selection_method='leaf',  # Produces more granular clusters
        prediction_data=True,
    )
    
    cluster_labels = clusterer.fit_predict(embeddings)
    
    # Count clusters (excluding noise label -1)
    unique_labels = set(cluster_labels)
    n_clusters = len([l for l in unique_labels if l >= 0])
    noise_mask = cluster_labels == -1
    n_noise = sum(noise_mask)
    
    log.info(f"HDBSCAN found {n_clusters} clusters, {n_noise} noise points")
    
    if n_clusters == 0:
        return {}, {}, {}
    
    # Compute cluster centroids
    centroids = []
    for c in range(n_clusters):
        mask = cluster_labels == c
        centroids.append(embeddings[mask].mean(axis=0))
    centroids = np.array(centroids)
    
    # Compute distances from all papers to all centroids
    all_distances = cosine_distances(embeddings, centroids)
    
    # Assign noise points to nearest cluster
    final_labels = cluster_labels.copy()
    if n_noise > 0:
        noise_indices = np.where(noise_mask)[0]
        for idx in noise_indices:
            final_labels[idx] = all_distances[idx].argmin()
        log.info(f"Assigned {n_noise} noise points to nearest clusters")
    
    # Build communities dict and compute secondary affiliations
    communities = {}
    secondary_clusters = {}
    
    for idx, (paper_id, primary_label) in enumerate(zip(paper_ids, final_labels)):
        communities[paper_id] = int(primary_label)
        
        # Find secondary clusters (close but not primary)
        distances = all_distances[idx]
        secondaries = []
        for cluster_id, dist in enumerate(distances):
            if cluster_id != primary_label and dist < SECONDARY_CLUSTER_DISTANCE_THRESHOLD:
                secondaries.append(cluster_id)
        
        # Sort by distance (closest first) and limit to 2
        secondaries.sort(key=lambda c: distances[c])
        secondary_clusters[paper_id] = secondaries[:2]
    
    # Generate labels from dominant topics
    labels = _label_communities_from_topics(filtered_papers, communities)
    
    return communities, labels, secondary_clusters


def _cluster_with_louvain(filtered_papers, links, paper_ids, resolution):
    """Fallback: use Louvain community detection on the similarity graph."""
    try:
        import networkx as nx
        from networkx.algorithms.community import louvain_communities
    except ImportError:
        log.warning("networkx not installed — skipping Louvain fallback")
        return {}, {}

    graph = nx.Graph()
    graph.add_nodes_from(paper_ids)

    for link in links:
        if not link["is_duplicate"]:
            graph.add_edge(
                link["source_paper_id"],
                link["target_paper_id"],
                weight=link["score"],
            )

    log.info(f"Running Louvain community detection (resolution={resolution})...")
    communities_list = louvain_communities(graph, weight="weight", resolution=resolution, seed=42)

    communities = {}
    for community_id, members in enumerate(communities_list):
        for paper_id in members:
            communities[paper_id] = community_id

    labels = _label_communities_from_topics(filtered_papers, communities)
    log.info(f"Louvain detected {len(communities_list)} communities")

    return communities, labels


def _label_communities_from_topics(papers, communities):
    """Generate human-readable cluster labels from dominant topics."""
    topic_counts = {}
    for paper in papers:
        community_id = communities.get(paper_identifier(paper))
        if community_id is None:
            continue
        if community_id not in topic_counts:
            topic_counts[community_id] = Counter()
        for topic in paper.get("topics", []):
            topic_counts[community_id][topic] += 1

    labels = {}
    for community_id, counter in topic_counts.items():
        top_topics = counter.most_common(3)
        if top_topics:
            # Use top 2 topics for concise label, fallback to 1 if only 1 exists
            label_topics = [t for t, _ in top_topics[:2]]
            labels[community_id] = " & ".join(label_topics)
        else:
            labels[community_id] = f"Cluster {community_id}"

    return labels


# ─── Topic Clustering ─────────────────────────────────────────────────────────
# Groups similar topics into superclusters at the constellation level.

# Target number of topic superclusters per macro cluster
TARGET_TOPIC_CLUSTERS = (10, 15)

# HDBSCAN parameters for topic clustering (smaller clusters than papers)
TOPIC_HDBSCAN_MIN_CLUSTER_SIZE = 3
TOPIC_HDBSCAN_MIN_SAMPLES = 2


def extract_all_topics(papers):
    """Extract all unique topics across all papers."""
    topics = set()
    for paper in papers:
        for topic in paper.get("topics", []):
            if topic and isinstance(topic, str):
                topics.add(topic)
    return sorted(topics)


def generate_topic_embeddings(topics, model_name="all-MiniLM-L6-v2"):
    """Generate embeddings for topic strings."""
    if not topics:
        return np.array([])
    
    model = _load_sentence_transformer(model_name)
    log.info(f"Generating embeddings for {len(topics)} topics...")
    embeddings = model.encode(topics, show_progress_bar=False)
    return _normalize_embeddings(embeddings)


def cluster_topics(topics, embeddings, min_cluster_size=None, min_samples=None):
    """Cluster topics using HDBSCAN to create superclusters."""
    import hdbscan

    # Resolve defaults at call time so CLI runtime overrides on module globals apply.
    if min_cluster_size is None:
        min_cluster_size = TOPIC_HDBSCAN_MIN_CLUSTER_SIZE
    if min_samples is None:
        min_samples = TOPIC_HDBSCAN_MIN_SAMPLES
    
    if len(topics) < min_cluster_size:
        # Not enough topics to cluster - assign all to one cluster
        return {topic: 0 for topic in topics}, {0: topics}
    
    log.info(
        f"Clustering {len(topics)} topics with HDBSCAN "
        f"(min_cluster_size={min_cluster_size}, min_samples={min_samples})..."
    )
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric='euclidean',
        cluster_selection_method='leaf',
    )
    labels = clusterer.fit_predict(embeddings)
    
    # Group topics by cluster
    topic_to_cluster = {}
    clusters_to_topics = defaultdict(list)
    
    for topic_idx, (topic, label) in enumerate(zip(topics, labels)):
        if label == -1:
            # Noise point - assign to nearest cluster
            topic_emb = embeddings[topic_idx]

            # Find nearest non-noise cluster
            min_dist = float('inf')
            nearest_cluster = 0

            for other_idx, other_label in enumerate(labels):
                if other_label != -1:
                    dist = 1 - np.dot(topic_emb, embeddings[other_idx])
                    if dist < min_dist:
                        min_dist = dist
                        nearest_cluster = int(other_label)

            topic_to_cluster[topic] = nearest_cluster
            clusters_to_topics[nearest_cluster].append(topic)
        else:
            topic_to_cluster[topic] = int(label)
            clusters_to_topics[int(label)].append(topic)
    
    n_clusters = len(set(labels) - {-1})
    noise_count = sum(1 for l in labels if l == -1)
    log.info(f"Topic clustering: {n_clusters} clusters, {noise_count} noise points reassigned")
    
    return topic_to_cluster, dict(clusters_to_topics)


def label_topic_clusters(clusters_to_topics):
    """Generate labels for topic superclusters based on common theme."""
    labels = {}
    for cluster_id, topics in clusters_to_topics.items():
        if not topics:
            labels[cluster_id] = f"Topic Group {cluster_id}"
            continue
        
        # Find common words/phrases in topics
        word_counts = Counter()
        for topic in topics:
            words = topic.lower().split()
            for word in words:
                # Skip common words
                if len(word) > 3 and word not in {'and', 'the', 'for', 'with', 'from'}:
                    word_counts[word] += 1
        
        # Use most common meaningful word(s) as label
        top_words = word_counts.most_common(2)
        if top_words:
            label_parts = [w.title() for w, _ in top_words if _ > 1]
            if label_parts:
                labels[cluster_id] = " & ".join(label_parts[:2])
            else:
                # Fall back to shortest topic name
                labels[cluster_id] = min(topics, key=len)[:40]
        else:
            labels[cluster_id] = topics[0][:40] if topics else f"Topic Group {cluster_id}"
    
    return labels


def build_topic_hierarchy(papers, model_name="all-MiniLM-L6-v2"):
    """Build complete topic clustering hierarchy.
    
    Returns:
        dict with:
        - topics: list of all unique topics
        - topic_embeddings: numpy array of embeddings
        - topic_to_cluster: mapping of topic -> cluster_id
        - cluster_to_topics: mapping of cluster_id -> list of topics
        - cluster_labels: mapping of cluster_id -> human-readable label
    """
    topics = extract_all_topics(papers)
    if not topics:
        return {
            "topics": [],
            "topic_embeddings": np.array([]),
            "topic_to_cluster": {},
            "cluster_to_topics": {},
            "cluster_labels": {},
        }
    
    embeddings = generate_topic_embeddings(topics, model_name)
    topic_to_cluster, cluster_to_topics = cluster_topics(topics, embeddings)
    cluster_labels = label_topic_clusters(cluster_to_topics)
    
    log.info(f"Topic hierarchy: {len(topics)} topics -> {len(cluster_to_topics)} superclusters")
    for cid, label in sorted(cluster_labels.items()):
        count = len(cluster_to_topics.get(cid, []))
        log.info(f"  Supercluster {cid}: {label} ({count} topics)")
    
    return {
        "topics": topics,
        "topic_embeddings": embeddings,
        "topic_to_cluster": topic_to_cluster,
        "cluster_to_topics": cluster_to_topics,
        "cluster_labels": cluster_labels,
    }


def assign_paper_topic_clusters(papers, topic_to_cluster):
    """Assign each paper to topic superclusters based on its topics.

    Returns dict mapping paper_id -> list of supercluster ids
    """
    assignments = {}
    for paper in papers:
        paper_id = paper_identifier(paper)
        clusters = set()
        for topic in paper.get("topics", []):
            if topic in topic_to_cluster:
                clusters.add(topic_to_cluster[topic])
        assignments[paper_id] = sorted(clusters)
    return assignments


def save_index(embeddings, papers, path):
    """Persist embeddings and paper IDs for reuse."""
    data = {
        "paper_ids": [paper_identifier(paper) for paper in papers],
        "embeddings": embeddings.tolist(),
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle)
    log.info(f"Saved index ({len(papers)} papers) to {path}")


def load_index(path):
    """Load a previously saved index."""
    if not os.path.exists(path):
        return None, None
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    paper_ids = data.get("paper_ids", data.get("openalex_ids", []))
    embeddings = np.array(data.get("embeddings", []), dtype=np.float32)
    log.info(f"Loaded existing index ({len(paper_ids)} papers) from {path}")
    return paper_ids, embeddings