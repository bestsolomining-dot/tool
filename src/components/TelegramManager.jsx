import React, { useCallback, useMemo } from 'react';

/**
 * Safely calculates remaining time for display or notifications.
 */
export function calculateRemainingTime(endTime) {
  if (!endTime) return null;
  const normalizedEndTime = /\bUTC\b/i.test(String(endTime)) ? String(endTime) : `${endTime} UTC`;
  const end = new Date(normalizedEndTime);
  if (Number.isNaN(end.getTime())) return 'Expired';
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();

  if (diffMs <= 0) return 'Expired';

  const diffSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(diffSeconds / (3600 * 24));
  const hours = Math.floor((diffSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;

  let parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

/**
 * Hook to construct and send Telegram messages from the frontend.
 */
export function useTelegram(onCall, mrrClient) {
  const sendTelegram = useCallback((message, options = {}) => {
    return onCall('/api/v2/notify/telegram', {
      method: 'POST',
      body: { message },
      ...options
    });
  }, [onCall]);

  const notifyNewRental = useCallback((fresh) => {
    const account = fresh.mrrClient || mrrClient;
    const msg = `🚀 <b>[New Rental]</b>\n\n` +
                `<b>Rig:</b> ${fresh.name || fresh.id}\n` +
                `<b>Algo:</b> ${fresh.algo || 'N/A'}\n` +
                `<b>Duration:</b> ${fresh.hours}h\n` +
                `<b>Account:</b> ${account}`;
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyZeroHashrate = useCallback((r, elapsedMs) => {
    const account = r.mrrClient || mrrClient;
    const msg = `⚠️ <b>[Critical] Zero Hashrate!</b>\n\n` +
                `<b>Rig:</b> ${r.name || r.id}\n` +
                `<b>Started:</b> ${Math.round(elapsedMs/1000)}s ago\n` +
                `<b>Current Hash:</b> 0\n` +
                `<b>Account:</b> ${account}`;
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyHashrateDrop = useCallback((r) => {
    const account = r.mrrClient || mrrClient;
    const msg = `🛑 <b>[Alert] Hashrate Drop (15m)</b>\n\n` +
                `<b>Rig:</b> ${r.name || r.id}\n` +
                `<b>Avg (15m):</b> 0\n` +
                `<b>Account:</b> ${account}`;
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const notifyLowEfficiency = useCallback((r, remainingMs, efficiency) => {
    const account = r.mrrClient || mrrClient;
    const msg = `📉 <b>[Alert] Low Efficiency</b>\n\n` +
                `<b>Rig:</b> ${r.name || r.id}\n` +
                `<b>Remaining:</b> ${Math.round(remainingMs/60000)}m\n` +
                `<b>Efficiency:</b> ${efficiency}%\n` +
                `<b>Account:</b> ${account}`;
    return sendTelegram(msg, { silent: true });
  }, [sendTelegram, mrrClient]);

  const sendManualNotice = useCallback((r, target) => {
    const remainingStr = calculateRemainingTime(r.end);
    const avg = parseFloat(r.hashrate?.average?.hash || r.hashrate?.average || 0);
    const suffix = r.hashrate?.suffix || r.hashrate?.advertised?.type || '';
    const account = r.mrrClient || mrrClient;
    const msg = `📢 <b>[Notice] Hash Completion</b>\n\n` +
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
    notifyNewRental, 
    notifyZeroHashrate, 
    notifyHashrateDrop, 
    notifyLowEfficiency, 
    sendManualNotice 
  }), [sendTelegram, notifyNewRental, notifyZeroHashrate, notifyHashrateDrop, notifyLowEfficiency, sendManualNotice]);
}

/**
 * Component to manage Telegram notifications, monitor status, and connection tests.
 */
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
        onClick={() => onCall('/api/v2/mrr/monitor/run', { method: 'POST', showModal: true })}
        title="Manually trigger heartbeat status for all active rentals"
      >
        Force Heartbeat
      </button>
      <button 
        className="btn-pro secondary" 
        onClick={() => sendTelegram(`🔔 <b>Test Connection</b>\nTime: ${new Date().toLocaleTimeString()}\nClient: ${mrrClient}`, { showModal: true })}
      >
        Test Bot
      </button>
    </div>
  );
}