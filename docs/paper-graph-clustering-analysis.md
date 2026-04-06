# Paper Graph Clustering: Current Implementation & Analysis

This document describes the existing clustering architecture for the research paper graph, identifies its limitations, and outlines the rationale for proposed improvements.

## 1. System Overview

The research paper graph is a visualization system that organizes academic publications into navigable clusters. It operates across three hierarchical levels:

| Level | Name | Purpose |
|-------|------|---------|
| 1 (Top) | Galaxy | Macro-level research domains |
| 2 (Middle) | Constellation | Topic groupings within a domain |
| 3 (Bottom) | Paper Graph | Individual papers with similarity links |

The pipeline lives in `research-paper-graph/` and writes results to Strapi, which the Next.js frontend (`web/`) consumes.

## 2. Current Implementation

### 2.1 Embedding Generation

Papers are embedded using Sentence Transformers with the `all-MiniLM-L6-v2` model.

**Source:** `research_paper_graph/graph.py` — `build_embeddings()`

```python
def build_embeddings(papers, model_name="all-MiniLM-L6-v2"):
    # Filter to papers with abstracts
    papers_with_text = [paper for paper in papers if paper.get("abstract")]
    
    # Encode title + abstract
    encode_inputs.append(f"{paper['title']} {paper['abstract']}")
    
    # Normalize to unit vectors for cosine similarity
    embeddings = _normalize_embeddings(embeddings)
```

**Characteristics:**
- Input: Concatenation of title and abstract
- Output: 384-dimensional normalized vectors
- Similarity: Computed via dot product (equivalent to cosine for unit vectors)

### 2.2 Similarity Link Generation

Links between papers are created based on embedding similarity.

**Source:** `research_paper_graph/graph.py` — `generate_links()`

```python
def generate_links(papers, similarity_threshold=0.5, duplicate_threshold=0.92, ...):
    # Full pairwise similarity matrix
    similarity_matrix = embeddings @ embeddings.T
    
    for source_index in range(len(filtered_papers)):
        for target_index in range(source_index + 1, len(filtered_papers)):
            score = float(similarity_matrix[source_index][target_index])
            if score < similarity_threshold:
                continue
            # Create link...
```

**Thresholds:**
- `similarity_threshold = 0.5` — Minimum score to create a link
- `duplicate_threshold = 0.92` — Score above which papers are considered duplicates

### 2.3 Community Detection (Louvain)

Raw communities are detected using the Louvain algorithm on the similarity graph.

**Source:** `research_paper_graph/graph.py` — `detect_communities()`

```python
def detect_communities(filtered_papers, embeddings, links, resolution=1.0):
    graph = nx.Graph()
    # Add non-duplicate links as weighted edges
    for link in links:
        if not link["is_duplicate"]:
            graph.add_edge(link["source_paper_id"], link["target_paper_id"], weight=link["score"])
    
    # Run Louvain
    communities_list = louvain_communities(graph, weight="weight", resolution=resolution, seed=42)
    
    # Coarsen to macro sectors
    communities, community_labels = _coarsen_to_macro_sectors(filtered_papers, communities)
```

**Behavior:**
- Louvain finds natural community structure in the weighted graph
- Resolution parameter (1.0) controls granularity
- Results are then **overwritten** by macro sector assignment

### 2.4 Macro Sector Assignment

This is where the current approach diverges from pure data-driven clustering.

**Source:** `research_paper_graph/graph.py` — `_coarsen_to_macro_sectors()`

```python
MACRO_SECTORS = [
    {
        "key": "ai_ml",
        "label": "AI & Machine Learning",
        "keywords": ["artificial intelligence", "machine learning", "deep learning", ...],
    },
    {
        "key": "circuits_systems",
        "label": "Circuits & Systems",
        "keywords": ["circuit", "vlsi", "fpga", "embedded", ...],
    },
    {
        "key": "medical_health",
        "label": "Medical & Health",
        "keywords": ["medical", "clinical", "health", "biomedical", ...],
    },
]

FALLBACK_SECTOR_KEY = "emerging_other"
FALLBACK_SECTOR_LABEL = "Emerging & Other"
```

**Algorithm:**

1. For each raw Louvain community, count keyword matches per sector
2. Assign community to dominant sector if confidence ≥ 50% (now 70%)
3. Otherwise, assign to fallback "Emerging & Other"

```python
def _infer_macro_sector(paper):
    text = f"{title} {abstract} {topics}".lower()
    scores = {}
    for sector in MACRO_SECTORS:
        score = sum(1 for keyword in sector["keywords"] if keyword in text)
        if score > 0:
            scores[sector["key"]] = score
    return max(scores.items(), key=lambda kv: kv[1])[0] if scores else None
```

### 2.5 Topic Grouping (Constellation Level)

Within each macro cluster, papers are grouped by their first OpenAlex topic.

**Source:** `web/src/app/research/paper-graph/[communitySlug]/page.js`

