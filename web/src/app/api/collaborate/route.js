import { loadCollabCorpus } from '@/lib/collab-index';
import {
  aggregatePeople,
  personReason,
  projectReason,
  relevanceFloor,
  scoreProjects,
  scorePublications,
  titleCaseName,
  tokenize,
} from '@/lib/collab-match';
import { resolvePersonContact, resolveProjectContact } from '@/lib/collab-contacts';

export const dynamic = 'force-dynamic';

const TOP_K = 5;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const raw = body?.interests;
  const interests = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (!interests.length) {
    return Response.json({ error: "'interests' is required" }, { status: 400 });
  }
  const top = Number.isFinite(body?.top) ? Math.max(1, Math.min(Math.trunc(body.top), 25)) : 5;

  const query = interests.join(', ');
  const queryTokens = tokenize(query);
  const floor = relevanceFloor(queryTokens);

  const corpus = await loadCollabCorpus();
  const { scored, scoreByDocId } = scorePublications(corpus.publications, queryTokens);

  const researchers = aggregatePeople(scored, TOP_K)
    .slice(0, top)
    .map((r, i) => {
      const person = corpus.peopleByName.get(r.key) || { fullName: titleCaseName(r.key) };
      const [contact, contactSource] = resolvePersonContact(person, corpus.leadByMember);
      return {
        rank: i + 1,
        name: person.fullName,
        title: person.title || null,
        slug: person.slug || null,
        score: Math.round(r.score * 10) / 10,
        topScore: r.best.score,
        matched: r.matched,
        weak: r.best.score < floor,
        reason: personReason(r),
        contact,
        contactSource,
      };
    });

  const projects = scoreProjects(corpus.projects, scoreByDocId, queryTokens)
    .slice(0, top)
    .map((r, i) => {
      const [contact, contactSource] = resolveProjectContact(r.project);
      return {
        rank: i + 1,
        title: r.project.title,
        slug: r.project.slug || null,
        score: r.score,
        via: r.via,
        weak: r.score < floor,
        reason: projectReason(r),
        contact,
        contactSource,
        themes: r.project.themes,
      };
    });

  return Response.json({
    query,
    mode: 'keyword',
    relevanceFloor: floor,
    coverage: {
      publications: corpus.publications.length,
      scored: scored.length,
      people: corpus.people.length,
      projects: corpus.projects.length,
    },
    researchers,
    projects,
  });
}
