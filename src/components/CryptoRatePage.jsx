import React, { useState, useEffect, useCallback } from 'react';

const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
  { id: 'bitcoin-cash', symbol: 'BCH', name: 'Bitcoin Cash' },
];

export default function CryptoRatePage({ onCall }) {
  const [prices, setPrices] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchPrices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = COINS.map(c => c.id).join(',');
      const res = await onCall('/api/v2/prices/coingecko', { 
        query: { ids, vs_currencies: 'usd' }, 
        silent: true 
      });
      
      if (res?.success && res.data) {
        setPrices(res.data);
      } else {
        throw new Error(res?.message || "Invalid data received from price API");
      }
    } catch (err) {
      setError("Unable to fetch live rates. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }, [onCall]);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [fetchPrices]);

  const getCoinData = (id) => {
    const coin = COINS.find(c => c.id === id);
    return prices?.[id] || prices?.[coin?.symbol] || prices?.[coin?.symbol?.toLowerCase()];
  };

  const getPrice = (data) => data?.usd || (typeof data === 'number' ? data : 0);

  return (
    <div className="crypto-rate-page" style={{ padding: '40px 20px', color: '#f8fafc', background: '#0f172a', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <header style={{ maxWidth: '1200px', margin: '0 auto 40px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '2.5rem', fontWeight: '900', letterSpacing: '-0.025em' }}>
            CRYPTO <span style={{ color: '#60a5fa' }}>RATES</span>
          </h1>
          <p style={{ margin: '5px 0 0', opacity: 0.5, fontSize: '0.9rem' }}>Real-time market valuation for mining assets</p>
        </div>
        <button onClick={() => window.location.href = '/'} style={{ padding: '8px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}>
          ← DASHBOARD
        </button>
      </header>

      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
        {COINS.map(coin => {
          const data = getCoinData(coin.id);
          const price = getPrice(data);
          const change = data?.usd_24h_change || 0;

          return (
            <div key={coin.id} style={{ background: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '24px', padding: '30px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: '-10px', right: '-10px', fontSize: '5rem', fontWeight: '900', opacity: 0.03, pointerEvents: 'none' }}>{coin.symbol}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <span style={{ fontWeight: 'bold', color: '#60a5fa', letterSpacing: '0.1em', fontSize: '0.8rem' }}>{coin.name.toUpperCase()}</span>
                <span style={{ color: change >= 0 ? '#10b981' : '#f87171', fontWeight: 'bold', fontSize: '0.9rem' }}>
                  {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
                </span>
              </div>
              <div style={{ fontSize: '2.5rem', fontWeight: '700', fontFamily: 'monospace', color: '#fff' }}>
                {loading && !prices ? '...' : `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </div>
              <div style={{ marginTop: '10px', opacity: 0.4, fontSize: '0.7rem' }}>
                {price > 0 ? (1 / price).toFixed(8) : '0'} {coin.symbol} per $1.00 USD
              </div>
            </div>
          );
        })}
      </div>
      {error && <div style={{ maxWidth: '1200px', margin: '20px auto', padding: '15px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', textAlign: 'center', fontSize: '0.9rem', border: '1px solid rgba(239, 68, 68, 0.2)' }}>{error}</div>}
    </div>
  );
}