```javascript
papers.forEach((p) => {
    const topic = p.topics?.[0] || "Other";  // First topic only
    if (!topicMap[topic]) topicMap[topic] = { label: topic, paperCount: 0, years: [] };
    topicMap[topic].paperCount += 1;
});
```

### 2.6 Cross-Cluster Links

Links that span macro clusters are flagged but not prominently exposed.

**Source:** `research_paper_graph/strapi_sync.py` — `upload_graph_links()`

```python
is_cross = False
if communities:
    src_comm = communities.get(source_paper_id)
    tgt_comm = communities.get(target_paper_id)
    is_cross = src_comm is not None and tgt_comm is not None and src_comm != tgt_comm

strapi.create_graph_link(src_id, tgt_id, link["score"], is_cross_cluster=is_cross)
```

**Frontend usage:** Cross-cluster links are counted for inter-community bridges in `GalaxyClient.js`, but individual paper-to-paper cross-cluster relationships are not navigable.

## 3. Identified Problems

### 3.1 Problem: Fallback Sector Dominates

**Symptom:** Approximately 70% of papers end up in "Emerging & Other"

**Evidence:**
```
Community distribution (from communities_global.json):
- AI & Machine Learning:    87 papers  (7.5%)
- Circuits & Systems:      102 papers  (8.8%)
- Medical & Health:        174 papers (15.0%)
- Emerging & Other:        796 papers (68.7%)  ← Problem
```

**Root causes:**

1. **Keyword list is too narrow** — Only 10 keywords per sector; misses many relevant terms
2. **Simple substring matching** — "image segmentation for cancer detection" doesn't match "medical" keywords
3. **Louvain results discarded** — Semantic communities detected by Louvain are overwritten by keyword heuristics
4. **Confidence threshold too low** — Even at 50%, mixed communities default to fallback

**Impact:** The Galaxy view shows one massive "Emerging & Other" cluster that provides no meaningful organization.

### 3.2 Problem: Topic Fragmentation

**Symptom:** Constellation view has 50+ tiny topic nodes, many with only 1-2 papers

**Evidence:**
```javascript
// From [communitySlug]/page.js
const topic = p.topics?.[0] || "Other";  // Uses only first topic
```

OpenAlex topics are highly specific:
- "Eosinophilic Esophagitis"
- "Gastroesophageal reflux and treatments"
- "Esophageal and GI Pathology"

These are semantically related but appear as separate nodes.

**Root causes:**

1. **First-topic-only selection** — Ignores paper's full topic profile
2. **No topic similarity analysis** — Topics are treated as independent strings
3. **No topic grouping** — Related topics should cluster together

**Impact:** Constellation view is cluttered and hard to navigate; users see dozens of isolated nodes instead of coherent research themes.

### 3.3 Problem: Cross-Cluster Links Are Invisible

**Symptom:** Users cannot explore relationships between papers in different macro clusters

**Evidence:**
```javascript
// GalaxyClient.js - only shows community-level bridges
const bridgeMap = {};
links.forEach((l) => {
    const sc = paperComm[l.sourceId];
    const tc = paperComm[l.targetId];
    if (sc == null || tc == null || sc === tc) return;
    const key = sc < tc ? `${sc}-${tc}` : `${tc}-${sc}`;
    bridgeMap[key].count += 1;  // Counts links, doesn't expose them
});
```

**Root causes:**

1. **Aggregation hides details** — Cross-cluster links counted but not itemized
2. **No drill-down path** — Clicking a bridge doesn't show the papers involved
3. **Paper view lacks context** — Individual paper pages don't show cross-cluster connections

**Impact:** Interdisciplinary research (e.g., AI applied to medical imaging) appears disconnected from both parent domains.

