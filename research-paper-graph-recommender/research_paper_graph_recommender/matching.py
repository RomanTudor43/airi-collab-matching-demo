"""Matching engine: embed interests, score publications, aggregate to people
and projects, with a keyword-overlap fallback.

The primary path reuses the exact embedding model and normalization from
``research_paper_graph`` so query vectors live in the same space as the stored
publication embeddings. The fallback path itself uses only numpy + the standard
library, so it still runs when the embedding model cannot be loaded or the query
cannot be encoded at runtime (e.g., the weights can't be downloaded offline), or
when ``--no-embeddings`` is passed.
"""

import logging
import re
from collections import defaultdict

import numpy as np

log = logging.getLogger("recommend")

# Minimal stopword set for the fallback tokenizer (kept local so the fallback
# has no heavy dependencies).
_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "by", "for", "from", "in", "into",
    "of", "on", "or", "the", "to", "with", "via", "using", "is", "be", "we",
    "this", "that", "it", "its", "their", "our", "based", "approach", "study",
}


def tokenize(text):
    """Lowercase alphanumeric tokens, length > 2, minus stopwords."""
    if not text:
        return set()
    tokens = re.findall(r"[a-z0-9]+", str(text).lower())
    return {t for t in tokens if len(t) > 2 and t not in _STOPWORDS}


# ── Embedding path ──────────────────────────────────────────────────────────

def embed_query(interests_text, model_name):
    """Embed the interests string into a normalized vector using the SAME model
    as paper-graph. Returns a 1-D numpy array, or ``None`` if embeddings are
    unavailable (which triggers the keyword fallback).
    """
    try:
        from research_paper_graph import graph as gg
    except Exception as exc:  # pragma: no cover - environment dependent
        log.warning("Embedding module unavailable (%s); using keyword fallback.", exc)
        return None

    try:
        vectors = gg.build_text_embeddings([interests_text], model_name)
    except Exception as exc:  # pragma: no cover - environment dependent
        log.warning("Failed to embed interests (%s); using keyword fallback.", exc)
        return None

    if vectors is None or len(vectors) == 0:
        return None
    return np.asarray(vectors[0], dtype=np.float32)


def _unit(vec):
    """Return the L2-normalized vector (safe for zero vectors)."""
    v = np.asarray(vec, dtype=np.float32)
    norm = np.linalg.norm(v)
    return v / norm if norm else v


def score_publications_by_embedding(pubs, query_vec, model_name):
    """Cosine similarity of each usable publication embedding vs the query.

    Stored embeddings are already L2-normalized by the pipeline; we renormalize
    defensively. Returns ``{documentId: score}`` and a parallel list of
    ``(pub, score)`` for publications that had a usable embedding.
    """
    usable_pubs = []
    rows = []
    for pub in pubs:
        embedding = pub.get("embedding")
        if not embedding:
            continue
        # Only trust embeddings produced by the same model we queried with.
        if pub.get("embeddingModel") and pub.get("embeddingModel") != model_name:
            continue
        try:
            vec = np.asarray(embedding, dtype=np.float32)
        except (TypeError, ValueError):
            continue
        if vec.ndim != 1 or vec.size == 0 or vec.size != query_vec.size:
            continue
        usable_pubs.append(pub)
        rows.append(vec)

    if not rows:
        return {}, []

    matrix = np.vstack(rows)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    matrix = matrix / norms

    q = _unit(query_vec)
    if not np.any(q):
        return {}, []

    sims = matrix @ q
    scored = [(pub, float(score)) for pub, score in zip(usable_pubs, sims)]
    score_by_docid = {pub["documentId"]: score for pub, score in scored}
    return score_by_docid, scored


# ── Fallback path ─────────────────────────────────────────────────────────--

def score_publications_by_keywords(pubs, query_tokens):
    """Token-overlap score: how many query tokens appear in a publication's
    OpenAlex topics (and title). Returns ``{documentId: score}`` and a list of
    ``(pub, score)`` for publications with any overlap.
    """
    scored = []
    score_by_docid = {}
    for pub in pubs:
        pub_tokens = set()
        for topic in pub.get("topics") or []:
            pub_tokens |= tokenize(topic)
        pub_tokens |= tokenize(pub.get("title"))
        overlap = len(query_tokens & pub_tokens)
        if overlap > 0:
            scored.append((pub, float(overlap)))
            score_by_docid[pub["documentId"]] = float(overlap)
    return score_by_docid, scored


# ── Aggregation ────────────────────────────────────────────────────────────-

