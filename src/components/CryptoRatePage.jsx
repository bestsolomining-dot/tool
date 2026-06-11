import React, { useState, useEffect, useCallback, useMemo } from 'react';

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
          <p style={{ margin: '5px 0 0', opacity: 0.5, fontSize: '0.9rem' }}>Real-time market valuation for mining assets</p>
        </div>
        <button onClick={() => window.location.href = '/'} style={{ padding: '8px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}>
          ← DASHBOARD
        </button>
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