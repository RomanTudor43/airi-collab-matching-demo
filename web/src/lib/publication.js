export const PUBLICATION_SOURCE_KIND = {
  MANUAL: 'manual',
  OPENALEX_AUTOMATED: 'openAlexAutomated',
};

const OPENALEX_LIKE_VALUES = new Set([
  'openalex',
  'openalexautomated',
  'open_alex_automated',
  'openalex_automated',
  'merged',
]);

const MANUAL_LIKE_VALUES = new Set([
  'manual',
  'curated',
  'handmade',
]);

export function normalizePublicationSourceKind(sourceKind, openAlexId) {
  const raw = String(sourceKind || '').trim();
  const normalized = raw.toLowerCase();

  if (raw === PUBLICATION_SOURCE_KIND.MANUAL || raw === PUBLICATION_SOURCE_KIND.OPENALEX_AUTOMATED) {
    return raw;
  }

  if (OPENALEX_LIKE_VALUES.has(normalized)) {
    return PUBLICATION_SOURCE_KIND.OPENALEX_AUTOMATED;
  }

  if (MANUAL_LIKE_VALUES.has(normalized)) {
    return PUBLICATION_SOURCE_KIND.MANUAL;
  }

  return openAlexId ? PUBLICATION_SOURCE_KIND.OPENALEX_AUTOMATED : PUBLICATION_SOURCE_KIND.MANUAL;
}

export function getPublicationSourceLabel(sourceKind, openAlexId) {
  return normalizePublicationSourceKind(sourceKind, openAlexId) === PUBLICATION_SOURCE_KIND.OPENALEX_AUTOMATED
    ? 'OpenAlex automated'
    : 'Manual';
}
