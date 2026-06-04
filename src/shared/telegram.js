import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

const telegramManagerPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../components/TelegramManager.jsx'
);

const TELEGRAM_TEMPLATE_START = 'const TelegramTemplates = {';
const TELEGRAM_TEMPLATE_END_MARKERS = [
  '\r\n};\r\n\r\nexport function useTelegram',
  '\n};\n\nexport function useTelegram',
];

let cachedTelegramTemplates = null;

function loadTelegramTemplatesFromManager() {
  if (cachedTelegramTemplates) return cachedTelegramTemplates;

  const source = fs.readFileSync(telegramManagerPath, 'utf8');
  const startIndex = source.indexOf(TELEGRAM_TEMPLATE_START);
  if (startIndex < 0) {
    throw new Error('Unable to locate TelegramTemplates in src/components/TelegramManager.jsx');
  }

  let endIndex = -1;
  for (const marker of TELEGRAM_TEMPLATE_END_MARKERS) {
    endIndex = source.indexOf(marker, startIndex);
    if (endIndex >= 0) break;
  }
  if (endIndex < 0) {
    throw new Error('Unable to locate TelegramTemplates terminator in src/components/TelegramManager.jsx');
  }

  const bodyStart = startIndex + TELEGRAM_TEMPLATE_START.length;
  const bodyEnd = endIndex;
  if (bodyEnd <= bodyStart) {
    throw new Error('Unable to parse TelegramTemplates block in src/components/TelegramManager.jsx');
  }

  const divider = '━━━━━━━━━━━━━━';
  const templateFactory = new Function('escapeHtml', 'divider', `return ({${source.slice(bodyStart, bodyEnd)}});`);
  cachedTelegramTemplates = templateFactory(escapeHtml, divider);
  return cachedTelegramTemplates;
}

export const TelegramTemplates = loadTelegramTemplatesFromManager();
