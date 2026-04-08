# Research Paper Graph: Linking Architecture Guide

This document explains how papers are linked together and how those links form the multi-level graph visualization (Galaxy → Constellations → Papers).

## Table of Contents

1. [Overview](#overview)
2. [Paper-to-Paper Links](#paper-to-paper-links)
3. [Macro Clustering (Galaxies)](#macro-clustering-galaxies)
4. [Cross-Cluster Links](#cross-cluster-links)
5. [Soft Cluster Membership](#soft-cluster-membership)
6. [Topic Clustering](#topic-clustering)
7. [Data Flow](#data-flow)
8. [Key Parameters](#key-parameters)

---

## Overview

The research paper graph uses a **three-level hierarchy**:

```
Galaxy Level (Macro)
    ↓
Constellation Level (Communities/Topics)
    ↓
Paper Level (Individual Publications)
```

Links exist at each level:
- **Paper-to-Paper Links**: Embedding similarity between individual papers
- **Cluster-to-Cluster Bridges**: Aggregated cross-cluster connections (shown as lines between galaxies)
- **Soft Membership**: Secondary cluster affiliations for boundary papers

---

## Paper-to-Paper Links

### How Links Are Generated

Papers are linked based on **semantic similarity** of their abstracts using sentence embeddings.

**Process** (`generate_links()` in `graph.py`):

1. **Embedding Generation**
   ```python
   model = SentenceTransformer("all-MiniLM-L6-v2")
   embeddings = model.encode([paper.abstract for paper in papers])
   ```
   - Uses the `all-MiniLM-L6-v2` model (384-dimensional embeddings)
   - Embeddings are normalized to unit vectors for cosine similarity

2. **Similarity Matrix Computation**
   ```python
   similarity_matrix = embeddings @ embeddings.T  # Dot product = cosine similarity
   ```
   - Brute-force pairwise comparison (O(n²) for n papers)
   - Cosine similarity ranges from 0 (unrelated) to 1 (identical)

3. **Link Filtering**
   ```python
   if score >= similarity_threshold:  # Default: 0.5
       create_link(source, target, score)
   ```
   - Only pairs with similarity ≥ 0.5 become links
   - Higher threshold = fewer, stronger links
   - Lower threshold = more, weaker links

4. **Duplicate Detection**
   ```python
   if score >= duplicate_threshold:  # Default: 0.92
       mark_as_duplicate(source, target)
   ```
   - Papers with similarity ≥ 0.92 are flagged as potential duplicates
   - Duplicates are resolved into canonical papers
   - Duplicate links are excluded from the graph

### Link Storage

Links are stored in the Strapi `graph-links` collection:

```javascript
{
  source: publication_id,    // Strapi document ID
  target: publication_id,    // Strapi document ID
  score: 0.6234,             // Cosine similarity [0, 1]
  isCrossCluster: true       // Whether papers are in different clusters
}
```

### Link Strength Categories

The frontend visualizes links with different styles based on score:

| Category | Score Range | Color | Line Style |
|----------|-------------|-------|------------|
| **Strong** | ≥ 0.80 | Yellow (`#ffe066`) | Thick, solid |
| **Moderate** | 0.65 - 0.79 | Orange (`#ff8c00`) | Medium, solid |
| **Weak** | 0.50 - 0.64 | Blue (`#4d7fff`) | Thin, dashed |
| **Cross-Cluster** | Any | Orange glow | Dashed with glow |

---

## Macro Clustering (Galaxies)

### HDBSCAN Clustering

Macro clusters (galaxies) are formed using **HDBSCAN** (Hierarchical Density-Based Spatial Clustering of Applications with Noise) on paper embeddings.

**Why HDBSCAN?**
- Finds natural density-based clusters without pre-specifying k
- Handles noise/outliers gracefully
- Produces hierarchical cluster structure
- Better than k-means for non-spherical clusters

**Process** (`_cluster_with_hdbscan()` in `graph.py`):

1. **Clustering**
   ```python
   clusterer = hdbscan.HDBSCAN(
       min_cluster_size=20,           # Minimum papers to form a cluster
       min_samples=5,                 # Core point density requirement
       metric='cosine',               # Cosine distance between embeddings
       cluster_selection_method='leaf' # Prefer smaller, denser clusters
   )
   labels = clusterer.fit_predict(embeddings)
   ```

2. **Noise Assignment**
   - HDBSCAN assigns label `-1` to outliers (noise points)
   - Noise points are reassigned to their **nearest cluster centroid** using cosine distance
   ```python
   for noise_paper in noise_papers:
       distances = cosine_distances(noise_paper_embedding, cluster_centroids)
       assign_to_cluster(noise_paper, nearest_cluster)
   ```

3. **Auto-Labeling**
   - Each cluster gets a label from its most common topics
   ```python
   top_topics = Counter(cluster_topics).most_common(3)
   label = " & ".join([topic for topic, count in top_topics[:2]])
   # Example: "Stroke Rehabilitation & Soft Robotics"
   ```

### Typical Results

With ~1200 papers:
- **10 macro clusters** (vs. previous 4 with 70% in "Other")
- Cluster sizes: 4.9% - 22.4% of total papers
- Labels auto-generated from dominant topics

---

## Cross-Cluster Links

Cross-cluster links connect papers in **different macro clusters**. These are crucial for understanding interdisciplinary research.

### Detection

A link is cross-cluster if:
```python
is_cross_cluster = (
    source_paper.community != target_paper.community
    and source_paper.community is not None
    and target_paper.community is not None
)
```

### Backend Processing

**During Sync** (`strapi_sync.py`):
```python
for link in links:
    src_comm = communities.get(source_paper_id)
    tgt_comm = communities.get(target_paper_id)
    is_cross = src_comm is not None and tgt_comm is not None and src_comm != tgt_comm
    
    create_graph_link(source, target, score, is_cross_cluster=is_cross)
```

### Frontend Aggregation

**Cluster-to-Cluster Bridges** (`page.js`):
```javascript
// Aggregate individual cross-cluster links into cluster pairs
const bridgeMap = {};
links.forEach((l) => {
  const sc = paperComm[l.sourceId];  // Source cluster ID
  const tc = paperComm[l.targetId];  // Target cluster ID
  if (sc == null || tc == null || sc === tc) return;
  
  const key = sc < tc ? `${sc}-${tc}` : `${tc}-${sc}`;
  if (!bridgeMap[key]) {
    bridgeMap[key] = { source: min(sc, tc), target: max(sc, tc), count: 0 };
  }
  bridgeMap[key].count += 1;
});

const interLinks = Object.values(bridgeMap);
// Example: [{ source: 2, target: 5, count: 47 }, ...]
```

### Visualization

**Galaxy View** (`GalaxyClient.js`):
- Cross-cluster bridges are rendered as **dashed golden lines** between clusters
- Line thickness scales with link count
- Opacity: 0.35 base, increases on hover
- Hovering shows top 5 paper pairs with titles

**Paper Detail Panel** (`PaperGraphClient.js`):
- "Related in Other Clusters" section shows up to 4 cross-cluster papers
- Displays: similarity score, paper title, target cluster name
- Example:
  ```
  ⟡ RELATED IN OTHER CLUSTERS
  73% Deep Learning Applications in Medical Imaging
      in Medical AI & Diagnostics
  68% Convolutional Neural Networks for Image Segmentation
      in Computer Vision & Recognition
  ```

### Bridge Interaction

**Click Navigation**:
```javascript
onClick(bridge) {
  // Navigate to source cluster view where user can explore links
  router.push(`/research/paper-graph/c-${bridge.source}`);
}
```

**Hover Tooltip**:
```javascript
hoveredBridge = {
  source: 3,
  target: 7,
  count: 23,
  links: [
    { sourceTitle: "Paper A", targetTitle: "Paper X", score: 0.76 },
    { sourceTitle: "Paper B", targetTitle: "Paper Y", score: 0.71 },
    // ... top 5 links
  ]
}
```

---

## Soft Cluster Membership

Some papers sit near **cluster boundaries** and relate to multiple clusters. Soft membership captures these secondary affiliations.

### Secondary Cluster Assignment

**Process** (`_cluster_with_hdbscan()` in `graph.py`):

1. Compute cluster centroids:
   ```python
   centroids = {
       cluster_id: np.mean(embeddings[cluster_papers], axis=0)
       for cluster_id, cluster_papers in clusters.items()
   }
   ```

2. For each paper, compute distance to all other clusters:
   ```python
   for paper in papers:
       primary_cluster = paper.community
       for cluster_id, centroid in centroids.items():
           if cluster_id == primary_cluster:
               continue
           
           distance = cosine_distance(paper.embedding, centroid)
           
           if distance <= SECONDARY_CLUSTER_DISTANCE_THRESHOLD:  # 0.7
               secondary_clusters[paper_id].append({
                   "clusterId": cluster_id,
                   "clusterLabel": labels[cluster_id],
                   "distance": float(distance)
               })
   ```

3. Results:
   - ~20% of papers get secondary affiliations (with threshold 0.7)
   - Stored as array in `paper.secondaryClusters`

### Visualization

**Paper Badges** (`PaperGraphClient.js`):
```jsx
{paper.secondaryClusters?.length > 0 && (
  <div className="flex flex-wrap gap-1 mb-2">
    {paper.secondaryClusters.map((sc) => (
      <span className="text-purple-400/60 border border-purple-500/30">
        ⟡ {sc.clusterLabel}
      </span>
    ))}
  </div>
)}
```

Secondary clusters appear as **purple badges** below the primary cluster label.

---

## Topic Clustering

Topics (from OpenAlex) are also clustered to create **topic superclusters** for the constellation level.

### Process

**1. Extract Unique Topics** (`extract_all_topics()` in `graph.py`):
```python
topics = set()
for paper in papers:
    for topic in paper.get("topics", []):
        topics.add(topic)  # e.g., "Machine Learning", "Neural Networks"
```

**2. Generate Topic Embeddings** (`generate_topic_embeddings()`):
```python
model = SentenceTransformer("all-MiniLM-L6-v2")
topic_embeddings = model.encode(topics)
```

**3. Cluster Topics** (`cluster_topics()`):
```python
clusterer = hdbscan.HDBSCAN(
    min_cluster_size=3,   # Smaller than papers (fewer topics)
    min_samples=2,
    metric='cosine',
    cluster_selection_method='leaf'
)
topic_cluster_labels = clusterer.fit_predict(topic_embeddings)
```

**4. Label Topic Superclusters** (`label_topic_clusters()`):
```python
# Find common words across topics in each supercluster
for cluster_id, topics in cluster_to_topics.items():
    word_counts = Counter()
    for topic in topics:
        for word in topic.split():
            if len(word) > 3 and word not in common_words:
                word_counts[word] += 1
    
    top_words = word_counts.most_common(2)
    label = " & ".join([w.title() for w, _ in top_words])
```

### Result

Topic hierarchy provides finer-grained grouping:
```
Macro Cluster: "Medical AI & Healthcare"
  ├─ Topic Supercluster: "Imaging & Diagnostics"
  │   ├─ Medical Imaging
  │   ├─ Diagnostic Systems
  │   └─ Radiology Applications
  └─ Topic Supercluster: "Clinical Decision Support"
      ├─ Electronic Health Records
      ├─ Clinical Prediction Models
      └─ Patient Outcome Analysis
```

---

## Data Flow

### Backend Pipeline

```
1. Fetch Papers from OpenAlex/Strapi
   ↓
2. Generate Embeddings (all-MiniLM-L6-v2)
   ↓
3. Compute Similarity Matrix
   ↓
4. Create Links (threshold ≥ 0.5)
   ↓
5. Cluster Papers with HDBSCAN
   ├─ Primary clusters
   └─ Secondary clusters (soft membership)
   ↓
6. Detect Cross-Cluster Links
   ↓
7. Build Topic Hierarchy
   ├─ Extract topics
   ├─ Cluster topics
   └─ Label superclusters
   ↓
8. Sync to Strapi
   ├─ Publications: community, communityLabel, secondaryClusters
   ├─ Graph Links: source, target, score, isCrossCluster
   └─ Topic Hierarchy: JSON file
```

### Frontend Pipeline

```
1. Fetch Papers & Links from Strapi
   ↓
2. Build Cluster-to-Cluster Bridges
   └─ Aggregate cross-cluster links by cluster pair
   ↓
3. Galaxy View
   ├─ Render clusters as nodes
   ├─ Draw bridges between clusters
   └─ Show cross-cluster link counts
   ↓
4. Constellation View (drill-down into cluster)
   ├─ Show papers in cluster
   ├─ Draw internal links
   └─ Show secondary cluster badges
   ↓
5. Paper Detail Panel (hover/click)
   ├─ Show paper metadata
   ├─ List connections by strength
   ├─ Show secondary clusters
   └─ Display "Related in Other Clusters"
```

---

## Key Parameters

### Similarity & Linking

| Parameter | Value | Purpose | Impact |
|-----------|-------|---------|--------|
| `similarity_threshold` | 0.5 | Minimum similarity to create link | Higher = fewer, stronger links |
| `duplicate_threshold` | 0.92 | Similarity to flag as duplicate | Higher = fewer false duplicates |
| `model_name` | `all-MiniLM-L6-v2` | Embedding model | Faster, smaller embeddings (384d) |

### HDBSCAN Clustering

| Parameter | Value | Purpose | Impact |
|-----------|-------|---------|--------|
| `HDBSCAN_MIN_CLUSTER_SIZE` | 20 | Minimum papers per cluster | Higher = fewer, larger clusters |
| `HDBSCAN_MIN_SAMPLES` | 5 | Core point density | Higher = more conservative clustering |
| `cluster_selection_method` | `'leaf'` | Cluster selection strategy | `'leaf'` prefers smaller clusters |
| `TARGET_CLUSTER_RANGE` | (6, 10) | Desired cluster count | For tuning parameters |

### Soft Membership

| Parameter | Value | Purpose | Impact |
|-----------|-------|---------|--------|
| `SECONDARY_CLUSTER_DISTANCE_THRESHOLD` | 0.7 | Cosine distance for secondary | Lower = fewer secondaries |

### Topic Clustering

| Parameter | Value | Purpose | Impact |
|-----------|-------|---------|--------|
| `TOPIC_HDBSCAN_MIN_CLUSTER_SIZE` | 3 | Minimum topics per supercluster | Smaller than papers |
| `TOPIC_HDBSCAN_MIN_SAMPLES` | 2 | Topic core density | More permissive |
| `TARGET_TOPIC_CLUSTERS` | (10, 15) | Desired superclusters | Per macro cluster |

### Visualization

| Parameter | Value | Purpose | Impact |
|-----------|-------|---------|--------|
| `BRIDGE_OPACITY` | 0.35 | Base opacity of cross-cluster lines | Higher = more visible |
| `minScore` (filter) | 0.5 | Minimum link score to display | User-adjustable in UI |
| `showCrossCluster` | true/false | Toggle cross-cluster links | User-controlled |

---

## Example Walkthrough

### Paper Linking

Given papers A and B:
```python
paper_a = { "title": "Deep Learning for Medical Imaging", "abstract": "..." }
paper_b = { "title": "Convolutional Networks in Radiology", "abstract": "..." }

# 1. Generate embeddings
emb_a = encode(paper_a.abstract)  # [0.12, -0.45, 0.78, ...]
emb_b = encode(paper_b.abstract)  # [0.15, -0.42, 0.81, ...]

# 2. Compute similarity
similarity = dot(emb_a, emb_b)  # 0.83

# 3. Create link
if similarity >= 0.5:
    create_link(paper_a, paper_b, score=0.83)
    # Result: Strong link (yellow line in UI)
```

### Cross-Cluster Bridge

```python
# Papers assigned to clusters
paper_a.community = 3  # "Medical AI & Diagnostics"
paper_b.community = 7  # "Computer Vision & Recognition"

# Link between them
link = { source: paper_a, target: paper_b, score: 0.83 }

# Detect cross-cluster
is_cross = (paper_a.community != paper_b.community)  # True

# Aggregate into bridge
bridges[key(3, 7)].count += 1
# Result: Golden dashed line drawn between clusters 3 and 7 in Galaxy view
```

### Soft Membership

```python
# Paper C is primarily in Cluster 5
paper_c.community = 5
paper_c.embedding = [...]

# Compute distances to other centroids
centroid_3 = mean(cluster_3_embeddings)
centroid_7 = mean(cluster_7_embeddings)

dist_to_3 = cosine_distance(paper_c.embedding, centroid_3)  # 0.65
dist_to_7 = cosine_distance(paper_c.embedding, centroid_7)  # 0.89

# Assign secondary if distance <= 0.7
if dist_to_3 <= 0.7:
    paper_c.secondaryClusters.append({
        clusterId: 3,
        clusterLabel: "Medical AI & Diagnostics",
        distance: 0.65
    })
# Result: Purple badge "⟡ Medical AI & Diagnostics" shown on paper C
```

---

## Summary

The research paper graph uses a **multi-level linking architecture**:

1. **Paper-to-Paper**: Embedding similarity (cosine similarity ≥ 0.5)
2. **Macro Clustering**: HDBSCAN on embeddings (6-10 density-based clusters)
3. **Cross-Cluster Bridges**: Aggregated counts of links spanning clusters
4. **Soft Membership**: Secondary affiliations for boundary papers (distance ≤ 0.7)
5. **Topic Superclusters**: HDBSCAN on topic embeddings (for constellation level)

This creates a rich, multi-scale visualization that reveals both tight communities and interdisciplinary connections across the research landscape.
