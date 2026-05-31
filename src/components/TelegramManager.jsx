import React from 'react';

/**
 * Component to manage Telegram notifications, monitor status, and connection tests.
 */
export default function TelegramManager({ onCall, mrrClient }) {
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
        onClick={() => onCall('/api/v2/notify/telegram', { 
          method: 'POST', 
          body: { message: `🔔 <b>Test Connection</b>\nTime: ${new Date().toLocaleTimeString()}\nClient: ${mrrClient}` }, 
          showModal: true 
        })}
      >
        Test Bot
      </button>
    </div>
  );
}