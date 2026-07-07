// Keyword-overlap matching for the /collaborate feature.
// See docs/collaborate-matching.md for the scoring approach and rationale.

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'in', 'into',
  'of', 'on', 'or', 'the', 'to', 'with', 'via', 'using', 'is', 'be', 'we',
  'this', 'that', 'it', 'its', 'their', 'our', 'based', 'approach', 'study',
]);

export function tokenize(text) {
  if (!text) return new Set();
  const tokens = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  return new Set(tokens.filter((t) => t.length > 2 && !STOPWORDS.has(t)));
}

function sharedTerms(queryTokens, tokens) {
  return [...queryTokens].filter((t) => tokens.has(t));
}

// A best-publication overlap below this floor is a "weak" match.
export function relevanceFloor(queryTokens) {
  return Math.min(2, queryTokens.size);
}

export function scorePublications(publications, queryTokens) {
  const scored = [];
  const scoreByDocId = new Map();
  for (const pub of publications) {
    const text = [pub.title, pub.abstract, ...(pub.topics || [])].join(' ');
    const terms = sharedTerms(queryTokens, tokenize(text));
    if (terms.length > 0) {
      scored.push({ pub, score: terms.length, terms });
      scoreByDocId.set(pub.documentId, terms.length);
    }
  }
  return { scored, scoreByDocId };
}

export function aggregatePeople(scoredPubs, topK) {
  const byAuthor = new Map();
  for (const item of scoredPubs) {
    for (const name of item.pub.authors || []) {
      const key = name.toLowerCase().trim();
      if (!byAuthor.has(key)) byAuthor.set(key, []);
      byAuthor.get(key).push(item);
    }
  }

  const results = [];
  for (const [key, hits] of byAuthor) {
    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, topK);
    const score = top.reduce((sum, h) => sum + h.score, 0) / top.length;
    results.push({ key, score, matched: hits.length, best: hits[0] });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

export function scoreProjects(projects, scoreByDocId, queryTokens) {
  const results = [];
  for (const project of projects) {
    const ownText = [project.abstract, ...(project.themes || [])].join(' ');
    const ownTerms = sharedTerms(queryTokens, tokenize(ownText));

    let bestPub = null;
    for (const pub of project.publications || []) {
      const score = scoreByDocId.get(pub.documentId);
      if (score !== undefined && (!bestPub || score > bestPub.score)) {
        bestPub = { score, title: pub.title };
      }
    }

    if (ownTerms.length === 0 && !bestPub) continue;
    if (bestPub && bestPub.score > ownTerms.length) {
      results.push({
        project,
        score: bestPub.score,
        via: 'publications',
        bestPubTitle: bestPub.title,
        terms: [],
      });
    } else {
      results.push({ project, score: ownTerms.length, via: 'abstract', terms: ownTerms });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

const shorten = (title) => {
  const t = (title || 'untitled').trim();
  return t.length > 71 ? `${t.slice(0, 70)}…` : t;
};

const quoteTerms = (terms) => terms.slice(0, 3).map((t) => `"${t}"`).join(', ');

export function personReason(result) {
  const title = shorten(result.best.pub.title);
  const plural = result.matched !== 1 ? 's' : '';
  return `matched ${quoteTerms(result.best.terms)} on ${result.matched} publication${plural}; top: "${title}"`;
}

export function projectReason(result) {
  if (result.via === 'abstract') {
    return `project abstract mentions ${quoteTerms(result.terms)}`;
  }
  return `matched via linked publication "${shorten(result.bestPubTitle)}"`;
}

export function titleCaseName(key) {
  return key
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
