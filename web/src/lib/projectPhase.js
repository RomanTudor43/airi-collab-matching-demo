/**
 * Parse an input value to a valid Date instance.
 * @param {string|Date|null|undefined} value
 * @returns {Date|null}
 */
function parseDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Derive project phase/status from start and end dates.
 *
 * Status logic:
 * - planned: now is before start date
 * - ongoing: now is between start and end or no end date after start
 * - ended: now is after end date
 * - unknown: no valid date information
 *
 * @param {string|Date|null} startDate - Project start date
 * @param {string|Date|null} endDate - Project end date
 * @param {Date} [nowInput] - Optional current date for deterministic tests
 * @returns {{status: 'planned'|'ongoing'|'ended'|'unknown', start: Date|null, end: Date|null, color: 'blue'|'green'|'gray'}}
 */
export function getProjectPhase(startDate, endDate, nowInput = new Date()) {
  const now = parseDate(nowInput) || new Date();
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  if (end && now > end) {
    return {
      status: 'ended',
      start,
      end,
      color: 'gray',
    };
  }

  if (start && now < start) {
    return {
      status: 'planned',
      start,
      end,
      color: 'blue',
    };
  }

  if (start || end) {
    return {
      status: 'ongoing',
      start,
      end,
      color: 'green',
    };
  }

  return {
    status: 'unknown',
    start: null,
    end: null,
    color: 'gray',
  };
}

/**
 * Get CSS classes for phase badge based on status
 * @param {string} status - Phase status (planned, ongoing, ended, unknown)
 * @returns {string} Tailwind CSS classes
 */
export function getPhaseColorClasses(status) {
  const colorMap = {
    planned: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-100 dark:ring-1 dark:ring-blue-300/40',
    ongoing: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/25 dark:text-emerald-100 dark:ring-1 dark:ring-emerald-300/40',
    ended: 'bg-slate-200 text-slate-800 dark:bg-slate-500/25 dark:text-slate-100 dark:ring-1 dark:ring-slate-300/40',
    unknown: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-100 dark:ring-1 dark:ring-gray-300/35',
  };

  return colorMap[status] || colorMap.unknown;
}
