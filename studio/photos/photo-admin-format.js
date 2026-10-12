export function utcDate(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  // SQLite CURRENT_TIMESTAMP is UTC but omits the timezone suffix.
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(input) ? `${input.replace(' ', 'T')}Z` : input;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function localTimestamp(value) {
  const date = utcDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date) + ' · ' + new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date) : 'Timestamp unavailable';
}

export const accountStatus = (value) => ({ PENDING: 'Pending', ACTIVE: 'Active', INACTIVE: 'Deactivated', REVOKED: 'Revoked', INVITED: 'Pending' }[value] || value);
export const assignedIds = (value) => [...new Set(String(value || '').split(',').filter(Boolean))];
