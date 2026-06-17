import { useCallback, useMemo, useState, useEffect } from 'react';
import { calculateRemainingTime as sharedCalculateRemainingTime } from '../core/time';
import MonitorDbEditor from './MonitorDbEditor';
import { escapeHtml, TelegramTemplates } from '../core/telegram.js'; // Import from shared

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
    const rawAvg = r.hashrate?.average?.hash || r.hashrate?.average || 0;
    const avg = Number.isFinite(parseFloat(rawAvg)) ? parseFloat(rawAvg).toFixed(2) : '0.00';
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const paid = getPaidAmount(r);
    const msg = TelegramTemplates.lowEfficiency(account, r, avg, suffix, efficiency, remainingMs, paid);
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyPerfectEfficiency = useCallback((r, efficiency) => {
    const account = getTelegramAccount(r, mrrClient);
    const rawEfficiency = efficiency || 0;
    const efficiencyVal = Number.isFinite(parseFloat(rawEfficiency)) ? parseFloat(rawEfficiency) : 0;
    const paid = getPaidAmount(r);
    const remainingMs = r.end ? (new Date(r.end + (String(r.end).endsWith('UTC') ? '' : ' UTC')).getTime() - Date.now()) : 0;
    const msg = TelegramTemplates.perfectEfficiency(account, r, efficiencyVal, paid, remainingMs);
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyStartupEfficiencyAlert = useCallback((r, efficiency) => {
    const account = getTelegramAccount(r, mrrClient);
    const rawAvg = r.hashrate?.average?.hash || r.hashrate?.average || 0;
    const avg = Number.isFinite(parseFloat(rawAvg)) ? parseFloat(rawAvg).toFixed(2) : '0.00';
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const paid = getPaidAmount(r);
    const msg = TelegramTemplates.startup(account, r, avg, suffix, efficiency, paid);
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyCompletionEfficiencyAlert = useCallback((r, efficiency) => {
    const account = getTelegramAccount(r, mrrClient);
    const rawAvg = r.hashrate?.average?.hash || r.hashrate?.average || 0;
    const avg = Number.isFinite(parseFloat(rawAvg)) ? parseFloat(rawAvg).toFixed(2) : '0.00';
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const paid = getPaidAmount(r);
    const msg = TelegramTemplates.completion(account, r, avg, suffix, efficiency, paid);
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyCompletionSuccess = useCallback((r, efficiency) => {
    const account = getTelegramAccount(r, mrrClient);
    const rawAvg = r.hashrate?.average?.hash || r.hashrate?.average || 0;
    const avg = Number.isFinite(parseFloat(rawAvg)) ? parseFloat(rawAvg).toFixed(2) : '0.00';
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const paid = getPaidAmount(r);
    const msg = TelegramTemplates.completionSuccess(account, r, avg, suffix, efficiency, paid);
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyHeartbeatSummary = useCallback((summaryData) => {
    const msg = TelegramTemplates.heartbeatSummary(summaryData);
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram]);

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

    const rawEfficiency = r.hashrate?.average?.percent || r.percent || 0;
    const efficiency = Number.isFinite(parseFloat(rawEfficiency)) ? parseFloat(rawEfficiency) : 0;

    const account = getTelegramAccount(r, mrrClient);
    const rawRoi = efficiency - 100;
    const roi = Number.isFinite(rawRoi) ? rawRoi.toFixed(1) : '0.0';
    const progress = totalMs > 0 ? Math.floor((elapsedMs / totalMs) * 100) : 0;
    const avg = Number.isFinite(parseFloat(r.hashrate?.average?.hash || r.hashrate?.average || 0)) ? parseFloat(r.hashrate?.average?.hash || r.hashrate?.average || 0) : 0;
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
    notifyCompletionSuccess,
    notifyPerfectEfficiency,
    notifyHeartbeatSummary,
    sendManualNotice
  }), [sendTelegram, notifyNewRental, notifyZeroHashrate, notifyLowEfficiency, notifyStartupEfficiencyAlert, notifyCompletionEfficiencyAlert, notifyCompletionSuccess, notifyPerfectEfficiency, notifyHeartbeatSummary, sendManualNotice]);
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
  const [isToggling, setIsToggling] = useState(false);
  const [health, setHealth] = useState(null);

  const previewTestMessage = `⚡️ Test Connection\nTime: ${new Date().toLocaleTimeString()}\nClient: ${mrrClient}`;
  const isConfigured = health?.configured !== false;
  const statusLabel = health?.configured === false ? 'Missing Telegram credentials' : (isTelegramOn ? 'Notifications enabled' : 'Notifications disabled');

  // Fetch current notification status from server on mount
  useEffect(() => {
    let isMounted = true;

    onCall('/api/v2/notify/telegram/status', { method: 'GET', silent: true })
      .then(res => {
        if (isMounted && res && typeof res.enabled === 'boolean') setIsTelegramOn(res.enabled);
      })
      .catch(() => { });

    onCall('/api/v2/notify/telegram/health', { method: 'GET', silent: true })
      .then(res => {
        if (isMounted) setHealth(res);
      })
      .catch(() => { });

    return () => {
      isMounted = false;
    };
  }, [onCall]);

  const handleToggle = async () => {
    if (isToggling) return;
    setIsToggling(true);

    const target = !isTelegramOn;
    try {
      const res = await onCall('/api/v2/notify/telegram/status', {
        method: 'POST',
        body: { enabled: target },
        silent: true
      });
      if (res && typeof res.enabled === 'boolean') {
        setIsTelegramOn(res.enabled);
      }
    } catch (err) {
      console.error('Telegram toggle failed:', err);
    } finally {
      setIsToggling(false);
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
            background: !isConfigured || isToggling ? 'rgba(100, 116, 139, 0.1)' : (isTelegramOn ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.12)'),
            borderColor: !isConfigured || isToggling ? '#64748b' : (isTelegramOn ? '#10b981' : '#f87171'),
            color: !isConfigured || isToggling ? '#64748b' : (isTelegramOn ? '#10b981' : '#f87171'),
            minWidth: '95px',
            opacity: !isConfigured || isToggling ? 0.55 : 1,
          }}
          disabled={!isConfigured || isToggling}
        >
          {isToggling ? '⏳ ...' : (isTelegramOn ? '🔔 ON' : '🔕 OFF')}
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
