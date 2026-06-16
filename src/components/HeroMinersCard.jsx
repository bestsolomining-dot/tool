import React, { useState, useEffect, useCallback, useMemo } from 'react';

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
  const [sortConfig, setSortConfig] = useState({ key: 'usdPerDay', direction: 'desc' });

  const requestSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const sortedCoinStats = useMemo(() => {
    if (!heroStats?.coinStats) return [];
    
    return [...heroStats.coinStats].sort((a, b) => {
      let aVal, bVal;
      
      if (sortConfig.key === 'usdPerDay') {
        // Strip currency symbols and parse as float
        aVal = parseFloat(String(a.usdPerDay || '0').replace(/[^0-9.]/g, '')) || 0;
        bVal = parseFloat(String(b.usdPerDay || '0').replace(/[^0-9.]/g, '')) || 0;
      } else if (sortConfig.key === 'miners') {
        aVal = Number(a.miners) || 0;
        bVal = Number(b.miners) || 0;
      } else {
        aVal = a[sortConfig.key];
        bVal = b[sortConfig.key];
      }

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [heroStats, sortConfig]);

  const fetchStats = useCallback(async (type) => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchMiningStats(type, mrrClient);
      if (data.success && data.stats) {
        if (type === 'herominers' || type === 'all') setHeroStats(data.stats);
        if (type === 'miningpooldutch' || type === 'all') setDutchStats(data.stats);
      }
    } catch (err) {
      setError(err.message);
      if (type === 'herominers' || type === 'all') setHeroStats(null);
      if (type === 'miningpooldutch' || type === 'all') setDutchStats(null);
    } finally {
      setLoading(false);
    }
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

      <div className="code-block-content" style={{ maxHeight: '600px', overflowY: 'auto', fontSize: '11px', color: '#94a3b8', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
        {(activeType === 'herominers' || activeType === 'all') && heroStats && (
          <div>
            <div style={{ color: '#fbbf24', marginBottom: '8px', fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold' }}>HeroMiners Global Content</div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <div style={{ padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                <div style={{ fontSize: '9px', opacity: 0.6 }}>MINERS / WORKERS</div>
                <strong style={{ color: '#f8fafc', fontSize: '12px' }}>
                  {Number(heroStats.miners) || heroStats.coinStats?.reduce((acc, c) => acc + (Number(c.miners) || 0), 0) || 0} / {Number(heroStats.workers) || heroStats.coinStats?.reduce((acc, c) => acc + (Number(c.workers) || 0), 0) || 0}
                </strong>
              </div>
              <div style={{ padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ fontSize: '9px', opacity: 0.6 }}>AVG DIFFICULTY / 24H</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                  <strong style={{ color: '#f8fafc', fontSize: '11px' }}>{heroStats.avgDifficulty || '0'}</strong>
                  <span style={{ fontSize: '9px', opacity: 0.4 }}>|</span>
                  <strong style={{ color: '#60a5fa', fontSize: '11px' }}>{heroStats.avgDifficulty24h || '0'}</strong>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '6px', marginBottom: '15px' }}>
              {heroStats.globalHashrates && Object.entries(heroStats.globalHashrates).map(([algo, rate]) => (
                <div key={algo} style={{ background: 'rgba(255,255,255,0.015)', padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.03)' }}>
                  <div style={{ opacity: 0.5, fontSize: '8px', textTransform: 'uppercase' }}>{algo}</div>
                  <div style={{ fontWeight: 'bold', color: '#f8fafc', fontSize: '10px' }}>{rate}</div>
                </div>
              ))}
            </div>

            {heroStats.coinStats && heroStats.coinStats.length > 0 && (
              <div style={{ marginTop: '15px' }}>
                <div style={{ color: '#fbbf24', marginBottom: '8px', fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold' }}>Coin Profitability Table</div>
                <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px', textAlign: 'left', minWidth: '700px' }}>
                    <thead style={{ background: 'rgba(255,255,255,0.03)', opacity: 0.7 }}>
                      <tr>
                        <th style={{ padding: '6px 8px' }}>Coin</th>
                        <th style={{ padding: '6px 8px' }}>Algorithm</th>
                        <th style={{ padding: '6px 8px' }}>Network Hash</th>
                        <th style={{ padding: '6px 8px' }}>Pool Hash</th>
                        <th style={{ padding: '6px 8px' }}>Height</th>
                        <th style={{ padding: '6px 8px' }}>Blocks Found</th>
                        <th style={{ padding: '6px 8px', cursor: 'pointer', color: '#60a5fa' }} onClick={() => requestSort('miners')}>Miners {sortConfig.key === 'miners' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</th>
                        <th style={{ padding: '6px 8px', cursor: 'pointer', color: '#60a5fa' }} onClick={() => requestSort('usdPerDay')}>USD/day {sortConfig.key === 'usdPerDay' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</th>
                        <th style={{ padding: '6px 8px' }}>BTC/day</th>
                        <th style={{ padding: '6px 8px' }}>Coins/day</th>
                        <th style={{ padding: '6px 8px' }}>Total Payments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedCoinStats.map((coin, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '6px 8px', fontWeight: 'bold', color: '#f8fafc' }}>{coin.coin}</td>
                          <td style={{ padding: '6px 8px', opacity: 0.8 }}>{coin.algorithm}</td>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{coin.networkHashrate}</td>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{coin.poolHashrate}</td>
                          <td style={{ padding: '6px 8px' }}>{coin.blockHeight}</td>
                          <td style={{ padding: '6px 8px' }}>{coin.blocksFound || '0'}</td>
                          <td style={{ padding: '6px 8px' }}>{coin.miners} / {coin.workers}</td>
                          <td style={{ padding: '6px 8px', color: '#10b981', fontWeight: 'bold' }}>{coin.usdPerDay}</td>
                          <td style={{ padding: '6px 8px', color: '#fbbf24' }}>{coin.btcPerDay || '0.000000'}</td>
                          <td style={{ padding: '6px 8px', color: '#a78bfa' }}>{coin.coinsPerDay || '0.000'}</td>
                          <td style={{ padding: '6px 8px', opacity: 0.6 }}>{coin.totalPayments || '0'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeType !== 'all' && (
              <div style={{ marginTop: '15px', opacity: 0.4, fontSize: '9px', textAlign: 'center' }}>
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