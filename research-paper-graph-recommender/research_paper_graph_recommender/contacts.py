"""Contact resolution with a privacy-respecting fallback chain.

We only ever surface contact information that already exists publicly in
Strapi. If a person has no public contact, we fall back to their team
coordinator, then to a project's own contact info, and finally to the
institute's public address.
"""

# Public institute contact (GitHub org + site footer). Hardcoded by request;
# swap for a Strapi field later if a definitive one is identified.
INSTITUTE_FALLBACK_EMAIL = "airi@campus.utcluj.ro"


def resolve_person_contact(person, lead_by_member):
    """Return ``(contact_string, source)`` for a person.

    Order: own email -> own public social link -> team coordinator -> institute.
    """
    email = (person.get("email") or "").strip()
    if email:
        return email, "own email"

    social_links = person.get("socialLinks") or []
    if social_links:
        link = social_links[0]
        label = link.get("label") or "profile"
        return f"{label}: {link['url']}", "own public link"

    key = (person.get("fullName") or "").lower().strip()
    lead = lead_by_member.get(key)
    if lead:
        if lead.get("email"):
            return (
                f"team coordinator {lead['fullName']} <{lead['email']}>",
                "team coordinator",
            )
        # Coordinator known but no public email for them either -> institute.
        return (
            f"team coordinator {lead['fullName']} (via {INSTITUTE_FALLBACK_EMAIL})",
            "team coordinator (no public email)",
        )

    return INSTITUTE_FALLBACK_EMAIL, "institute (no public contact found)"


def resolve_project_contact(project):
    """Return ``(contact_string, source)`` for a project.

    Order: project contact entry (prefer email) -> a contributor's public
    email -> institute.
    """
    contact_info = project.get("contactInfo") or {}
    entries = contact_info.get("entries") or []

    # Prefer an explicit email entry, then any entry.
    email_entries = [e for e in entries if (e.get("type") or "").lower() == "email"]
    chosen = (email_entries or entries)
    if chosen:
        entry = chosen[0]
        value = entry["value"]
        label = entry.get("label") or entry.get("type") or "contact"
        # Avoid "email: email" when the label just duplicates the value.
        formatted = value if label.strip().lower() == value.strip().lower() else f"{label}: {value}"
        return formatted, "project contact info"

    for contributor in project.get("contributors") or []:
        if contributor.get("email"):
            return (
                f"contributor {contributor['fullName']} <{contributor['email']}>",
                "project contributor email",
            )

    return INSTITUTE_FALLBACK_EMAIL, "institute (no public contact found)"
