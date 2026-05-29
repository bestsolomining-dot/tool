import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../core/poolUtils';

/**
 * HashpowerBot Component
 * 
 * Automates interactions with the NiceHash Hashpower Market.
 * Monitors market prices and provides a foundation for automated ordering.
 */
export default function HashpowerBot({ algorithm, market, onCall, nhClient = 'BT', setNhClient }) {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [marketData, setMarketData] = useState(null);
  const [config, setConfig] = useState({
    checkInterval: 60000, // 1 minute
    maxPrice: '0.0100',
    stepDown: '0.0001',
    limit: '0.00',
  });
  
  const timerRef = useRef(null);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] [${type.toUpperCase()}] ${message}`, ...prev].slice(0, 100));
  };

  const runIteration = async () => {
    addLog(`Checking market for ${algorithm} (${market})...`);
    
    try {
      // 1. Get my active orders to find the one we are managing
      const ordersData = await onCall('/api/v2/hashpower/myOrders', {
        query: { 
          op: 'LE', 
          ts: Date.now(), 
          active: true,
          limit: 1000,
          client: nhClient
        },
        silent: true
      });

      if (ordersData?.error || ordersData?.message) {
        const errorMsg = ordersData.error || ordersData.message;
        addLog(`API Error (Orders): ${typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg)}`, 'error');
        return;
      }

      const activeOrders = ordersData?.list || [];
      const myOrder = activeOrders.find(o => {
        const oAlgo = typeof o.algorithm === 'object' ? o.algorithm.algorithm : o.algorithm;
        const oMarket = typeof o.market === 'object' ? o.market.id || o.market.name : o.market;
        
        return String(oAlgo || '').toUpperCase() === algorithm.toUpperCase() && 
               String(oMarket || '').toUpperCase() === market.toUpperCase() &&
               (o.status?.code === 'ACTIVE' || o.status === 'ACTIVE');
      });

      if (!myOrder) {
        addLog(`No active order found for ${algorithm} (${market}). Check "My Orders" first.`, 'warn');
        return;
      }

      // 2. Get order book for the specific algorithm and market
      const bookData = await onCall('/api/v2/hashpower/order-book', {
        query: { algorithm, market, client: nhClient },
        silent: true
      });

      if (bookData?.error || bookData?.message) {
        const errorMsg = bookData.error || bookData.message;
        addLog(`API Error (OrderBook): ${typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg)}`, 'error');
        return;
      }

      const book = (bookData?.list || bookData?.[0]?.list || []).filter(o => o.type === 'STANDARD');
      
      // 3. Compare and Adjust
      const myPrice = parseFloat(myOrder.price);
      const mySpeed = parseFloat(myOrder.acceptedCurrentSpeed);
      const myLimit = parseFloat(config.limit) > 0 ? parseFloat(config.limit) : parseFloat(myOrder.limit);
      const maxPriceThreshold = parseFloat(config.maxPrice) || 0;
      const stepDownDelta = parseFloat(config.stepDown) || 0;
      const minDelta = 0.0001; // Minimal increment to be above competitor

      // Find highest competitor price that is not ours
      const competitors = book.filter(o => o.id !== myOrder.id);
      const highestCompPrice = competitors.length > 0 ? parseFloat(competitors[0].price) : 0;
      const optimalPrice = highestCompPrice + minDelta;

      let nextPrice = myPrice;

      if (mySpeed >= myLimit * 0.95) {
        // We are at speed. Check if we can lower the price.
        if (myPrice > optimalPrice) {
          nextPrice = Math.max(myPrice - stepDownDelta, optimalPrice);
          addLog(`?adjust price?; order ${myOrder.id}, speed ${mySpeed.toFixed(8)}, rigs ${myOrder.rigsCount}, price ${myPrice.toFixed(8)}, step_down -${stepDownDelta.toFixed(4)}`, 'success');
        } else {
          addLog(`[STABLE] Speed OK (${mySpeed.toFixed(5)}). Price is optimal at ${myPrice.toFixed(8)}`);
        }
      } else {
        // Speed is low. Check if we need to increase price.
        if (optimalPrice > myPrice) {
          nextPrice = Math.min(optimalPrice, maxPriceThreshold);
          addLog(`?adjust price?; order ${myOrder.id}, speed ${mySpeed.toFixed(8)}, rigs ${myOrder.rigsCount}, price ${myPrice.toFixed(4)}, step_up ${nextPrice.toFixed(4)}`, 'warn');
        } else {
          addLog(`[WAIT] Already at top of book (${myPrice.toFixed(4)}), waiting for available rigs.`);
        }
      }

      // 4. Update the order if price has changed
      const targetLimit = parseFloat(config.limit) > 0 ? config.limit : myOrder.limit;
      const priceChanged = Math.abs(nextPrice - myPrice) > 0.00001;
      const limitChanged = parseFloat(config.limit) > 0 && Math.abs(parseFloat(config.limit) - parseFloat(myOrder.limit)) > 0.001;

      if (priceChanged || limitChanged) {
        await onCall(`/api/v2/hashpower/order/${myOrder.id}/update`, {
          method: 'POST',
          query: { client: nhClient },
          body: { price: nextPrice.toFixed(8), limit: targetLimit },
          silent: true
        });
      }

      addLog(`Cycle complete. Managed Order: ${myOrder.id.slice(0,8)}...`);

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
  }, [isRunning, algorithm, market, config.checkInterval, onCall, nhClient]);

  return (
    <div className="bot-panel" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem', marginTop: '1.5rem' }}>
      <div className="panel-header" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Hashpower Automator</h3>
        {setNhClient && (
          <div className="market-inputs" style={{ marginBottom: 0 }}>
            <select className="select-pro" value={nhClient} onChange={(e) => setNhClient(e.target.value)} disabled={isRunning}>
              <option value="BT">BT Account</option>
              <option value="PH">PH Account</option>
            </select>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`status-dot ${isRunning ? 'active' : ''}`} style={{ width: '8px', height: '8px', borderRadius: '50%', background: isRunning ? '#10b981' : '#64748b' }} />
          <small style={{ fontWeight: 'bold', opacity: 0.8 }}>{isRunning ? 'RUNNING' : 'IDLE'}</small>
        </div>
      </div>

      <div className="field-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <div className="field">
          <label className="label">Price Threshold</label>
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
          <label className="label">Step Down Delta</label>
          <input 
            className="input-pro" 
            type="number" 
            step="0.0001"
            value={config.stepDown} 
            onChange={e => setConfig(prev => ({ ...prev, stepDown: e.target.value }))}
            disabled={isRunning}
          />
        </div>
        <div className="field">
          <label className="label">Speed Limit</label>
          <input 
            className="input-pro" 
            type="number" 
            step="0.01"
            value={config.limit} 
            onChange={e => setConfig(prev => ({ ...prev, limit: e.target.value }))}
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