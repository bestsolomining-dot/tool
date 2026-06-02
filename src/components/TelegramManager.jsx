import { useCallback, useMemo, useState } from 'react';
import { calculateRemainingTime as sharedCalculateRemainingTime } from '../core/time';
import MonitorDbEditor from './MonitorDbEditor';

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

export function useTelegram(onCall, mrrClient) {
  const sendTelegram = useCallback((message, options = {}) => {
    return onCall('/api/v2/notify/telegram', {
      method: 'POST',
      body: { message },
      ...options
    });
  }, [onCall]);

  const notifyZeroHashrate = useCallback((r, elapsedMs) => {
    const account = getTelegramAccount(r, mrrClient);
    const paid = getPaidAmount(r);
    const msg = `🚨 <b>[Critical] Zero Hashrate!</b>\n\n` +
      `<b>Rig:</b> ${r.name || r.id}\n` +
      `<b>Account:</b> ${account}\n` +
      `<b>Started:</b> ${Math.round(elapsedMs / 1000)}s ago\n` +
      `<b>AVG Hashrate:</b> 0\n` +
      `<b>Effect:</b> 0%\n` +
      `<b>Time:</b> ${r.start} - ${r.end}\n` +
      `<b>Paid:</b> ${paid}`;
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyLowEfficiency = useCallback((r, remainingMs, efficiency) => {
    const account = getTelegramAccount(r, mrrClient);
    const avg = parseFloat(r.hashrate?.average?.hash || r.hashrate?.average || 0).toFixed(2);
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const paid = getPaidAmount(r);
    const msg = `⚠️ <b>[Alert] Low Efficiency</b>\n\n` +
      `<b>Rig:</b> ${r.name || r.id}\n` +
      `<b>Account:</b> ${account}\n` +
      `<b>Remaining:</b> ${Math.round(remainingMs / 60000)}m\n` +
      `<b>AVG Hashrate:</b> ${avg} ${suffix}\n` +
      `<b>Effect:</b> ${efficiency}%\n` +
      `<b>Time:</b> ${r.start} - ${r.end}\n` +
      `<b>Paid:</b> ${paid}`;
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyStartupEfficiencyAlert = useCallback((r, efficiency) => {
    const account = getTelegramAccount(r, mrrClient);
    const avg = parseFloat(r.hashrate?.average?.hash || r.hashrate?.average || 0).toFixed(2);
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const paid = getPaidAmount(r);
    const msg = `🚀 <b>[Startup Alert: ${account}]</b>\n\n` +
      `Rig <b>${r.name || r.id}</b> startup efficiency is low!\n` +
      `<b>AVG Hashrate:</b> ${avg} ${suffix}\n` +
      `<b>Effect:</b> ${efficiency}% (< 70% in first hour)\n` +
      `<b>Time:</b> ${r.start} - ${r.end}\n` +
      `<b>Paid:</b> ${paid}`;
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyCompletionEfficiencyAlert = useCallback((r, efficiency) => {
    const account = getTelegramAccount(r, mrrClient);
    const avg = parseFloat(r.hashrate?.average?.hash || r.hashrate?.average || 0).toFixed(2);
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const paid = getPaidAmount(r);
    const msg = `🏁 <b>[Completion Alert: ${account}]</b>\n\n` +
      `Rig <b>${r.name || r.id}</b> efficiency is low near the end!\n` +
      `<b>AVG Hashrate:</b> ${avg} ${suffix}\n` +
      `<b>Effect:</b> ${efficiency}% (< 70% with < 1h left)\n` +
      `<b>Time:</b> ${r.start} - ${r.end}\n` +
      `<b>Paid:</b> ${paid}`;
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const sendManualNotice = useCallback((r, target) => {
    const remainingStr = calculateRemainingTime(r.end || r.normalized?.endTime);
    const avg = parseFloat(r.hashrate?.average?.hash || r.hashrate?.average || 0);
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const account = getTelegramAccount(r, mrrClient);
    const efficiency = parseFloat(r.hashrate?.average?.percent || r.percent || 0);
    const perfEmoji = efficiency >= 98 ? '🟢' : (efficiency >= 90 ? '🟡' : '🔴');
    const msg = `📬 <b>[Notice] Hash Completion</b>\n\n` +
      `<b>Rig:</b> ${r.name || r.id}\n` +
      `<b>Algo:</b> ${r.rig?.type || r.algo || 'N/A'}\n` +
      `<b>AVG Hashrate:</b> ${perfEmoji} ${avg.toFixed(2)} ${suffix} (<b>${efficiency}%</b>)\n` +
      `<b>Time:</b> ${r.start} - ${r.end}\n` +
      `<b>Paid:</b> ${getPaidAmount(r)}\n` +
      `<b>Remaining:</b> ${remainingStr}\n` +
      `<b>Target to 100%:</b> ${parseFloat(target || 0).toFixed(2)} ${suffix}\n` +
      `<b>Account:</b> ${account}`;
    return sendTelegram(msg, { showModal: true });
  }, [sendTelegram, mrrClient]);

  return useMemo(() => ({
    sendTelegram,
    notifyZeroHashrate,
    notifyLowEfficiency,
    notifyStartupEfficiencyAlert,
    notifyCompletionEfficiencyAlert,
    sendManualNotice
  }), [sendTelegram, notifyZeroHashrate, notifyLowEfficiency, notifyStartupEfficiencyAlert, notifyCompletionEfficiencyAlert, sendManualNotice]);
}

export default function TelegramManager({ onCall, mrrClient }) {
  const { sendTelegram } = useTelegram(onCall, mrrClient);
  const [isMonitorDbOpen, setIsMonitorDbOpen] = useState(false);

  return (
    <div style={{ display: 'contents' }}>
      <button
        className="btn-pro secondary"
        style={{ border: '1px solid #5472d3', color: '#5472d3' }}
        onClick={() => setIsMonitorDbOpen(true)}
        title="Open the interactive monitoring database editor"
      >
        Monitor DB
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

      <MonitorDbEditor 
        isOpen={isMonitorDbOpen} 
        onClose={() => setIsMonitorDbOpen(false)} 
        onCall={onCall} 
      />
    </div>
  );
}