## 4. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CURRENT PIPELINE                               │
└─────────────────────────────────────────────────────────────────────────┘

  OpenAlex API                    Strapi CMS                   Next.js Frontend
       │                              │                              │
       ▼                              │                              │
  ┌─────────┐                         │                              │
  │ Papers  │                         │                              │
  │ + meta  │                         │                              │
  └────┬────┘                         │                              │
       │                              │                              │
       ▼                              │                              │
  ┌──────────────┐                    │                              │
  │ Embeddings   │                    │                              │
  │ (MiniLM)     │                    │                              │
  └──────┬───────┘                    │                              │
         │                            │                              │
         ▼                            │                              │
  ┌──────────────┐                    │                              │
  │ Similarity   │                    │                              │
  │ Matrix       │                    │                              │
  └──────┬───────┘                    │                              │
         │                            │                              │
         ├───────────────┐            │                              │
         ▼               ▼            │                              │
  ┌──────────┐    ┌───────────┐       │                              │
  │ Louvain  │    │ Links     │       │                              │
  │ Communities│  │ (≥0.5)    │       │                              │
  └─────┬────┘    └─────┬─────┘       │                              │
        │               │             │                              │
        ▼               │             │                              │
  ┌──────────────┐      │             │                              │
  │ Keyword      │      │             │                              │
  │ Coarsening   │◄─────┼── PROBLEM: Overwrites semantic clusters    │
  │ (4 sectors)  │      │             │                              │
  └──────┬───────┘      │             │                              │
         │              │             │                              │
         ▼              ▼             │                              │
  ┌─────────────────────────┐         │                              │
  │  community + links      │─────────┼──────────────────────────────┤
  │  written to Strapi      │         │                              │
  └─────────────────────────┘         │                              │
                                      │                              │
                                      ▼                              │
                               ┌─────────────┐                       │
                               │ Publications│                       │
                               │ + community │                       │
                               │ + links     │                       │
                               └──────┬──────┘                       │
                                      │                              │
                                      │                              ▼
                                      │                       ┌─────────────┐
                                      │                       │ Galaxy View │
                                      │                       │ (4 blobs)   │
                                      │                       └──────┬──────┘
                                      │                              │
                                      │                              ▼
                                      │                       ┌─────────────┐
                                      │                       │Constellation│
                                      └──────────────────────►│ (topics[0]) │◄── PROBLEM
                                                              └──────┬──────┘    Fragmented
                                                                     │
                                                                     ▼
                                                              ┌─────────────┐
                                                              │ Paper Graph │
                                                              │ (filtered)  │
                                                              └─────────────┘
```

## 5. Quantitative Analysis

### 5.1 Cluster Size Distribution

| Cluster | Papers | % of Total | Status |
|---------|--------|------------|--------|
| AI & Machine Learning | 87 | 7.5% | Under-populated |
| Circuits & Systems | 102 | 8.8% | Under-populated |
| Medical & Health | 174 | 15.0% | Acceptable |
| Emerging & Other | 796 | 68.7% | **Overloaded** |
| **Total** | **1159** | 100% | |

**Ideal distribution:** 6-10 clusters with 100-200 papers each (~10-17% each)

### 5.2 Keyword Coverage Analysis

Estimated keyword match rate by sector (based on sample analysis):

| Sector | Keyword Matches | Missed Papers (est.) |
|--------|-----------------|----------------------|
| AI & ML | ~120 | ~200 (NLP, robotics, optimization) |
| Circuits | ~130 | ~80 (sensors, IoT) |
| Medical | ~220 | ~150 (bioinformatics, drug discovery) |

**Gap:** ~430 papers could be classified but keywords are too narrow.

### 5.3 Topic Granularity

Sample from "Emerging & Other" cluster:
- 47 unique first-topics
- Average papers per topic: 16.9
- Median papers per topic: 3
- Topics with ≤2 papers: 28 (60%)

**Problem:** Long-tail distribution creates UI clutter.

## 6. Proposed Solutions

### 6.1 Replace Keyword Coarsening with HDBSCAN

**Rationale:** HDBSCAN (Hierarchical Density-Based Spatial Clustering of Applications with Noise) finds clusters of varying density without requiring a pre-specified cluster count.

**Advantages:**
- Data-driven: Clusters emerge from embedding similarity
- Handles outliers: Noise points don't force bad cluster assignments
- Hierarchical: Can extract clusters at different granularities

**Parameters to tune:**
- `min_cluster_size`: Minimum papers per cluster (suggest: 20-30)
- `min_samples`: Core point density (suggest: 5-10)

### 6.2 Semantic Topic Grouping

**Approach:**
1. Extract all unique topics from papers
2. Embed topics using same model
3. Cluster topics into superclusters
4. Map papers to superclusters via their topics

**Expected outcome:** 10-15 topic superclusters per macro cluster instead of 50+ fragments.

### 6.3 Soft Cluster Membership

**Approach:**
- Assign each paper a primary cluster (for navigation)
- Compute distance to other cluster centroids
- If distance < threshold, add as secondary cluster
- Display secondary clusters as badges in UI

**Benefit:** Papers spanning domains (AI + Medical) show affinity to both without duplication.

### 6.4 Cross-Cluster Link Exposure

**Backend:**
- Include `crossClusterLinks` array in paper payloads
- Structure: `[{targetPaperId, targetClusterId, score}]`

**Frontend:**
- Render thin lines in Galaxy view for cross-cluster links
- Hover: Show connected paper titles
- Click: Navigate to target paper in its cluster

## 7. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Largest cluster % | 68.7% | <25% |
| Cluster count | 4 | 6-10 |
| Topics per constellation (median) | 47 | 10-15 |
| Cross-cluster links visible | 0 | All |
| Papers in "Other/Noise" | 796 | <100 |

## 8. References

- **HDBSCAN:** McInnes, L., Healy, J., & Astels, S. (2017). hdbscan: Hierarchical density based clustering. *JOSS*, 2(11), 205.
- **Louvain:** Blondel, V. D., et al. (2008). Fast unfolding of communities in large networks. *JSTAT*, P10008.
- **Sentence Transformers:** Reimers, N., & Gurevych, I. (2019). Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks. *EMNLP*.
