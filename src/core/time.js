export function toUtcTimestamp(value) {
  if (!value) return NaN;
  const text = String(value);
  const normalized = /\bUTC\b/i.test(text) ? text : `${text} UTC`;
  return new Date(normalized).getTime();
}

export function calculateRemainingTime(endTime, nowMs = Date.now()) {
  const endMs = toUtcTimestamp(endTime);
  if (!Number.isFinite(endMs)) return 'Expired';
  const diffMs = endMs - nowMs;
  if (diffMs <= 0) return 'Expired';

  const diffSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(diffSeconds / (3600 * 24));
  const hours = Math.floor((diffSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}
