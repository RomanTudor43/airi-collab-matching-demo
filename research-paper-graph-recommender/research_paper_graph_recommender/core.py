"""Recommendation pipeline behind the CLI.

``load_corpus`` does the read-only Strapi GETs once; ``recommend`` scores a
single free-text query against an already-loaded corpus and returns a
JSON-serializable result.
"""

import logging

from . import matching
from .contacts import resolve_person_contact, resolve_project_contact

log = logging.getLogger("recommend")


def load_corpus(strapi):
    """Read everything the matcher needs (GET only). Returns a plain dict so it
    can be cached and reused across many queries by the HTTP service."""
    pubs, _pub_map = strapi.load_graph_eligible_publications()
    people, people_by_key = strapi.load_people_contacts()
    _teams, lead_by_member = strapi.load_teams_with_leads()
    projects = strapi.load_projects_for_matching()
    return {
        "pubs": pubs,
        "people": people,
        "people_by_key": people_by_key,
        "lead_by_member": lead_by_member,
        "projects": projects,
    }


def _coverage(corpus, scored_pubs, model_name, mode):
    pubs = corpus["pubs"]
    projects = corpus["projects"]
    return {
        "mode": mode,
        "model": model_name,
        "graphEligiblePublications": len(pubs),
        "withEmbedding": sum(1 for p in pubs if p.get("embedding")),
        "withUsableEmbedding": sum(
            1 for p in pubs
            if p.get("embedding") and (not p.get("embeddingModel") or p.get("embeddingModel") == model_name)
        ),
        "withLinkedAuthor": sum(1 for p in pubs if p.get("authors")),
        "scored": len(scored_pubs),
        "people": len(corpus["people"]),
        "projects": len(projects),
        "projectsWithAbstract": sum(1 for p in projects if p.get("abstract")),
    }


def recommend(corpus, interests_text, model_name, *, top=5, top_k=5,
              min_sim=0.30, no_embeddings=False):
    """Score one query against a loaded corpus. Returns a JSON-serializable dict."""
    query_tokens = matching.tokenize(interests_text)
    query_vec = None if no_embeddings else matching.embed_query(interests_text, model_name)

    if query_vec is not None:
        mode = "embedding"
        score_by_docid, scored_pubs = matching.score_publications_by_embedding(
            corpus["pubs"], query_vec, model_name
        )
        floor = min_sim
    else:
        mode = "keyword"
        score_by_docid, scored_pubs = matching.score_publications_by_keywords(
            corpus["pubs"], query_tokens
        )
        floor = 1.0

    people_results = matching.aggregate_people(
        scored_pubs, corpus["people_by_key"], top_k, floor
    )
    project_results = matching.score_projects(
        corpus["projects"], query_vec, model_name, score_by_docid,
        top_k, floor, mode, query_tokens,
    )

    researchers = []
    for rank, r in enumerate(people_results[:top], start=1):
        person = r["person"]
        contact, source = resolve_person_contact(person, corpus["lead_by_member"])
        researchers.append({
            "rank": rank,
            "name": person.get("fullName", "Unknown"),
            "title": person.get("title"),
            "slug": person.get("slug"),
            "score": round(r["score"], 4),
            "topSim": round(r["bestScore"], 4),
            "matched": r["matched"],
            "weak": bool(mode == "embedding" and r["bestScore"] < floor),
            "reason": matching.person_reason(r, mode, floor),
            "contact": contact,
            "contactSource": source,
        })

    projects_out = []
    for rank, r in enumerate(project_results[:top], start=1):
        project = r["project"]
        contact, source = resolve_project_contact(project)
        projects_out.append({
            "rank": rank,
            "title": project.get("title", "Untitled"),
            "slug": project.get("slug"),
            "score": round(r["score"], 4),
            "via": r.get("via"),
            "reason": matching.project_reason(r, mode),
            "contact": contact,
            "contactSource": source,
            "themes": project.get("themes") or [],
        })

    return {
        "query": interests_text,
        "mode": mode,
        "relevanceFloor": floor,
        "coverage": _coverage(corpus, scored_pubs, model_name, mode),
        "researchers": researchers,
        "projects": projects_out,
    }