def aggregate_people(scored_pubs, people_by_key, top_k, relevance_floor):
    """Rank people by the MEAN of their top-k publication scores.

    Using the mean (not the sum) keeps prolific authors from dominating purely
    on volume — what matters is how strongly their *best* few papers match.
    Everyone with >=1 scored publication is ranked; ``relevance_floor`` only
    affects the "matched on N" wording, not whether a person is included.
    """
    hits_by_person = defaultdict(list)  # key -> list of (score, pub)
    for pub, score in scored_pubs:
        for author_name in pub.get("authors") or []:
            hits_by_person[author_name.lower().strip()].append((score, pub))

    results = []
    for key, hits in hits_by_person.items():
        hits.sort(key=lambda item: item[0], reverse=True)
        top = hits[:top_k]
        if not top:
            continue
        score = sum(s for s, _ in top) / len(top)
        matched = sum(1 for s, _ in hits if s >= relevance_floor)
        best_score, best_pub = hits[0]
        person = people_by_key.get(key, {"fullName": _titlecase(key)})
        results.append(
            {
                "person": person,
                "score": score,
                "matched": matched,
                "bestPub": best_pub,
                "bestScore": best_score,
                "totalPubs": len(hits),
            }
        )

    results.sort(key=lambda r: r["score"], reverse=True)
    return results


def score_projects(projects, query_vec, model_name, pub_score_by_docid,
                   top_k, relevance_floor, mode, query_tokens=None):
    """Score projects with two signals and keep the stronger one:

    1. cosine of the project's *abstract* vs the query (most projects have one);
    2. *publication propagation* — the score of its best linked publication.

    In keyword-fallback mode this uses token overlap on abstract+themes (plus
    propagation). Returns ranked result dicts.
    """
    abstract_score = {}
    if mode == "embedding" and query_vec is not None:
        idx, texts = [], []
        for i, project in enumerate(projects):
            if project.get("abstract"):
                idx.append(i)
                texts.append(project["abstract"])
        if texts:
            try:
                from research_paper_graph import graph as gg
                vecs = gg.build_text_embeddings(texts, model_name)
                q = _unit(query_vec)
                for j, i in enumerate(idx):
                    abstract_score[i] = float(_unit(vecs[j]) @ q)
            except Exception as exc:  # pragma: no cover
                log.warning("Project abstract embedding failed (%s).", exc)

    results = []
    for i, project in enumerate(projects):
        prop = sorted(
            (
                (pub_score_by_docid[d], project.get("publicationTitles", {}).get(d))
                for d in project.get("publicationDocIds", [])
                if d in pub_score_by_docid
            ),
            key=lambda t: t[0],
            reverse=True,
        )
        best_prop = prop[0][0] if prop else None
        best_prop_title = prop[0][1] if prop else None

        if mode == "embedding":
            abs_s = abstract_score.get(i)
            candidates = [
                (c, kind, t)
                for c, kind, t in (
                    (abs_s, "abstract", None),
                    (best_prop, "publications", best_prop_title),
                )
                if c is not None
            ]
            if not candidates:
                continue
            score, via, prop_title = max(candidates, key=lambda c: c[0])
            matched = sum(1 for s, _ in prop if s >= relevance_floor)
        else:
            text_tokens = tokenize(
                (project.get("abstract") or "") + " " + " ".join(project.get("themes") or [])
            )
            overlap = len((query_tokens or set()) & text_tokens)
            prop_overlap = int(best_prop) if best_prop else 0
            if overlap == 0 and prop_overlap == 0:
                continue
            if overlap >= prop_overlap:
                score, via, prop_title = overlap, "abstract", None
            else:
                score, via, prop_title = prop_overlap, "publications", best_prop_title
            matched = sum(1 for s, _ in prop if s >= 1)

        results.append(
            {
                "project": project,
                "score": score,
                "via": via,
                "matched": matched,
                "bestPropTitle": prop_title,
                "bestScore": score,
            }
        )

    results.sort(key=lambda r: r["score"], reverse=True)
    return results


def _titlecase(key):
    return " ".join(word.capitalize() for word in key.split())


# ── Reason strings ────────────────────────────────────────────────────────--

def person_reason(result, mode, relevance_floor):
    """One-sentence, human-readable reason for a person recommendation."""
    best_pub = result["bestPub"]
    title = (best_pub.get("title") or "untitled").strip()
    title = (title[:70] + "…") if len(title) > 71 else title

    if mode == "embedding" and result["bestScore"] < relevance_floor:
        return f'weak match — closest paper: "{title}"'

    matched = result["matched"]
    plural = "s" if matched != 1 else ""
    topic_hint = ""
    topics = best_pub.get("topics") or []
    if topics:
        topic_hint = f", about {topics[0]}"
    return f'matched on {matched} publication{plural}{topic_hint}; top: "{title}"'


def project_reason(result, mode):
    if result.get("via") == "abstract":
        return "project abstract matches your interests"
    title = (result.get("bestPropTitle") or "a linked publication").strip()
    title = (title[:70] + "…") if len(title) > 71 else title
    return f'matched via linked publication "{title}"'
