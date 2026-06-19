export function toUtcTimestamp(value) {
  if (!value) return NaN;
  if (typeof value === "number") return value * 1000;

  let text = String(value).trim();
  // If it's a pure numeric string, treat as Unix seconds
  if (/^\d+$/.test(text)) return parseInt(text, 10) * 1000;

  // Convert space format "YYYY-MM-DD HH:mm:ss" to ISO "YYYY-MM-DDTHH:mm:ss"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    text = text.replace(" ", "T");
  }
  // Append Z if missing to force UTC interpretation
  const normalized =
    /\bUTC\b/i.test(text) || text.endsWith("Z")
      ? text
      : `${text}Z`.replace(" UTCZ", "Z");
  return new Date(normalized).getTime();
}

export function calculateRemainingTime(endTime, nowMs = Date.now()) {
  const endMs = toUtcTimestamp(endTime);
  if (!Number.isFinite(endMs)) return "Expired";
  const diffMs = endMs - nowMs;
  if (diffMs <= 0) return "Expired";

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
  return parts.join(" ");
}
