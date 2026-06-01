import { useCallback, useMemo } from 'react';
import { calculateRemainingTime as sharedCalculateRemainingTime } from '../core/time';

export function calculateRemainingTime(endTime) {
  if (!endTime) return null;
  return sharedCalculateRemainingTime(endTime);
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
    const account = r.mrrClient || mrrClient;
    const msg = `?? <b>[Critical] Zero Hashrate!</b>\n\n` +
      `<b>Rig:</b> ${r.name || r.id}\n` +
      `<b>Started:</b> ${Math.round(elapsedMs / 1000)}s ago\n` +
      `<b>Current Hash:</b> 0\n` +
      `<b>Account:</b> ${account}`;
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyLowEfficiency = useCallback((r, remainingMs, efficiency) => {
    const account = r.mrrClient || mrrClient;
    const msg = `?? <b>[Alert] Low Efficiency</b>\n\n` +
      `<b>Rig:</b> ${r.name || r.id}\n` +
      `<b>Remaining:</b> ${Math.round(remainingMs / 60000)}m\n` +
      `<b>Efficiency:</b> ${efficiency}%\n` +
      `<b>Account:</b> ${account}`;
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyStartupEfficiencyAlert = useCallback((r, efficiency) => {
    const account = r.mrrClient || mrrClient;
    const msg = `?? <b>[Startup Alert: ${account}]</b>\n\n` +
      `Rig <b>${r.name || r.id}</b> startup efficiency is low!\n` +
      `Efficiency: <b>${efficiency}%</b> (< 70% in first hour)\n` +
      `Account: ${account}`;
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyCompletionEfficiencyAlert = useCallback((r, efficiency) => {
    const account = r.mrrClient || mrrClient;
    const msg = `?? <b>[Completion Alert: ${account}]</b>\n\n` +
      `Rig <b>${r.name || r.id}</b> efficiency is low near the end!\n` +
      `Efficiency: <b>${efficiency}%</b> (< 70% with < 1h remaining)\n` +
      `Account: ${account}`;
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const sendManualNotice = useCallback((r, target) => {
    const remainingStr = calculateRemainingTime(r.end);
    const avg = parseFloat(r.hashrate?.average?.hash || r.hashrate?.average || 0);
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const account = r.mrrClient || mrrClient;
    const msg = `?? <b>[Notice] Hash Completion</b>\n\n` +
      `<b>Rig:</b> ${r.name || r.id}\n` +
      `<b>Algo:</b> ${r.rig?.type || r.algo || 'N/A'}\n` +
      `<b>Current Avg:</b> ${avg.toFixed(2)} ${suffix}\n` +
      `<b>Efficiency:</b> ${r.hashrate?.average?.percent || r.percent || '0'}%\n` +
      `<b>Remaining:</b> ${remainingStr}\n` +
      `<b>Target to 100%:</b> ${target.toFixed(2)} ${suffix}\n` +
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

  return (
    <div style={{ display: 'contents' }}>
      <button
        className="btn-pro secondary"
        style={{ border: '1px solid #5472d3', color: '#5472d3' }}
        onClick={() => onCall('/api/v2/mrr/monitor/snapshot', { showModal: true })}
        title="View the target hashrate data stored in the server database"
      >
        Monitor DB
      </button>
      <button
        className="btn-pro secondary"
        style={{ border: '1px solid #24A1DE', color: '#24A1DE' }}
        onClick={() => onCall('/api/v2/mrr/monitor/run', { method: 'POST', query: { client: mrrClient }, showModal: true })}
        title="Manually trigger heartbeat status for all active rentals"
      >
        Force Heartbeat
      </button>
      <button
        className="btn-pro secondary"
        onClick={() => sendTelegram(`?? <b>Test Connection</b>\nTime: ${new Date().toLocaleTimeString()}\nClient: ${mrrClient}`, { showModal: true })}
      >
        Test Bot
      </button>
    </div>
  );
}
