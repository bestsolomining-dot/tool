import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from './poolUtils';

/**
 * HashpowerBot Component
 * 
 * Automates interactions with the NiceHash Hashpower Market.
 * Monitors market prices and provides a foundation for automated ordering.
 */
export default function HashpowerBot({ algorithm, market }) {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [marketData, setMarketData] = useState(null);
  const [config, setConfig] = useState({
    checkInterval: 60000, // 1 minute
    maxPrice: '0.0100',
  });
  
  const timerRef = useRef(null);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] [${type.toUpperCase()}] ${message}`, ...prev].slice(0, 100));
  };

  const runIteration = async () => {
    addLog(`Checking market for ${algorithm} (${market})...`);
    
    try {
      const path = `/api/v2/hashpower/order-book?algorithm=${algorithm}&market=${market}`;
      const result = await apiFetch(path);

      if (result.ok) {
        setMarketData(result.data);
        // The API structure varies, we attempt to find stats in common locations
        const stats = result.data?.stats?.[market] || result.data?.stats || {};
        addLog(`Market check successful. Orders: ${stats.ordersCount || 0}, Min Price: ${stats.minimalPrice || 'N/A'}`);
        
        if (stats.minimalPrice && parseFloat(stats.minimalPrice) <= parseFloat(config.maxPrice)) {
           addLog('Threshold condition met: Price is below maximum limit.', 'success');
        }
      } else {
        addLog(`Failed to fetch market data: ${result.status}`, 'error');
      }
    } catch (err) {
      addLog(`Bot Error: ${err.message}`, 'error');
    }
  };

  useEffect(() => {
    if (isRunning) {
      runIteration();
      timerRef.current = setInterval(runIteration, config.checkInterval);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        addLog('Bot process stopped.');
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning, algorithm, market, config.checkInterval]);

  return (
    <div className="bot-panel" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem', marginTop: '1.5rem' }}>
      <div className="panel-header" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Hashpower Automator</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`status-dot ${isRunning ? 'active' : ''}`} style={{ width: '8px', height: '8px', borderRadius: '50%', background: isRunning ? '#10b981' : '#64748b' }} />
          <small style={{ fontWeight: 'bold', opacity: 0.8 }}>{isRunning ? 'RUNNING' : 'IDLE'}</small>
        </div>
      </div>

      <div className="field-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div className="field">
          <label className="label">Max Price Threshold</label>
          <input 
            className="input-pro" 
            type="number" 
            step="0.0001"
            value={config.maxPrice} 
            onChange={e => setConfig(prev => ({ ...prev, maxPrice: e.target.value }))}
            disabled={isRunning}
          />
        </div>
        <div className="field">
          <label className="label">Check Interval (ms)</label>
          <input 
            className="input-pro" 
            type="number" 
            step="5000"
            value={config.checkInterval} 
            onChange={e => setConfig(prev => ({ ...prev, checkInterval: parseInt(e.target.value) || 60000 }))}
            disabled={isRunning}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <button 
          className={`btn-pro ${isRunning ? 'secondary' : 'primary'}`} 
          onClick={() => setIsRunning(!isRunning)}
          style={{ flex: 1 }}
        >
          {isRunning ? 'Stop Bot' : 'Start Bot'}
        </button>
        <button className="btn-pro secondary" onClick={() => setLogs([])}>Clear Logs</button>
      </div>

      <div className="log-viewer">
        <label className="label">Activity Logs</label>
        <div 
          className="code-block-content" 
          style={{ 
            height: '160px', 
            overflowY: 'auto', 
            fontSize: '11px', 
            background: 'rgba(0,0,0,0.2)',
            padding: '10px',
            borderRadius: '4px',
            border: '1px solid rgba(255,255,255,0.05)'
          }}
        >
          {logs.length === 0 ? (
            <span style={{ opacity: 0.4 }}>Bot inactive. Press start to begin.</span>
          ) : (
            logs.map((log, i) => (
              <div key={i} style={{ 
                fontFamily: 'monospace', 
                marginBottom: '4px',
                color: log.includes('[ERROR]') ? '#f87171' : log.includes('[SUCCESS]') ? '#34d399' : '#94a3b8'
              }}>
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}