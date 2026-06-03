import { useCallback, useMemo, useState, useEffect } from 'react';
import { calculateRemainingTime as sharedCalculateRemainingTime } from '../core/time';
import MonitorDbEditor from './MonitorDbEditor';

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function calculateRemainingTime(endTime) {
  if (!endTime) return null;
  return sharedCalculateRemainingTime(endTime);
}

function getTelegramAccount(r, mrrClient) {
  const account = r?.mrrClient || r?.client || r?.account || mrrClient;
  if (!account) return 'N/A';
  if (String(account).toUpperCase() === 'VN') return 'ALL';
  return String(account).toUpperCase();
}

/** Formats the price/paid field from a rental object */
function getPaidAmount(r) {
  const p = r?.price;
  const currency = r?.price?.currency || r?.currency || 'BTC';
  const val = (p && typeof p === 'object') ? (p.paid || p.price || p.advertised) : (r?.price || '0.00');
  if (String(val).toUpperCase().includes(String(currency).toUpperCase())) return val;
  return `${val} ${currency}`;
}

const TelegramTemplates = {
  newRental: (account, r, paid, startStr, endStr) => `🚀 <b>[New Rental]</b>\n` +
    `<b>Account:</b> <code>${escapeHtml(account)}</code>\n` +
    `━━━━━━━━━━━━━━\n` +
    `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
    `<b>Algo:</b> <code>${escapeHtml(r.algo || r.rig?.type || 'N/A')}</code>\n` +
    `<b>Time:</b> ${startStr} - ${endStr}\n` +
    `━━━━━━━━━━━━━━\n` +
    `<b>Paid:</b> ${paid}\n` +
    `<i>Rental has been successfully initialized.</i>`,

  zeroHashrate: (account, r, elapsedMs, paid) => `🚨 <b>[Critical] Zero Hashrate!</b>\n` +
    `<b>Account:</b> <code>${escapeHtml(account)}</code>\n` +
    `━━━━━━━━━━━━━━\n` +
    `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
    `<b>Duration:</b> ${Math.round(elapsedMs / 1000)}s\n` +
    `<b>Efficiency:</b> <b>0%</b>\n` +
    `━━━━━━━━━━━━━━\n` +
    `<b>Paid:</b> ${paid}`,

  lowEfficiency: (account, r, avg, suffix, efficiency, remainingMs, paid) => `⚠️ <b>[Alert] Low Efficiency</b>\n` +
    `<b>Account:</b> <code>${escapeHtml(account)}</code>\n` +
    `━━━━━━━━━━━━━━\n` +
    `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
    `<b>Avg:</b> ${avg} ${suffix} (<b>${efficiency.toFixed(1)}%</b>)\n` +
    `<b>Left:</b> ${Math.round(remainingMs / 60000)}m\n` +
    `━━━━━━━━━━━━━━\n` +
    `<b>Paid:</b> ${paid}`,

  startup: (account, r, avg, suffix, efficiency, paid) => `🚀 <b>[Startup Alert]</b>\n` +
    `<b>Account:</b> <code>${escapeHtml(account)}</code>\n` +
    `━━━━━━━━━━━━━━\n` +
    `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
    `<b>Avg:</b> ${avg} ${suffix} (<b>${efficiency.toFixed(1)}%</b>)\n` +
    `━━━━━━━━━━━━━━\n` +
    `<b>Paid:</b> ${paid}`,

  completion: (account, r, avg, suffix, efficiency, paid) => `🏁 <b>[Completion Alert]</b>\n` +
    `<b>Account:</b> <code>${escapeHtml(account)}</code>\n` +
    `━━━━━━━━━━━━━━\n` +
    `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
    `<b>Avg:</b> ${avg} ${suffix} (<b>${efficiency.toFixed(1)}%</b>)\n` +
    `━━━━━━━━━━━━━━\n` +
    `<b>Paid:</b> ${paid}`,

  manualNotice: (r, account, avg, suffix, roi, remStr, progress, paid) => `💎 <b>[RENTED] #${r.id}</b>\n` +
    `━━━━━━━━━━━━━━\n` +
    `<b>Algo:</b> <code>${escapeHtml(r.rig?.type || r.algo || 'N/A').toUpperCase()}</code>\n` +
    `<b>Acct:</b> <code>${escapeHtml(account).toUpperCase()}</code>\n` +
    `━━━━━━━━━━━━━━\n` +
    `<b>Hash:</b> <code>${avg.toFixed(2)} ${suffix}</code>\n` +
    `<b>ROI:</b> <code>${roi >= 0 ? '+' : ''}${roi}%</code>\n` +
    `<b>Time:</b> <code>${remStr} left (${progress}%)</code>\n` +
    `<b>Paid:</b> <code>${paid}</code>\n` +
    `━━━━━━━━━━━━━━\n` +
    `<a href="https://www.miningrigrentals.com/rentals/view/${r.id}">[Open in MRR]</a>`
};

