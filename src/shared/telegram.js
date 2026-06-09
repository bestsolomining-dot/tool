export const TELEGRAM_CONFIG = {
  ALERT_COOLDOWN_MS: 10 * 60 * 1000,
  WARNING_RIG_THRESHOLD: 3,
  RENTED_HEARTBEAT_MS: 60 * 60 * 1000,
};

export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatAccount(account) {
  return escapeHtml(account || 'N/A');
}

export function formatRig(r) {
  return `${escapeHtml(r?.name || r?.id || 'N/A')} (<code>${escapeHtml(r?.id || 'N/A')}</code>)`;
}

export function formatHashrate(value, suffix) {
  const num = Number.parseFloat(value || 0);
  if (!Number.isFinite(num) || num <= 0) return '0 N/A';
  return `${num.toFixed(2)} ${suffix || ''}`.trim();
}

export function formatTimeRange(start, end) {
  return `${start || 'N/A'} - ${end || 'N/A'}`;
}

const divider = '━━━━━━━━━━━━━━';

/**
 * Shared Telegram Templates
 * Copy the definitions from TelegramManager.jsx into here.
 */
export const TelegramTemplates = {
  activeRentalLine: (perfEmoji, algo, name, remaining, efficiency, roi, avg, ads, cur, target, extra) => {
    return `${perfEmoji} <b>${escapeHtml(algo)}</b> | ${escapeHtml(name)}\n` +
           `⏱ Remaining: ${remaining}\n` +
           `📊 Eff: ${efficiency}% (ROI: ${roi}%)\n` +
           `📈 Avg: ${avg} | Ads: ${ads}\n` +
           `⚡ Cur: ${cur} | Tgt: ${target}\n` +
           `${extra}${divider}\n`;
  },
  // Add other templates from TelegramManager.jsx here as needed
};
