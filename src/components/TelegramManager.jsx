import { useCallback, useMemo, useState, useEffect } from 'react';
import { calculateRemainingTime as sharedCalculateRemainingTime } from '../core/time';
import MonitorDbEditor from './MonitorDbEditor';

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

const divider = '━━━━━━━━━━━━━━━━━━━━━━';
const TelegramTemplates = {
  newRental: (account, r, paid, startStr, endStr) => `🚀 <b>[New Rental]</b>\n` +
    `<b>Account:</b> <code>${escapeHtml(account)}</code>\n` +
    `${divider}\n` +
    `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
    `<b>Algo:</b> <code>${escapeHtml(r.algo || r.rig?.type || 'N/A')}</code>\n` +
    `<b>Time:</b> ${startStr} - ${endStr}\n` +
    `${divider}\n` +
    `<b>Paid:</b> ${paid}\n` +
    `<i>Rental has been successfully initialized.</i>`,

  zeroHashrate: (account, r, elapsedMs, paid) => `🚨 <b>[Critical] Zero Hashrate!</b>\n` +
    `<b>Account:</b> <code>${escapeHtml(account)}</code>\n` +
    `${divider}\n` +
    `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
    `<b>Duration:</b> ${Math.round(elapsedMs / 1000)}s\n` +
    `<b>Efficiency:</b> <b>0%</b>\n` +
    `${divider}\n` +
    `<b>Paid:</b> ${paid}`,

  lowEfficiency: (account, r, avg, suffix, efficiency, remainingMs, paid) => `⚠️ <b>[Alert] Low Efficiency</b>\n` +
    `<b>Account:</b> <code>${escapeHtml(account)}</code>\n` +
    `${divider}\n` +
    `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
    `<b>Avg:</b> ${avg} ${suffix} (<b>${efficiency.toFixed(1)}%</b>)\n` +
    `<b>Left:</b> ${Math.round(remainingMs / 60000)}m\n` +
    `${divider}\n` +
    `<b>Paid:</b> ${paid}`,

  startup: (account, r, avg, suffix, efficiency, paid) => `🚀 <b>[Startup Alert]</b>\n` +
    `<b>Account:</b> <code>${escapeHtml(account)}</code>\n` +
    `${divider}\n` +
    `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
    `<b>Avg:</b> ${avg} ${suffix} (<b>${efficiency.toFixed(1)}%</b>)\n` +
    `${divider}\n` +
    `<b>Paid:</b> ${paid}`,

  completion: (account, r, avg, suffix, efficiency, paid) => `🏁 <b>[Completion Alert]</b>\n` +
    `<b>Account:</b><code>${escapeHtml(account)}</code>\n` +
    `${divider}\n` +
    `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
    `<b>Avg:</b> ${avg} ${suffix} (<b>${efficiency.toFixed(1)}%</b>)\n` +
    `${divider}\n` +
    `<b>Paid:</b> ${paid}`,

  systemStarted: (accts) =>
    `🤖 <b>System Started</b>\n` +
    `Time: ${new Date().toLocaleString()}\n` +
    `Monitoring: ${accts || 'None'}\n` +
    `Heartbeat Interval: 15m\n` +
    `Service is now active.`,

  rigStatusWarning: (acct, rig) =>
    `🟠 <b>RIG WARNING</b>\n` +
    `${divider}\n` +
    `🏢 <b><u>[<code>${escapeHtml(acct)}</code>]</u></b>\n` +
    `🖥 <b>${escapeHtml(rig.name)}</b>\n` +
    `🆔 <code>${rig.id}</code>\n` +
    `⚙️ <code>${escapeHtml(rig.algo || rig.type)}</code>\n` +
    `📡 <b>Status</b> <b>WARNING</b>\n` +
    `${divider}\n` +
    `⚠️ Connectivity issue detected.\n` +
    `Please verify miner, pool, network and local machine status.`,

  highWarningCount: (acct, count) =>
    `🚨 <b>MULTI-RIG ALERT</b>\n` +
    `${divider}\n` +
    `🏢 <b><u>[<code>${escapeHtml(acct)}</code>]</u></b>\n` +
    `📊 <b>Affected</b>  <b>${count}</b> rigs\n` +
    `${divider}\n` +
    `⚠️ Large number of rigs are reporting warnings.\n` +
    `Immediate investigation recommended.`,

  efficiency: (acct, r, info, efficiency, displayTarget) =>
    `🟠 <b>ALERT < 50% efficiency for more than 15 minutes</b>\n` +
    `${divider}\n` +
    `🏢 <b><u>[<code>${escapeHtml(acct)}</code>]</u></b>\n` +
    `🖥 ${escapeHtml(r.name || r.id)}\n` +
    `🆔<code>${r.id}</code>\n` +
    `⚙️<code>${escapeHtml(info.algo).toUpperCase()}</code>\n` +
    `${divider}\n` +
    `🎯 <b>Target</b>\n` +
    `<code>${displayTarget.toFixed(2)} ${info.hashrate.suffix}</code>\n\n` +
    `📉 <b>Efficiency</b>\n` +
    `<b>${efficiency.toFixed(1)}%</b>`,

  zeroHashrate: (acct, r, info) =>
    `🔴 <b>CRITICAL HASHRATE LOSS</b>\n` +
    `${divider}\n` +
    `🏢 <b><u>[<code>${escapeHtml(acct)}</code>]</u></b>\n` +
    `🖥  ${escapeHtml(r.name || r.id)}\n` +
    `🆔 <code>${r.id}</code>\n` +
    `⚙️ <code>${escapeHtml(info.algo).toUpperCase()}</code>\n` +
    `${divider}\n` +
    `💸 <b>Paid</b>\n` +
    `<code>${info.price?.paid || '0.00'} ${info.price?.currency || 'BTC'}</code>\n` +
    `${divider}\n` +
    `❌ Zero accepted hashrate detected for over 5 minutes.\n` +
    `Immediate action required.`,

  startup: (acct, r, info, efficiency, displayTarget) =>
    `🟠 <b> low efficiency first rental hour</b>\n` +
    `${divider}\n` +
    `🏢 <b><u>[<code>${escapeHtml(acct)}</code>]</u></b>` +
    `🖥 ${escapeHtml(r.name || r.id)}\n` +
    `🆔 <code>${r.id}</code>\n` +
    `⚙️ <code>${escapeHtml(info.algo).toUpperCase()}</code>\n` +
    `${divider}\n` +
    `📉 <b>Efficiency</b>` +
    `<b>${efficiency.toFixed(1)}%</b> | ` +
    `🎯 <b>Target</b>` +
    `<code>${displayTarget.toFixed(2)} ${info.hashrate.suffix}</code>\n\n` +
    `${divider}\n`,

  completionAlert: (acct, r, info, efficiency, displayTarget) =>
    `🟠 <b>FINAL HOUR ALERT</b>\n` +
    `${divider}\n` +
    `🏢 <b>Account</b> <b><u>[<code>${escapeHtml(acct)}</code>]</u></b>\n` +
    `🖥 <b>Rig</b>       ${escapeHtml(r.name || r.id)}\n` +
    `🆔 <b>ID</b>  <code>${r.id}</code>\n` +
    `⚙️  <code>${escapeHtml(info.algo).toUpperCase()}</code>\n` +
    `${divider}\n` +
    `🎯 <b>Target</b>\n` +
    `<code>${displayTarget.toFixed(2)} ${info.hashrate.suffix}</code>\n\n` +
    `📉 <b>Efficiency</b>\n` +
    `<b>${efficiency.toFixed(1)}%</b>\n` +
    `${divider}\n`,

  rentedNotice: (hbType, r, info, acct, roi, remStr) =>
    `🟢 <b>${escapeHtml(hbType).toUpperCase()}</b>\n` +
    `${divider}\n` +
    `🆔 ${escapeHtml(r.name || r.id)}\n` +
    `🏢 <b><u>[<code>${escapeHtml(acct).toUpperCase()}</code>]</u></b>\n` +
    `⚙️ <code>${escapeHtml(info.algo).toUpperCase()}</code>\n` +
    `${divider}\n` +
    `⚡ <b>Hashrate</b>\n` +
    `ADV : <code>${info.niceAdvertisedHashrate}</code>\n` +
    `AVG : <code>${info.niceAverageHashrate}</code>\n` +
    `CUR : <code>${info.niceHashrate}</code>\n\n` +
    `🎯 <b>Efficiency</b>\n` +
    `<b>${info.percent}%</b>\n\n` +
    // `${roi >= 0 ? '🟢' : '🔴'} <b>ROI</b>\n` +
    // `<b>${roi >= 0 ? '+' : ''}${roi}%</b>\n\n` +
    `⏳ <b>Remaining</b>\n` +
    `<code>${remStr}</code>\n\n` +
    `💸 <b>Paid</b>\n` +
    `<code>${info.price?.paid || '0.00'} ${info.price?.currency || 'BTC'}</code>\n` +
    `${divider}\n` +
    `🔗 <a href="https://www.miningrigrentals.com/rentals/view/${r.id}">Open Rental</a>`,

  finished: (fr, info) =>
    `🏁 <b>RENTAL COMPLETED</b>\n` +
    `${divider}\n` +
    `🏢<code>${escapeHtml(fr.client)}</code>\n` +
    `🖥 ${escapeHtml(fr.name || fr.id)}\n` +
    // `🆔<code>${fr.id}</code>\n` +
    `⚙️<code>${escapeHtml(info?.algo || fr.algo || '')}</code>\n` +
    `${divider}\n` +
    `⚡ <b>Hashrate (avg / cur)</b>\n` +
    `<code>${info?.niceAverageHashrate || 'N/A'} / ${info?.niceHashrate || 'N/A'}</code>\n` +
    `\n` +
    `🎯 <b>Efficiency</b>\n` +
    `<b>${typeof info?.percent !== 'undefined' ? info.percent + '%' : 'N/A'}</b>\n` +
    `\n` +
    `💸 <b>Paid</b>\n` +
    `<code>${info?.price?.paid || fr.price || '0.00'} ${info?.price?.currency || fr.currency || 'BTC'}</code>\n` +
    `${divider}\n`,
  
  heartbeatSummary: (barChart, onlineAll, rentedAll, offlineAll, disabledAll, totalAll, activeRentalLines, monitorTime) =>
    `📊 <b>[Summary]</b>\n` +
    `<b>Online</b> <code>${String(onlineAll).padStart(4)}</code> ` +
    `(<b>Offline</b> <code>${String(offlineAll).padStart(4)}</code>)\n` +
    `<b>Total</b>   <code>${String(totalAll).padStart(4)}</code> ` +
    `(<b>Disabled</b> <code>${String(disabledAll).padStart(4)}</code>)\n` +
    `♻️ <b>Rented</b> <code>${String(rentedAll).padStart(4)}</code>\n` +
    `${barChart ? `${barChart}\n` : ''}` +
    `${divider}\n` +
    `<b>Active Rentals:</b>\n` +
    `${divider}\n` +
    `${activeRentalLines.length > 0 ? activeRentalLines.join('\n') : '<i>No active rentals</i>'}\n` +
    `<i>Update at ${monitorTime}</i>`,

  manualNotice: (r, account, avg, suffix, roi, remStr, progress, paid) => `✅ <b>[NEW RENTAL] ✅ #${r.id}</b>\n` +
    `${divider}\n` +
    `<b>Algo:</b> <code>${escapeHtml(r.rig?.type || r.algo || 'N/A').toUpperCase()}</code>\n` +
    `<b>Acct:</b> <code>${escapeHtml(account).toUpperCase()}</code>\n` +
    `${divider}\n` +
    `<b>Hash:</b> <code>${avg.toFixed(2)} ${suffix}</code>\n` +
    `${roi >= 0 ? '🟢' : '🔴'} <b>ROI:</b> <code>${roi >= 0 ? '+' : ''}${roi}%</code>\n` +
    `<b>Time:</b> <code>${remStr} left (${progress}%)</code>\n` +
    `<b>Paid:</b> <code>${paid}</code>\n` +
    `${divider}\n` +
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

  const Manager = {
    CONFIG: {
      ALERT_COOLDOWN_MS: 3600000,
      WARNING_RIG_THRESHOLD: 3,
      RENTED_HEARTBEAT_MS: 1800000,
    },
    Templates: TelegramTemplates,
  };
  const { sendTelegram } = useTelegram(onCall, mrrClient);
  const [isMonitorDbOpen, setIsMonitorDbOpen] = useState(false);
  const [isTelegramOn, setIsTelegramOn] = useState(true);
  const [health, setHealth] = useState(null);

  const previewTestMessage = `⚡️ Test Connection\nTime: ${new Date().toLocaleTimeString()}\nClient: ${mrrClient}`;
  const isConfigured = health?.configured !== false;
  const statusLabel = health?.configured === false ? 'Missing Telegram credentials' : (isTelegramOn ? 'Notifications enabled' : 'Notifications disabled');

  // Fetch current notification status from server on mount
  useEffect(() => {
    onCall('/api/v2/notify/telegram/status', { method: 'GET', silent: true })
      .then(res => {
        if (res && typeof res.enabled === 'boolean') setIsTelegramOn(res.enabled);
      })
      .catch(() => { });

    onCall('/api/v2/notify/telegram/health', { method: 'GET', silent: true })
      .then(res => {
        setHealth(res);
      })
      .catch(() => { });
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
    <div style={{
      display: 'grid',
      gap: '10px',
      minWidth: '300px',
      padding: '14px',
      borderRadius: '14px',
      border: '1px solid rgba(148, 163, 184, 0.15)',
      background: 'rgba(15, 23, 42, 0.8)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '4px' }}>Telegram Notifications</div>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>{statusLabel}</div>
        </div>
        <button
          className={`btn-pro ${isTelegramOn ? 'primary' : 'secondary'}`}
          onClick={handleToggle}
          title={health?.configured === false ? 'Telegram not configured in .env' : (isTelegramOn ? 'Notifications are ON' : 'Notifications are OFF')}
          style={{
            background: !isConfigured ? 'rgba(100, 116, 139, 0.1)' : (isTelegramOn ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.12)'),
            borderColor: !isConfigured ? '#64748b' : (isTelegramOn ? '#10b981' : '#f87171'),
            color: !isConfigured ? '#64748b' : (isTelegramOn ? '#10b981' : '#f87171'),
            minWidth: '95px',
            opacity: !isConfigured ? 0.55 : 1,
          }}
          disabled={!isConfigured}
        >
          {isTelegramOn ? '🔔 ON' : '🔕 OFF'}
        </button>
      </div>
      <div style={{ display: 'grid', gap: '6px', fontSize: '12px', opacity: 0.8 }}>
        <div><b>Configured:</b> {health?.tokenPresent ? 'Bot token OK' : 'Missing token'} · {health?.chatIdPresent ? 'Chat ID OK' : 'Missing chat ID'}</div>
        <div>Notifications are sent for: <b>new rental</b>, <b>rental completion</b>, <b>low efficiency</b>, <b>zero hashrate</b>, and <b>end-of-rental</b> summaries.</div>
      </div>

      <MonitorDbEditor isOpen={isMonitorDbOpen} onClose={() => setIsMonitorDbOpen(false)} onCall={onCall} />
    </div>
  );
}
