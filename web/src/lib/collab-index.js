// Data loading for the /collaborate feature (read-only Strapi GETs).
// See docs/collaborate-matching.md for the full feature description.

import { fetchAPI } from './strapi';

const REVALIDATE_SECONDS = 300;

const attrsOf = (row) => row?.attributes || row;

const relationItems = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.data)) return value.data;
  if (value.data) return [value.data];
  if (value.id || value.documentId || value.attributes) return [value];
  return [];
};

async function fetchAllPages(endpoint, params) {
  const rows = [];
  let page = 1;
  let pageCount = 1;
  while (page <= pageCount) {
    const qs = new URLSearchParams({
      ...params,
      'pagination[page]': String(page),
      'pagination[pageSize]': '100',
    });
    const data = await fetchAPI(`/${endpoint}?${qs.toString()}`, {
      revalidate: REVALIDATE_SECONDS,
    });
    if (Array.isArray(data?.data)) rows.push(...data.data);
    const metaPageCount = data?.meta?.pagination?.pageCount;
    pageCount = typeof metaPageCount === 'number' ? metaPageCount : pageCount;
    page += 1;
  }
  return rows;
}

async function loadPublications() {
  const rows = await fetchAllPages('publications', {
    'filters[graphEligible][$eq]': 'true',
    'fields[0]': 'title',
    'fields[1]': 'abstract',
    'fields[2]': 'topics',
    'populate[authors][fields][0]': 'fullName',
  });

  return rows.map((row) => {
    const attrs = attrsOf(row);
    return {
      documentId: row.documentId || row.id,
      title: attrs.title || '',
      abstract: attrs.abstract || '',
      topics: attrs.topics || [],
      authors: relationItems(attrs.authors)
        .map((a) => attrsOf(a).fullName)
        .filter(Boolean),
    };
  });
}

async function loadPeople() {
  const rows = await fetchAllPages('people', {
    'fields[0]': 'fullName',
    'fields[1]': 'slug',
    'fields[2]': 'email',
    'fields[3]': 'title',
    'fields[4]': 'firstName',
    'fields[5]': 'lastName',
    'populate[socialLinks][fields][0]': 'label',
    'populate[socialLinks][fields][1]': 'url',
  });

  const people = [];
  for (const row of rows) {
    const attrs = attrsOf(row);
    const fullName = (
      attrs.fullName || `${attrs.firstName || ''} ${attrs.lastName || ''}`
    ).trim();
    if (!fullName) continue;

    people.push({
      fullName,
      slug: attrs.slug,
      email: (attrs.email || '').trim(),
      title: attrs.title,
      socialLinks: relationItems(attrs.socialLinks)
        .map((link) => ({
          label: (attrsOf(link).label || '').trim(),
          url: (attrsOf(link).url || '').trim(),
        }))
        .filter((link) => link.url),
    });
  }

  const byName = new Map(people.map((p) => [p.fullName.toLowerCase(), p]));
  return { people, byName };
}

// The `team` content type is not publicly readable in production (403); in that
// case fetchAPI returns empty data and the coordinator fallback is simply skipped.
async function loadTeamLeads() {
  const rows = await fetchAllPages('teams', {
    'fields[0]': 'name',
    'populate[members][fields][0]': 'isLead',
    'populate[members][populate][person][fields][0]': 'fullName',
    'populate[members][populate][person][fields][1]': 'email',
  });

  const leadByMember = new Map();
  for (const row of rows) {
    const attrs = attrsOf(row);
    const members = relationItems(attrs.members).map((m) => attrsOf(m));

    let lead = null;
    const memberNames = [];
    for (const member of members) {
      const person = relationItems(member.person).map((p) => attrsOf(p))[0];
      const name = (person?.fullName || '').trim();
      if (!name) continue;
      memberNames.push(name);
      if (member.isLead && !lead) {
        lead = { fullName: name, email: (person.email || '').trim() };
      }
    }

    if (!lead) continue;
    for (const name of memberNames) {
      const key = name.toLowerCase();
      if (key === lead.fullName.toLowerCase()) continue;
      if (!leadByMember.has(key)) {
        leadByMember.set(key, { teamName: attrs.name, ...lead });
      }
    }
  }
  return leadByMember;
}

async function loadProjects() {
  const rows = await fetchAllPages('projects', {
    'fields[0]': 'title',
    'fields[1]': 'slug',
    'fields[2]': 'abstract',
    'populate[publications][fields][0]': 'title',
    'populate[contributors][fields][0]': 'fullName',
    'populate[contributors][fields][1]': 'email',
    'populate[themes][fields][0]': 'name',
    'populate[contactInfo][populate][contactEntries][fields][0]': 'type',
    'populate[contactInfo][populate][contactEntries][fields][1]': 'value',
    'populate[contactInfo][populate][contactEntries][fields][2]': 'label',
  });

  return rows.map((row) => {
    const attrs = attrsOf(row);
    const contactInfo = attrsOf(attrs.contactInfo?.data || attrs.contactInfo || {});
    return {
      documentId: row.documentId || row.id,
      title: (attrs.title || '').trim(),
      slug: attrs.slug,
      abstract: (attrs.abstract || '').trim(),
      themes: relationItems(attrs.themes)
        .map((t) => (attrsOf(t).name || '').trim())
        .filter(Boolean),
      publications: relationItems(attrs.publications)
        .map((p) => ({
          documentId: p.documentId || p.id,
          title: attrsOf(p).title,
        }))
        .filter((p) => p.documentId),
      contributors: relationItems(attrs.contributors)
        .map((c) => ({
          fullName: (attrsOf(c).fullName || '').trim(),
          email: (attrsOf(c).email || '').trim(),
        }))
        .filter((c) => c.fullName),
      contactEntries: relationItems(contactInfo.contactEntries)
        .map((e) => ({
          type: attrsOf(e).type,
          value: (attrsOf(e).value || '').trim(),
          label: (attrsOf(e).label || '').trim(),
        }))
        .filter((e) => e.value),
    };
  });
}

export async function loadCollabCorpus() {
  const [publications, peopleData, leadByMember, projects] = await Promise.all([
    loadPublications(),
    loadPeople(),
    loadTeamLeads(),
    loadProjects(),
  ]);
  return {
    publications,
    people: peopleData.people,
    peopleByName: peopleData.byName,
    leadByMember,
    projects,
  };
}
