import React, { useState, useEffect } from 'react';

export default function MinecoinPrices({ onCall }) {
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPrices = async () => {
    setLoading(true);
    try {
      const res = await onCall('/api/v2/prices/coingecko', { silent: true });
      if (res?.success) {
        setPrices(res.data);
      } else {
        setError(res?.error || 'Failed to fetch prices');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [onCall]);

  if (loading && Object.keys(prices).length === 0) {
    return <div style={{ padding: '40px', textAlign: 'center', opacity: 0.6 }}>Loading CoinGecko market data...</div>;
  }

  return (
    <div className="minecoin-dashboard nh-theme" style={{ padding: '20px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, color: '#a78bfa' }}>Mining Coin Market Prices</h2>
        <button className="btn-pro secondary" onClick={fetchPrices} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error-message" style={{ marginBottom: '20px', padding: '10px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '4px', color: '#f87171' }}>Error: {error}</div>}

      <div className="table-responsive">
        <table className="pro-table">
          <thead>
            <tr>
              <th>Coin</th>
              <th style={{ textAlign: 'right' }}>Price (USD)</th>
              <th style={{ textAlign: 'right' }}>Price (BTC)</th>
              <th style={{ textAlign: 'right' }}>24h Change</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(prices).map(([id, data]) => (
              <tr key={id}>
                <td style={{ fontWeight: 'bold', textTransform: 'capitalize', color: '#60a5fa' }}>{id.replace(/-/g, ' ')}</td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                  ${data.usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#fbbf24' }}>
                  {data.btc.toFixed(8)} BTC
                </td>
                <td style={{ 
                  textAlign: 'right', 
                  color: data.usd_24h_change >= 0 ? '#10b981' : '#f87171',
                  fontWeight: 'bold'
                }}>
                  {data.usd_24h_change?.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: '20px', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '4px', fontSize: '11px', opacity: 0.5 }}>
        Source: CoinGecko API • Updates every 60s • All prices are approximate market rates.
      </div>
    </div>
  );
}