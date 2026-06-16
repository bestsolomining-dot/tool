import React, { useState, useEffect, useCallback } from 'react';

import { fetchMiningStats } from './miningStatsFetcher';
/**
 * HeroMinersCard Component
 * Fetches and displays live stats from HeroMiners and Mining Pool Dutch using WebSocket.
 * Resolves the 404 error from the legacy /api/v2/external/fetch REST endpoint.
 */
export default function HeroMinersCard({ mrrClient = 'VN' }) {
  const [heroStats, setHeroStats] = useState(null);
  const [dutchStats, setDutchStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeType, setActiveType] = useState('herominers');

  const fetchStats = useCallback(async (type) => {
    setLoading(true);
    setError(null);

    const maxAttempts = 5;
    const baseDelay = 1000; // Start with 1 second delay

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const data = await fetchMiningStats(type, mrrClient);
        if (data.success && data.stats) {
          if (type === 'herominers' || type === 'all') setHeroStats(data.stats);
          if (type === 'miningpooldutch' || type === 'all') setDutchStats(data.stats);
          setError(null);
          setLoading(false);
          return;
        }
      } catch (err) {
        if (attempt === maxAttempts) {
          setError(`Failed after ${maxAttempts} attempts: ${err.message}`);
          if (type === 'herominers' || type === 'all') setHeroStats(null);
          if (type === 'miningpooldutch' || type === 'all') setDutchStats(null);
        } else {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          setError(`Retry ${attempt}/${maxAttempts} in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    setLoading(false);
  }, [mrrClient]);

  useEffect(() => {
    fetchStats(activeType);
  }, [activeType, fetchStats]);

  return (
    <div className="hero-miners-live-card" style={{ padding: '15px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            className="text-button" 
            style={{ fontSize: '14px', color: activeType === 'herominers' ? '#60a5fa' : '#94a3b8', fontWeight: activeType === 'herominers' ? 'bold' : 'normal' }}
            onClick={() => setActiveType('herominers')}
          >
            HeroMiners
          </button>
          <button 
            className="text-button" 
            style={{ fontSize: '14px', color: activeType === 'miningpooldutch' ? '#60a5fa' : '#94a3b8', fontWeight: activeType === 'miningpooldutch' ? 'bold' : 'normal' }}
            onClick={() => setActiveType('miningpooldutch')}
          >
            MiningPoolDutch
          </button>
          <button 
            className="text-button" 
            style={{ fontSize: '14px', color: activeType === 'all' ? '#60a5fa' : '#94a3b8', fontWeight: activeType === 'all' ? 'bold' : 'normal' }}
            onClick={() => setActiveType('all')}
          >
            All
          </button>
        </div>
        <button className="text-button" onClick={() => fetchStats(activeType)} disabled={loading} style={{ fontSize: '11px' }}>
          {loading ? '...' : 'Refresh'}
        </button>
      </div>

      {error && <div style={{ fontSize: '11px', color: '#f87171', marginBottom: '10px' }}>{error}</div>}

      <div className="code-block-content" style={{ maxHeight: '300px', overflowY: 'auto', fontSize: '11px', color: '#94a3b8', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
        {(activeType === 'herominers' || activeType === 'all') && heroStats && (
          <div>
            <div style={{ color: '#fbbf24', marginBottom: '8px', fontSize: '10px', textTransform: 'uppercase' }}>HeroMiners Global Content</div>
            {heroStats.globalHashrates && Object.entries(heroStats.globalHashrates).map(([algo, rate]) => (
              <div key={algo} style={{ marginBottom: '4px' }}>
                <span style={{ opacity: 0.6 }}>{algo}:</span> <strong>{rate}</strong>
              </div>
            ))}
            {heroStats.coinStats && heroStats.coinStats.length > 0 && (
              <div style={{ marginTop: '12px' }}>
                <div style={{ color: '#fbbf24', marginBottom: '4px', fontSize: '10px', textTransform: 'uppercase' }}>Top Coin Statistics</div>
                {heroStats.coinStats.slice(0, 10).map((coin, idx) => (
                   <div key={idx} style={{ marginBottom: '2px', display: 'flex', justifyContent: 'space-between' }}>
                     <span>{coin.coin} ({coin.algorithm})</span>
                     <span style={{ color: '#10b981' }}>{coin.usdPerDay}</span>
                   </div>
                ))}
              </div>
            )}
            {activeType !== 'all' && (
              <div style={{ marginTop: '10px', opacity: 0.4, fontSize: '9px' }}>
                Detailed stats available in Pool Configuration modal.
              </div>
            )}
          </div>
        )}
        {(activeType === 'miningpooldutch' || activeType === 'all') && dutchStats && (
          <div>
            <div style={{ color: '#fbbf24', margin: '12px 0 8px', fontSize: '10px', textTransform: 'uppercase' }}>MiningPoolDutch (BT API)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {Object.entries(dutchStats).slice(0, 8).map(([key, val]) => (
                <div key={key}>
                  <div style={{ fontSize: '9px', opacity: 0.5 }}>{key.toUpperCase()}</div>
                  <div style={{ fontWeight: 'bold', fontSize: '10px' }}>{String(val)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!loading && !error && !heroStats && !dutchStats && 'Click refresh to load stats.'}
      </div>
    </div>
  );
}