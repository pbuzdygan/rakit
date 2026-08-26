export function parseApiTimestamp(value?: string | null) {
  if (!value) return null;
  const raw = value.trim();
  const explicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = explicitZone ? raw : `${raw.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | null | undefined, timeZone?: string, fallback = '—') {
  const date = parseApiTimestamp(value);
  if (!date) return value || fallback;
  return date.toLocaleString(undefined, timeZone ? { timeZone } : undefined);
}

export function formatDateOnly(value: string | null | undefined, timeZone?: string, fallback = '—') {
  const date = parseApiTimestamp(value);
  if (!date) return value || fallback;
  return date.toLocaleDateString(undefined, timeZone ? { timeZone } : undefined);
}

export function formatRelativeTime(value?: string | null) {
  const date = parseApiTimestamp(value);
  if (!date) return value || '—';
  const delta = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
