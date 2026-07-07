// Contact resolution for /collaborate results. Only surfaces contact info that
// is already public in Strapi; fallback chain documented in docs/collaborate-matching.md.

export const INSTITUTE_FALLBACK_EMAIL = 'airi@campus.utcluj.ro';

export function resolvePersonContact(person, leadByMember) {
  const email = (person.email || '').trim();
  if (email) return [email, 'own email'];

  const socialLinks = person.socialLinks || [];
  if (socialLinks.length > 0) {
    const link = socialLinks[0];
    return [`${link.label || 'profile'}: ${link.url}`, 'own public link'];
  }

  const lead = leadByMember.get((person.fullName || '').toLowerCase().trim());
  if (lead) {
    if (lead.email) {
      return [`team coordinator ${lead.fullName} <${lead.email}>`, 'team coordinator'];
    }
    return [
      `team coordinator ${lead.fullName} (via ${INSTITUTE_FALLBACK_EMAIL})`,
      'team coordinator (no public email)',
    ];
  }

  return [INSTITUTE_FALLBACK_EMAIL, 'institute (no public contact found)'];
}

export function resolveProjectContact(project) {
  const entries = project.contactEntries || [];
  const emailEntries = entries.filter((e) => (e.type || '').toLowerCase() === 'email');
  const entry = emailEntries[0] || entries[0];
  if (entry) {
    const label = entry.label || entry.type || 'contact';
    const formatted =
      label.trim().toLowerCase() === entry.value.trim().toLowerCase()
        ? entry.value
        : `${label}: ${entry.value}`;
    return [formatted, 'project contact info'];
  }

  for (const contributor of project.contributors || []) {
    if (contributor.email) {
      return [
        `contributor ${contributor.fullName} <${contributor.email}>`,
        'project contributor email',
      ];
    }
  }

  return [INSTITUTE_FALLBACK_EMAIL, 'institute (no public contact found)'];
}
