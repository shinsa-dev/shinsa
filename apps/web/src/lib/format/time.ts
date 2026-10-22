const MINUTE = 60_000;

export function formatAge(at: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  return new Date(at).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

export function formatTimeAgo(at: number, now = Date.now()) {
  const age = formatAge(at, now);
  return age === 'just now' ? 'Just now' : `${age} ago`;
}

export function formatDuration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function formatSpan(at: number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - at) / MINUTE));
  if (minutes < 1) return null;
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export function formatDay(at: number) {
  return new Date(at).toLocaleDateString('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatClock(at: number) {
  return new Date(at).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
}

export function resolveMinute(now = Date.now()) {
  return Math.floor(now / MINUTE);
}

export function resolveEndOfDay(now = Date.now()) {
  const end = new Date(now);
  end.setHours(23, 59, 0, 0);
  return end.getTime();
}