export function useTelegram(onCall, mrrClient) {
  const sendTelegram = useCallback((message, options = {}) => {
    return onCall('/api/v2/notify/telegram', {
      method: 'POST',
      body: { message },
      ...options
    });
  }, [onCall]);

  const notifyNewRental = useCallback((r) => {
    const account = getTelegramAccount(r, mrrClient);
    const paid = getPaidAmount(r);
    const startStr = String(r.start || '').replace(/:\d{2} UTC/i, '').replace(/^\d{4}-/, '');
    const endStr = String(r.end || '').replace(/:\d{2} UTC/i, '').replace(/^\d{4}-/, '');
    const msg = TelegramTemplates.newRental(account, r, paid, startStr, endStr);
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyZeroHashrate = useCallback((r, elapsedMs) => {
    const account = getTelegramAccount(r, mrrClient);
    const paid = getPaidAmount(r);
    const msg = TelegramTemplates.zeroHashrate(account, r, elapsedMs, paid);
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyLowEfficiency = useCallback((r, remainingMs, efficiency) => {
    const account = getTelegramAccount(r, mrrClient);
    const avg = parseFloat(r.hashrate?.average?.hash || r.hashrate?.average || 0).toFixed(2);
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const paid = getPaidAmount(r);
    const msg = TelegramTemplates.lowEfficiency(account, r, avg, suffix, efficiency, remainingMs, paid);
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyStartupEfficiencyAlert = useCallback((r, efficiency) => {
    const account = getTelegramAccount(r, mrrClient);
    const avg = parseFloat(r.hashrate?.average?.hash || r.hashrate?.average || 0).toFixed(2);
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const paid = getPaidAmount(r);
    const msg = TelegramTemplates.startup(account, r, avg, suffix, efficiency, paid);
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyCompletionEfficiencyAlert = useCallback((r, efficiency) => {
    const account = getTelegramAccount(r, mrrClient);
    const avg = parseFloat(r.hashrate?.average?.hash || r.hashrate?.average || 0).toFixed(2);
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const paid = getPaidAmount(r);
    const msg = TelegramTemplates.completion(account, r, avg, suffix, efficiency, paid);
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const sendManualNotice = useCallback((r, target) => {
    const startT = new Date(r.start + (String(r.start).endsWith('UTC') ? '' : ' UTC')).getTime();
    const endT = new Date(r.end + (String(r.end).endsWith('UTC') ? '' : ' UTC')).getTime();
    const now = Date.now();
    const totalMs = endT - startT;
    const elapsedMs = Math.max(0, Math.min(now - startT, totalMs));
    const remainingMs = Math.max(0, endT - now);
    
    const remD = Math.floor(remainingMs / 86400000);
    const remH = Math.floor((remainingMs % 86400000) / 3600000);
    const remStr = remD > 0 ? `${remD}d ${remH}h` : `${remH}h`;

    const account = getTelegramAccount(r, mrrClient);
    const efficiency = parseFloat(r.hashrate?.average?.percent || r.percent || 0);
    const roi = (efficiency - 100).toFixed(1);
    const progress = totalMs > 0 ? Math.floor((elapsedMs / totalMs) * 100) : 0;
    const avg = parseFloat(r.hashrate?.average?.hash || r.hashrate?.average || 0);
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const paid = getPaidAmount(r);

    const msg = TelegramTemplates.manualNotice(r, account, avg, suffix, roi, remStr, progress, paid);

    return sendTelegram(msg, { showModal: true });
  }, [sendTelegram, mrrClient]);

  return useMemo(() => ({
    sendTelegram,
    notifyNewRental,
    notifyZeroHashrate,
    notifyLowEfficiency,
    notifyStartupEfficiencyAlert,
    notifyCompletionEfficiencyAlert,
    sendManualNotice
  }), [sendTelegram, notifyNewRental, notifyZeroHashrate, notifyLowEfficiency, notifyStartupEfficiencyAlert, notifyCompletionEfficiencyAlert, sendManualNotice]);
}

export default function TelegramManager({ onCall, mrrClient }) {
  const { sendTelegram } = useTelegram(onCall, mrrClient);
  const [isMonitorDbOpen, setIsMonitorDbOpen] = useState(false);
  const [isTelegramOn, setIsTelegramOn] = useState(true);
  const [health, setHealth] = useState(null);

  // Fetch current notification status from server on mount
  useEffect(() => {
    onCall('/api/v2/notify/telegram/status', { method: 'GET', silent: true })
      .then(res => {
        if (res && typeof res.enabled === 'boolean') setIsTelegramOn(res.enabled);
      })
      .catch(() => {});

    onCall('/api/v2/notify/telegram/health', { method: 'GET', silent: true })
      .then(res => {
        setHealth(res);
      })
      .catch(() => {});
  }, [onCall]);

  const handleToggle = async () => {
    const target = !isTelegramOn;
    const res = await onCall('/api/v2/notify/telegram/status', {
      method: 'POST',
      body: { enabled: target },
      silent: true
    });
    if (res && typeof res.enabled === 'boolean') {
      setIsTelegramOn(res.enabled);
    }
  };

  return (
    <div style={{ display: 'contents' }}>
      <button
        className={`btn-pro ${isTelegramOn ? 'primary' : 'secondary'}`}
        onClick={handleToggle}
        title={health?.configured === false ? "Telegram not configured in .env" : (isTelegramOn ? "Notifications are ON" : "Notifications are OFF")}
        style={{
          background: !health?.configured ? 'rgba(100, 116, 139, 0.1)' : (isTelegramOn ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'),
          borderColor: !health?.configured ? '#64748b' : (isTelegramOn ? '#10b981' : '#f87171'),
          color: !health?.configured ? '#64748b' : (isTelegramOn ? '#10b981' : '#f87171'),
          minWidth: '85px',
          opacity: !health?.configured ? 0.5 : 1
        }}
        disabled={health?.configured === false}
      >
        {isTelegramOn ? '🔔 ON' : '🔕 OFF'}
      </button>
      <button
        className="btn-pro secondary"
        style={{ border: '1px solid #24A1DE', color: '#24A1DE' }}
        onClick={() => onCall('/api/v2/mrr/monitor/run', { method: 'POST', query: { client: mrrClient }, showModal: false })}
        title="Manually trigger heartbeat status for all active rentals"
      >
        Force Heartbeat
      </button>
      <button
        className="btn-pro secondary"
        onClick={() => sendTelegram(`⚡️ <b>Test Connection</b>\nTime: ${new Date().toLocaleTimeString()}\nClient: ${mrrClient}`, { showModal: true })}
      >
        Test Bot
      </button>
    </div>
  );
}
