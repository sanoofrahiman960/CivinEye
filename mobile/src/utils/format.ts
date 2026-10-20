const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then a date. */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const diff = now.getTime() - new Date(iso).getTime();
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  return formatDate(iso);
}

export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

export function formatDistance(metres: number | null | undefined): string {
  if (metres === null || metres === undefined) return '—';
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

export function formatCoordinate(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Due-date text for SLA displays: "Due in 5 h" or "Overdue by 2 days". */
export function formatDue(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'No deadline';
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const text = abs < DAY ? `${Math.max(1, Math.round(abs / HOUR))} h` : `${Math.round(abs / DAY)} days`;
  return diff >= 0 ? `Due in ${text}` : `Overdue by ${text}`;
}
