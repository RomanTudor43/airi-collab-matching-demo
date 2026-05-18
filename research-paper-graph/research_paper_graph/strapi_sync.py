import logging
from datetime import datetime, timezone

from . import graph as gg
from .strapi import StrapiClient

DEFAULT_MACRO_TAG_TOP_N = 3
MESO_SLUG_PREFIX = "sc-"


def _build_macro_text(macro):
    parts = [macro.get("name"), macro.get("keywords"), macro.get("description")]
    return " ".join(part.strip() for part in parts if isinstance(part, str) and part.strip())


def _build_paper_text(paper):
    title = (paper.get("title") or "").strip()
    abstract = (paper.get("abstract") or "").strip()
    if abstract:
        return f"{title} {abstract}".strip()
    return title


def create_client(settings):
    return StrapiClient(settings.strapi_api_url, settings.strapi_token, settings.unpaywall_email)


def upload_publications(strapi, papers_to_upload, logger=None):
    """Upsert publications into Strapi and return the publication map and stats."""
    log = logger or logging.getLogger("paper-sync")

    strapi.load_existing_publications()
    strapi.load_existing_people()

    pub_map = {}
    stats = {
        "created": 0,
        "updated": 0,
        "skipped": 0,
        "failed": 0,
        "protected_manual": 0,
        "pdf_attempted": 0,
        "pdf_resolved": 0,
        "pdf_uploaded": 0,
    }

    log.info(f"Uploading {len(papers_to_upload)} publications...")
    for paper in papers_to_upload:
        oa_id = paper.get("openAlexId")
        paper_label = paper.get("title", "?")
        matched_author_ids = strapi.match_authors(paper.get("authors", []))
        seeded_author_ids = paper.get("seedPersonIds", [])
        author_ids = list(dict.fromkeys([*matched_author_ids, *seeded_author_ids]))
        existing_id, match_type = strapi.find_existing_publication(
            openalex_id=oa_id,
            doi=paper.get("doi"),
            title=paper.get("title"),
        )

        if existing_id:
            if oa_id:
                pub_map[oa_id] = existing_id
            existing_source = strapi.get_publication_source_kind(existing_id)
            existing_listing_eligible = strapi.get_publication_listing_eligible(existing_id)
            existing_has_pdf = strapi.has_publication_pdf(existing_id)

            # Ensure imported automated records are routeable by slug pages.
            if existing_source == "openAlexAutomated":
                ensure_payload = {}
                if not strapi.get_publication_slug(existing_id):
                    ensure_payload["slug"] = strapi.build_publication_slug(paper)
                if not strapi.is_publication_published(existing_id):
                    ensure_payload["publishedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                if ensure_payload:
                    strapi.update_publication(existing_id, ensure_payload)

            # Update existing automated publications with fresh data
            if existing_source == "openAlexAutomated" and not existing_listing_eligible:
                merged_author_ids = strapi.merge_publication_author_ids(existing_id, author_ids)
                update_payload = strapi.build_import_update_payload(paper, author_ids=merged_author_ids)
                pdf_result = strapi.ensure_publication_pdf(paper, existing_document_id=existing_id)

                if pdf_result.get("attempted"):
                    stats["pdf_attempted"] += 1
                if pdf_result.get("resolved"):
                    stats["pdf_resolved"] += 1
                if pdf_result.get("uploaded"):
                    stats["pdf_uploaded"] += 1
                    update_payload["pdfFile"] = pdf_result.get("attachment_id")

                strapi.update_publication(existing_id, update_payload)
                stats["updated"] += 1
                log.info(
                    "  Updated: %s (%s, pdf: %s/%s)",
                    paper_label[:60],
                    match_type,
                    "resolved" if pdf_result.get("resolved") else ("already-present" if existing_has_pdf else "not-found"),
                    "uploaded" if pdf_result.get("uploaded") else ("already-present" if existing_has_pdf else "not-uploaded"),
                )
            else:
                stats["protected_manual"] += 1
                stats["skipped"] += 1
                log.debug(
                    f"  Protected curated/manual-priority entry ({match_type}): {paper_label[:60]}"
                )
            continue

        publication_result = strapi.create_publication(paper, author_ids=author_ids or None)
        doc_id = publication_result.get("document_id") if publication_result else None
        pdf_result = publication_result.get("pdf_result", {}) if publication_result else {}

        if pdf_result.get("attempted"):
            stats["pdf_attempted"] += 1
        if pdf_result.get("resolved"):
            stats["pdf_resolved"] += 1
        if pdf_result.get("uploaded"):
            stats["pdf_uploaded"] += 1

        if doc_id:
            if oa_id:
                pub_map[oa_id] = doc_id
            stats["created"] += 1
            log.info(
                "  Created: %s (pdf: %s/%s)",
                paper_label[:60],
                "resolved" if pdf_result.get("resolved") else "missing",
                "uploaded" if pdf_result.get("uploaded") else "not-uploaded",
            )
        else:
            stats["failed"] += 1

    log.info(
        f"Publications: {stats['created']} created, {stats['updated']} updated, "
        f"{stats['skipped']} skipped, {stats['protected_manual']} manual protected, {stats['failed']} failed"
    )
    log.info(
        f"PDFs: {stats['pdf_attempted']} attempted, {stats['pdf_resolved']} resolved, {stats['pdf_uploaded']} uploaded"
    )
    return pub_map, stats


def upload_graph_links(strapi, links_to_upload, pub_map, communities=None, logger=None):
    """Create graph links between uploaded publications."""
    log = logger or logging.getLogger("paper-sync")

    if not links_to_upload:
        return {"created": 0, "failed": 0}

    log.info(f"Uploading {len(links_to_upload)} graph links...")
    link_ok = 0
    link_fail = 0

    for link in links_to_upload:
        source_paper_id = link["source_paper_id"]
        target_paper_id = link["target_paper_id"]

        src_id = pub_map.get(source_paper_id) or strapi.get_publication_id_by_openalex(source_paper_id)
        tgt_id = pub_map.get(target_paper_id) or strapi.get_publication_id_by_openalex(target_paper_id)

        if not src_id or not tgt_id:
            link_fail += 1
            continue

        is_cross = False
        if communities:
            src_comm = communities.get(source_paper_id)
            tgt_comm = communities.get(target_paper_id)
            is_cross = src_comm is not None and tgt_comm is not None and src_comm != tgt_comm

        success = strapi.create_graph_link(src_id, tgt_id, link["score"], is_cross_cluster=is_cross)
        if success:
            link_ok += 1
        else:
            link_fail += 1

    log.info(f"Links: {link_ok} created, {link_fail} failed/skipped")
    return {"created": link_ok, "failed": link_fail}


def replace_graph_links(strapi, links_to_upload, pub_map, communities=None, logger=None):
    """Replace all derived graph links with a freshly rebuilt set."""
    log = logger or logging.getLogger("paper-sync")

    log.info("Replacing graph links from global rebuild...")
    strapi.clear_graph_links()
    return upload_graph_links(strapi, links_to_upload, pub_map, communities=communities, logger=log)


def update_community_assignments(strapi, communities, community_labels, pub_map, logger=None):
    """Write community assignments back onto publications."""
    log = logger or logging.getLogger("paper-sync")

    if not communities or not community_labels:
        return 0

    log.info("Updating community assignments on publications...")
    comm_ok = 0
    for paper_id, comm_id in communities.items():
        doc_id = pub_map.get(paper_id) or strapi.get_publication_id_by_openalex(paper_id)
        if not doc_id:
            continue

        label_str = community_labels.get(comm_id, f"Cluster {comm_id}")
        if strapi.update_publication(doc_id, {"community": comm_id, "communityLabel": label_str}):
            comm_ok += 1

    log.info(f"Community assignments: {comm_ok} updated")
    return comm_ok


def update_graph_metadata(strapi, graph, pub_map, logger=None):
    """Write embedding and graph indexing metadata back onto publications."""
    log = logger or logging.getLogger("paper-sync")

    indexed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    updated = 0

    for paper_id, document_id in pub_map.items():
        embedding_payload = graph.embedding_payloads.get(paper_id)
        community_id = graph.communities.get(paper_id)
        community_label = graph.community_labels.get(community_id) if community_id is not None else None
        secondary_clusters = graph.secondary_clusters.get(paper_id, [])
        topic_superclusters = graph.paper_topic_superclusters.get(paper_id)
        existing_metadata = graph.paper_metadata.get(paper_id, {})
        payload = strapi.build_graph_metadata_payload(
            embedding_payload=embedding_payload,
            community_id=community_id,
            community_label=community_label,
            secondary_clusters=secondary_clusters,
            topic_superclusters=topic_superclusters,
            existing_metadata=existing_metadata,
            indexed_at=indexed_at,
            clear_missing=True,
        )
        if not payload:
            continue
        if strapi.update_publication(document_id, payload):
            updated += 1

    log.info(f"Graph metadata: {updated} publications updated")
    return updated


def update_macro_assignments(
    strapi,
    graph,
    papers,
    pub_map,
    model_name,
    tag_top_n=DEFAULT_MACRO_TAG_TOP_N,
    logger=None,
):
    """Assign macro primary and tag relations for non-manual publications."""
    log = logger or logging.getLogger("paper-sync")

    macros = strapi.load_graph_macros()
    if not macros:
        log.warning("No graph macros found; skipping macro assignment")
        return 0, {}

    active_macros = [macro for macro in macros if macro.get("isActive", True)]
    if not active_macros:
        active_macros = macros

    log.info(
        "Macro diagnostics (static macros): loaded=%s active=%s",
        len(macros),
        len(active_macros),
    )

    macro_texts = [_build_macro_text(macro) for macro in active_macros]
    macro_embeddings = gg.build_text_embeddings(macro_texts, model_name)
    if len(macro_embeddings) == 0:
        log.warning("No macro embeddings produced; skipping macro assignment")
        return 0, {}

    macro_ids = [macro["documentId"] for macro in active_macros]

    paper_embeddings = {}
    for paper, embedding in zip(graph.filtered_papers, graph.embeddings):
        paper_id = gg.paper_identifier(paper)
        if paper_id:
            paper_embeddings[paper_id] = embedding

    missing_papers = []
    missing_texts = []
    for paper in papers:
        paper_id = gg.paper_identifier(paper)
        if not paper_id or paper_id in paper_embeddings:
            continue
        text = _build_paper_text(paper)
        if not text:
            continue
        missing_papers.append(paper)
        missing_texts.append(text)

    if missing_texts:
        missing_embeddings = gg.build_text_embeddings(missing_texts, model_name)
        for paper, embedding in zip(missing_papers, missing_embeddings):
            paper_id = gg.paper_identifier(paper)
            if paper_id:
                paper_embeddings[paper_id] = embedding

    tag_top_n = max(0, int(tag_top_n or 0))
    updated = 0
    skipped_manual = 0
    skipped_missing = 0
    paper_macro_map = {}
    macro_name_by_id = {macro["documentId"]: (macro.get("name") or macro["documentId"]) for macro in active_macros}
    primary_counts = {}

    for paper in papers:
        paper_id = gg.paper_identifier(paper)
        if not paper_id:
            skipped_missing += 1
            continue
        document_id = pub_map.get(paper_id) or strapi.get_publication_id_by_openalex(paper_id)
        if not document_id:
            skipped_missing += 1
            continue

        source_kind = strapi.get_publication_source_kind(document_id)
        if source_kind == "manual":
            skipped_manual += 1
            continue

        embedding = paper_embeddings.get(paper_id)
        if embedding is None:
            skipped_missing += 1
            continue

        scores = macro_embeddings.dot(embedding)
        ranked = sorted(range(len(macro_ids)), key=lambda idx: float(scores[idx]), reverse=True)
        if not ranked:
            skipped_missing += 1
            continue

        primary_id = macro_ids[ranked[0]]
        tag_ids = []
        if tag_top_n > 0 and len(ranked) > 1:
            for idx in ranked[1:]:
                if len(tag_ids) >= tag_top_n:
                    break
                tag_ids.append(macro_ids[idx])

        payload = {
            "graphMacroPrimary": primary_id,
            "graphMacroTags": tag_ids,
        }

        if strapi.update_publication(document_id, payload):
            updated += 1
            paper_macro_map[paper_id] = primary_id
            primary_counts[primary_id] = primary_counts.get(primary_id, 0) + 1

    log.info(
        "Macro assignments: %s updated, %s manual skipped, %s missing/empty",
        updated,
        skipped_manual,
        skipped_missing,
    )

    ranked = sorted(primary_counts.items(), key=lambda item: item[1], reverse=True)
    top_parts = [f"{macro_name_by_id.get(macro_id, macro_id)}={count}" for macro_id, count in ranked[:5]]
    log.info(
        "Macro diagnostics (static macros): assigned=%s distribution=%s",
        updated,
        ", ".join(top_parts) if top_parts else "n/a",
    )

    return updated, paper_macro_map


def _build_meso_slug(cluster_id):
    return f"{MESO_SLUG_PREFIX}{int(cluster_id)}"


def _build_meso_name(cluster_id, cluster_labels):
    label = cluster_labels.get(cluster_id)
    if isinstance(label, str) and label.strip():
        return label.strip()
    return f"Topic Group {cluster_id}"


def update_meso_assignments(strapi, graph, papers, pub_map, paper_macro_map=None, logger=None):
    """Create/update graph meso nodes and assign meso tags for non-manual papers."""
    log = logger or logging.getLogger("paper-sync")

    topic_hierarchy = graph.topic_hierarchy or {}
    cluster_labels = topic_hierarchy.get("cluster_labels", {})
    paper_superclusters = graph.paper_topic_superclusters or {}

    if not paper_superclusters:
        log.warning("No topic superclusters available; skipping meso assignment")
        return 0

    if paper_macro_map is None:
        paper_macro_map = {}
        log.warning("No macro assignments map provided; meso macro links may be empty")

    # Build macro majority per meso from current macro assignments.
    macro_votes = {}
    for paper in papers:
        paper_id = gg.paper_identifier(paper)
        if not paper_id:
            continue
        assignment = paper_superclusters.get(paper_id, {})
        primary_id = assignment.get("primaryId")
        if primary_id is None:
            continue
        macro_id = paper_macro_map.get(paper_id)
        if not macro_id:
            continue
        votes = macro_votes.setdefault(int(primary_id), {})
        votes[macro_id] = votes.get(macro_id, 0) + 1

    existing_mesos = strapi.load_graph_mesos()
    meso_by_slug = {meso.get("slug"): meso for meso in existing_mesos if meso.get("slug")}

    cluster_ids = set()
    for assignment in paper_superclusters.values():
        ids = assignment.get("ids") or []
        for cid in ids:
            if isinstance(cid, int):
                cluster_ids.add(cid)
            elif isinstance(cid, str) and cid.isdigit():
                cluster_ids.add(int(cid))

    if not cluster_ids:
        log.warning("No meso cluster ids found; skipping meso assignment")
        return 0

    base_labels = {}
    label_counts = {}
    for cluster_id in cluster_ids:
        label = _build_meso_name(cluster_id, cluster_labels)
        base_labels[cluster_id] = label
        label_counts[label] = label_counts.get(label, 0) + 1

    meso_id_by_cluster = {}
    meso_created = 0
    meso_updated = 0
    meso_with_macro = 0
    for cluster_id in sorted(cluster_ids):
        slug = _build_meso_slug(cluster_id)
        base_label = base_labels[cluster_id]
        name = f"{base_label} ({cluster_id})" if label_counts.get(base_label, 0) > 1 else base_label
        keywords = base_label
        macro_id = None
        votes = macro_votes.get(int(cluster_id), {})
        if votes:
            macro_id = max(votes.items(), key=lambda item: item[1])[0]
            meso_with_macro += 1

        payload = {
            "name": name,
            "slug": slug,
            "keywords": keywords,
            "macro": macro_id,
        }

        existing = meso_by_slug.get(slug)
        if existing:
            strapi.update_graph_meso(existing["documentId"], payload)
            meso_id_by_cluster[int(cluster_id)] = existing["documentId"]
            meso_updated += 1
        else:
            created_id = strapi.create_graph_meso(payload)
            if created_id:
                meso_id_by_cluster[int(cluster_id)] = created_id
                meso_created += 1

    log.info(
        "Meso diagnostics: clusters=%s created=%s updated=%s macro_linked=%s",
        len(cluster_ids),
        meso_created,
        meso_updated,
        meso_with_macro,
    )

    updated = 0
    skipped_manual = 0
    skipped_missing = 0

    for paper in papers:
        paper_id = gg.paper_identifier(paper)
        if not paper_id:
            skipped_missing += 1
            continue
        document_id = pub_map.get(paper_id) or strapi.get_publication_id_by_openalex(paper_id)
        if not document_id:
            skipped_missing += 1
            continue

        source_kind = strapi.get_publication_source_kind(document_id)
        if source_kind == "manual":
            skipped_manual += 1
            continue

        assignment = paper_superclusters.get(paper_id, {})
        ids = assignment.get("ids") or []
        meso_ids = [meso_id_by_cluster.get(int(cid)) for cid in ids if meso_id_by_cluster.get(int(cid))]
        if not meso_ids:
            skipped_missing += 1
            continue

        # Determine primary meso: prefer paper's topic primary if available,
        # otherwise fall back to the first assigned meso id (stable fallback).
        primary_meso = None
        try:
            primary_cluster = assignment.get("primaryId")
            if primary_cluster is not None:
                primary_meso = meso_id_by_cluster.get(int(primary_cluster))
        except Exception:
            primary_meso = None

        if not primary_meso and meso_ids:
            primary_meso = meso_ids[0]

        update_payload = {"graphMesoTags": meso_ids}
        if primary_meso:
            update_payload["graphMesoPrimary"] = primary_meso

        if strapi.update_publication(document_id, update_payload):
            updated += 1

    log.info(
        "Meso assignments: %s updated, %s manual skipped, %s missing/empty",
        updated,
        skipped_manual,
        skipped_missing,
    )
    return updated