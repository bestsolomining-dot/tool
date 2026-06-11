import React, { useState, useEffect, useCallback, useMemo } from 'react';

const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
  { id: 'bitcoin-cash', symbol: 'BCH', name: 'Bitcoin Cash' },
];

function Sparkline({ data, width = 120, height = 40, color = '#60a5fa' }) {
  if (!data || !Array.isArray(data) || data.length < 2) {
    return (
      <div style={{ width, height, background: 'rgba(255,255,255,0.02)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '8px', opacity: 0.2, fontWeight: 'bold', letterSpacing: '0.1em' }}>NO HISTORY</span>
      </div>
    );
  }
  
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ overflow: 'visible', filter: `drop-shadow(0 0 4px ${color}44)` }}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export default function CryptoRatePage({ onCall }) {
  const [prices, setPrices] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [amounts, setAmounts] = useState({ usd: '1000' });
  const [baseCoin, setBaseCoin] = useState('usd');

  const onValueChange = (id, val) => {
    setBaseCoin(id);
    setAmounts({ [id]: val });
  };

  const fetchPrices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = COINS.map(c => c.id).join(',');
      const res = await onCall('/api/v2/prices/coingecko', { 
        query: { ids, vs_currencies: 'usd', sparkline: true }, 
        silent: true 
      });
      
      const data = res?.data || (res && typeof res === 'object' && !res.error ? res : null);
      
      if (data && (data.bitcoin || data.BTC || data.btc)) {
        setPrices(data);
      } else {
        const detail = (typeof res === 'string') 
          ? (res.includes('<!DOCTYPE html>') ? "Cloudflare Intercept" : `API Error: ${res.slice(0, 100)}`)
          : (res?.error || res?.message || `Format Mismatch (Keys: ${res ? Object.keys(res).join(',') : 'null'})`);
        
        if (!prices) setError(`Market data unavailable. ${detail}`);
        throw new Error(detail);
      }
    } catch (err) {
      console.error(`[CryptoRate] REST fetch failed: ${err.message}`);
      // We don't set a hard error here because the WebSocket might still connect and provide data
    } finally {
      setLoading(false);
    }
  }, [onCall]);

  useEffect(() => {
    // Initial fetch to populate data immediately
    fetchPrices();

    // Initialize WebSocket for real-time updates
    let socket = null;
    let reconnectTimeout = null;
    let isComponentMounted = true;
    let retryCount = 0;

    const connectWs = () => {
      if (!isComponentMounted) return;
      
      // Close existing socket if any
      if (socket) {
        socket.onclose = null;
        socket.close();
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/v2/prices/ws`;
      
      socket = new WebSocket(wsUrl);
      if (isComponentMounted) setWsStatus('connecting');

      socket.onopen = () => {
        if (isComponentMounted) setWsStatus('connected');
      };
      
      socket.onmessage = (event) => {
        if (!isComponentMounted) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'price_update' && message.data) {
            setPrices(prev => ({ ...prev, ...message.data }));
          }
        } catch (err) {
          console.warn('[WS] Failed to parse price update', err);
        }
      };

      socket.onclose = () => {
        if (!isComponentMounted || retryCount >= 5) return;
        setWsStatus('disconnected');
        
        if (retryCount < 5) {
          // Exponential backoff: 5s, 10s, 20s, 30s, 30s
          const delay = Math.min(30000, 5000 * Math.pow(2, retryCount));
          reconnectTimeout = setTimeout(connectWs, delay);
          retryCount++;
        } else {
          console.log('[WS] Maximum reconnection attempts reached. Staying in polling mode.');
        }
      };

      socket.onerror = () => {
        if (isComponentMounted) setWsStatus('error');
      };
    };

    connectWs();

    return () => {
      isComponentMounted = false;
      if (socket) socket.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [fetchPrices]);

  // Polling fallback: If WebSocket is not connected, refresh prices every 60 seconds
  useEffect(() => {
    const pollTimer = setInterval(() => {
      if (wsStatus !== 'connected' && !loading) {
        console.log('[CryptoRate] WS inactive, polling for updates...');
        fetchPrices();
      }
    }, 60000);
    return () => clearInterval(pollTimer);
  }, [fetchPrices, wsStatus, loading]);

  const getCoinData = (id) => {
    const coin = COINS.find(c => c.id === id);
    return prices?.[id] || prices?.[coin?.symbol] || prices?.[coin?.symbol?.toLowerCase()];
  };

  const getPrice = (data) => data?.usd || (typeof data === 'number' ? data : 0);

  const results = useMemo(() => {
    const currentInput = parseFloat(amounts[baseCoin]) || 0;
    const baseData = baseCoin === 'usd' ? null : getCoinData(baseCoin);
    const usdValue = baseCoin === 'usd' ? currentInput : currentInput * getPrice(baseData);

    return COINS.map(coin => {
      const data = getCoinData(coin.id);
      const price = getPrice(data);
      return {
        ...coin,
        price,
        change: data?.usd_24h_change || 0,
        history: data?.sparkline_in_7d?.price || data?.sparkline || null,
        calculated: price > 0 ? (usdValue / price) : 0,
        usdValue: usdValue
      };
    });
  }, [prices, amounts, baseCoin]);

  return (
    <div className="crypto-rate-page" style={{ padding: '40px 20px', color: '#f8fafc', background: '#0f172a', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <header style={{ maxWidth: '1200px', margin: '0 auto 40px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '2.5rem', fontWeight: '900', letterSpacing: '-0.025em' }}>
            LIVE <span style={{ color: '#60a5fa' }}>CONVERTER</span>
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '5px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: wsStatus === 'connected' ? '#10b981' : '#f59e0b', boxShadow: wsStatus === 'connected' ? '0 0 8px #10b981' : 'none' }}></div>
            <p style={{ margin: 0, opacity: 0.5, fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{wsStatus === 'connected' ? 'Stream Active' : 'Polling fallback'}</p>
          </div>
        </div>
        {/* <button onClick={() => window.location.href = '/'} style={{ padding: '8px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}>
          ← DASHBOARD
        </button> */}
      </header>

      <div style={{ maxWidth: '1200px', margin: '0 auto 40px', background: 'rgba(30, 41, 59, 0.6)', padding: '30px', borderRadius: '32px', border: '1px solid rgba(96, 165, 250, 0.2)', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: '900', color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Reference Value (USD)</label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: '0', fontSize: '3rem', fontWeight: '300', opacity: 0.2 }}>$</span>
            <input 
              type="number" 
              value={baseCoin === 'usd' ? amounts.usd : (results[0]?.usdValue || 0).toFixed(2)}
              onChange={(e) => onValueChange('usd', e.target.value)}
              style={{ 
                width: '100%', 
                background: 'transparent', 
                border: 'none', 
                outline: 'none', 
                color: '#fff', 
                fontSize: '4.5rem', 
                fontWeight: '900', 
                padding: '10px 10px 10px 40px',
                fontFamily: 'monospace',
                letterSpacing: '-0.05em'
              }}
              placeholder="0.00"
            />
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
        {results.map(coin => {
          return (
            <div key={coin.id} style={{ background: baseCoin === coin.id ? 'rgba(96, 165, 250, 0.1)' : 'rgba(30, 41, 59, 0.4)', border: baseCoin === coin.id ? '1px solid #60a5fa' : '1px solid rgba(255,255,255,0.05)', borderRadius: '24px', padding: '30px', position: 'relative', overflow: 'hidden', transition: 'all 0.2s ease' }}>
              <div style={{ position: 'absolute', top: '-10px', right: '-10px', fontSize: '5rem', fontWeight: '900', opacity: 0.03, pointerEvents: 'none' }}>{coin.symbol}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <span style={{ fontWeight: 'bold', color: '#60a5fa', letterSpacing: '0.1em', fontSize: '0.8rem' }}>{coin.name.toUpperCase()}</span>
                <span style={{ color: coin.change >= 0 ? '#10b981' : '#f87171', fontWeight: 'bold', fontSize: '0.9rem' }}>
                  {coin.change >= 0 ? '▲' : '▼'} {Math.abs(coin.change).toFixed(2)}%
                </span>
              </div>
              <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'center' }}>
                <Sparkline data={coin.history} color={coin.change >= 0 ? '#10b981' : '#f87171'} />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <input 
                  type="number"
                  value={baseCoin === coin.id ? amounts[coin.id] : (coin.calculated > 0 ? coin.calculated.toFixed(8) : "0.00000000")}
                  onChange={(e) => onValueChange(coin.id, e.target.value)}
                  style={{ 
                    width: '100%', 
                    background: 'rgba(0,0,0,0.2)', 
                    border: '1px solid rgba(255,255,255,0.1)', 
                    borderRadius: '16px',
                    padding: '16px',
                    fontSize: '2rem',
                    color: '#fff',
                    fontFamily: 'monospace',
                    outline: 'none',
                    textAlign: 'right',
                    fontWeight: 'bold'
                  }}
                />
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: '500', fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', textAlign: 'right' }}>
                {loading && !prices ? '...' : `1 ${coin.symbol} = $${coin.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </div>
            </div>
          );
        })}
      </div>
      {error && <div style={{ maxWidth: '1200px', margin: '20px auto', padding: '15px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', textAlign: 'center', fontSize: '0.9rem', border: '1px solid rgba(239, 68, 68, 0.2)' }}>{error}</div>}
    </div>
  );
}