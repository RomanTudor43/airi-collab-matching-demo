"""Read-only Strapi access for the recommender.

We subclass the existing ``StrapiClient`` so we can reuse its battle-tested GET
utilities (``_fetch_all_pages``, ``_extract_relation_items``) and its existing
read loaders (``load_graph_eligible_publications``, ``load_graph_macros``)
*without* editing the original file.

Every mutating method of the parent is overridden to raise, so this client is
structurally incapable of writing to Strapi — a hard guarantee on top of the
discipline of only calling GET paths.
"""

import logging

# research_paper_graph is made importable by this package's __init__.
from research_paper_graph.strapi import StrapiClient

log = logging.getLogger("recommend")


class ReadOnlyViolation(RuntimeError):
    """Raised if anything attempts a Strapi write through this client."""


class ReadOnlyStrapiClient(StrapiClient):
    """A StrapiClient that can only read. Adds recommender-specific loaders."""

    def __init__(self, base_url, token):
        super().__init__(base_url, token)
        # With no token, rely on Strapi's public (anonymous) role. Sending an
        # empty "Bearer " header gets rejected with 401, so omit it entirely —
        # this mirrors how the site's own frontend fetches when no token is set.
        if not token:
            self.headers.pop("Authorization", None)
            self.upload_headers.pop("Authorization", None)

    # --- Structural write blocking -----------------------------------------
    def _blocked_write(self, *args, **kwargs):  # noqa: D401 - simple guard
        raise ReadOnlyViolation(
            "The recommender is read-only: Strapi writes are disabled. "
            "This call was blocked as a safety guarantee."
        )

    # Override every parent method that performs POST/PUT/DELETE/upload.
    create_publication = _blocked_write
    update_publication = _blocked_write
    create_graph_link = _blocked_write
    clear_graph_links = _blocked_write
    create_graph_meso = _blocked_write
    update_graph_meso = _blocked_write
    upload_pdf_from_openalex = _blocked_write
    ensure_publication_pdf = _blocked_write

    # --- Recommender read loaders ------------------------------------------
    def load_people_contacts(self):
        """Load all people with the public contact fields we may surface.

        Returns a dict keyed by normalized full name plus a ``by_key`` index,
        so authors (populated as full-name strings on publications) can be
        joined back to a person's contact details.
        """
        log.info("Loading people (contacts) from Strapi...")
        rows = self._fetch_all_pages(
            "people",
            {
                "fields[0]": "fullName",
                "fields[1]": "slug",
                "fields[2]": "email",
                "fields[3]": "type",
                "fields[4]": "title",
                "fields[5]": "firstName",
                "fields[6]": "lastName",
                "populate[socialLinks][fields][0]": "label",
                "populate[socialLinks][fields][1]": "url",
                "populate[socialLinks][fields][2]": "icon",
            },
        )

        people = []
        for row in rows:
            attrs = row.get("attributes", row)
            document_id = row.get("documentId") or row.get("id")
            full_name = (attrs.get("fullName") or "").strip()
            if not full_name:
                first = (attrs.get("firstName") or "").strip()
                last = (attrs.get("lastName") or "").strip()
                full_name = f"{first} {last}".strip()
            if not full_name:
                continue

            social_links = []
            for link in self._extract_relation_items(attrs.get("socialLinks")):
                link_attrs = link.get("attributes", link)
                url = (link_attrs.get("url") or "").strip()
                if url:
                    social_links.append(
                        {
                            "label": (link_attrs.get("label") or "").strip(),
                            "url": url,
                            "icon": link_attrs.get("icon"),
                        }
                    )

            people.append(
                {
                    "documentId": document_id,
                    "fullName": full_name,
                    "slug": attrs.get("slug"),
                    "email": (attrs.get("email") or "").strip(),
                    "type": attrs.get("type"),
                    "title": attrs.get("title"),
                    "socialLinks": social_links,
                }
            )

        by_key = {p["fullName"].lower().strip(): p for p in people}
        log.info("  Loaded %d people (%d with a public email)", len(people),
                 sum(1 for p in people if p["email"]))
        return people, by_key

    def load_teams_with_leads(self):
        """Load teams and their members so we can find each team's coordinator.

        A team's coordinator is the membership entry with ``isLead = true``.
        Returns a list of teams (with resolved lead) and an index mapping a
        member's normalized full name -> the lead contact for their team.
        """
        log.info("Loading teams (members + leads) from Strapi...")
        try:
            rows = self._fetch_all_pages(
                "teams",
                {
                    "fields[0]": "name",
                    "fields[1]": "slug",
                    "populate[members][fields][0]": "role",
                    "populate[members][fields][1]": "isLead",
                    "populate[members][populate][person][fields][0]": "fullName",
                    "populate[members][populate][person][fields][1]": "slug",
                    "populate[members][populate][person][fields][2]": "email",
                },
            )
        except Exception as exc:
            # `team` is not in the site's public permission set, so reading
            # production anonymously returns 403 here. Degrade gracefully: with
            # no team data the person-contact chain simply skips the
            # team-coordinator step and falls through to the institute address.
            log.warning("Could not load teams (%s); team-coordinator fallback disabled.", exc)
            return [], {}

        teams = []
        lead_by_member = {}
        for row in rows:
            attrs = row.get("attributes", row)
            team_name = (attrs.get("name") or "").strip()
            members = self._extract_relation_items(attrs.get("members"))

            member_names = []
            lead = None
            for member in members:
                member_attrs = member.get("attributes", member)
                person_items = self._extract_relation_items(member_attrs.get("person"))
                if not person_items:
                    continue
                person_attrs = person_items[0].get("attributes", person_items[0])
                person_name = (person_attrs.get("fullName") or "").strip()
                if not person_name:
                    continue
                member_names.append(person_name)
                if member_attrs.get("isLead") and lead is None:
                    lead = {
                        "fullName": person_name,
                        "email": (person_attrs.get("email") or "").strip(),
                        "role": member_attrs.get("role"),
                    }

            team = {"name": team_name, "slug": attrs.get("slug"), "lead": lead}
            teams.append(team)

            if lead:
                for name in member_names:
                    # Don't point a person at themselves as their own coordinator.
                    if name.lower().strip() == lead["fullName"].lower().strip():
                        continue
                    lead_by_member.setdefault(
                        name.lower().strip(),
                        {"teamName": team_name, **lead},
                    )

        log.info("  Loaded %d teams (%d with a designated lead)", len(teams),
                 sum(1 for t in teams if t["lead"]))
        return teams, lead_by_member

    def load_projects_for_matching(self):
        """Load projects with the fields needed for publication-propagation
        scoring, contact resolution, and the keyword fallback.
        """
        log.info("Loading projects from Strapi...")
        rows = self._fetch_all_pages(
            "projects",
            {
                "fields[0]": "title",
                "fields[1]": "slug",
                "fields[2]": "abstract",
                "populate[publications][fields][0]": "title",
                "populate[contributors][fields][0]": "fullName",
                "populate[contributors][fields][1]": "email",
                "populate[contributors][fields][2]": "slug",
                "populate[themes][fields][0]": "name",
                "populate[contactInfo][populate][contactEntries][fields][0]": "type",
                "populate[contactInfo][populate][contactEntries][fields][1]": "value",
                "populate[contactInfo][populate][contactEntries][fields][2]": "label",
            },
        )

        projects = []
        for row in rows:
            attrs = row.get("attributes", row)
            document_id = row.get("documentId") or row.get("id")

            publication_doc_ids = []
            publication_titles = {}
            for pub in self._extract_relation_items(attrs.get("publications")):
                pub_id = pub.get("documentId") or pub.get("id")
                if not pub_id:
                    continue
                publication_doc_ids.append(pub_id)
                pub_attrs = pub.get("attributes", pub)
                publication_titles[pub_id] = pub_attrs.get("title")

            contributors = []
            for person in self._extract_relation_items(attrs.get("contributors")):
                person_attrs = person.get("attributes", person)
                name = (person_attrs.get("fullName") or "").strip()
                if name:
                    contributors.append(
                        {"fullName": name, "email": (person_attrs.get("email") or "").strip()}
                    )

            themes = []
            for theme in self._extract_relation_items(attrs.get("themes")):
                theme_attrs = theme.get("attributes", theme)
                name = (theme_attrs.get("name") or "").strip()
                if name:
                    themes.append(name)

            projects.append(
                {
                    "documentId": document_id,
                    "title": (attrs.get("title") or "").strip(),
                    "slug": attrs.get("slug"),
                    "abstract": (attrs.get("abstract") or "").strip(),
                    "publicationDocIds": publication_doc_ids,
                    "publicationTitles": publication_titles,
                    "contributors": contributors,
                    "themes": themes,
                    "contactInfo": _parse_contact_info(attrs.get("contactInfo")),
                }
            )

        log.info("  Loaded %d projects (%d with an abstract, %d with linked publications)",
                 len(projects),
                 sum(1 for p in projects if p["abstract"]),
                 sum(1 for p in projects if p["publicationDocIds"]))
        return projects


def _parse_contact_info(contact_info):
    """Normalize a project ``contactInfo`` component into plain entries."""
    if not isinstance(contact_info, dict):
        # Some Strapi shapes wrap single components under "data".
        data = contact_info.get("data") if isinstance(contact_info, dict) else None
        contact_info = data if isinstance(data, dict) else None
    if not isinstance(contact_info, dict):
        return {"entries": [], "generalInfo": None}

    attrs = contact_info.get("attributes", contact_info)
    entries = []
    raw_entries = attrs.get("contactEntries")
    if isinstance(raw_entries, dict):
        raw_entries = raw_entries.get("data") or []
    for entry in raw_entries or []:
        entry_attrs = entry.get("attributes", entry)
        value = (entry_attrs.get("value") or "").strip()
        if not value:
            continue
        entries.append(
            {
                "type": entry_attrs.get("type"),
                "value": value,
                "label": (entry_attrs.get("label") or "").strip(),
            }
        )
    return {"entries": entries, "generalInfo": attrs.get("generalInfo")}
