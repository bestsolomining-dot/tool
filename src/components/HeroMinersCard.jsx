import React, { useState, useEffect, useCallback, useMemo } from 'react';

import { fetchMiningStats } from './miningStatsFetcher';
import { useRentedRigs } from './RentedRigContext';
import { normalizeAlgoForNiceHash } from '../core/mapping';

/**
 * HeroMinersCard Component
 * Fetches and displays live stats from HeroMiners and Mining Pool Dutch using WebSocket.
 * Resolves the 404 error from the legacy /api/v2/external/fetch REST endpoint.
 */
export default function HeroMinersCard({ mrrClient = 'VN', onCall }) {
  const { rentedRigs } = useRentedRigs();
  const [heroStats, setHeroStats] = useState(null);
  const [dutchStats, setDutchStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [nhPrices, setNhPrices] = useState({}); // algo -> { price, unit }
  const [selectedCoin, setSelectedCoin] = useState(null);
  const [activeType, setActiveType] = useState('herominers_global');
  const [sortConfig, setSortConfig] = useState({ key: 'usdPerDay', direction: 'desc' });
  const [filterMiningOnly, setFilterMiningOnly] = useState(false);

  const requestSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const activeAlgos = useMemo(() => {
    return new Set(rentedRigs.map(r => (r.algo || '').toUpperCase()));
  }, [rentedRigs]);

  const sortedCoinStats = useMemo(() => {
    if (!heroStats?.coinStats) return [];
    
    let stats = [...heroStats.coinStats];

    if (filterMiningOnly) {
      stats = stats.filter(c => activeAlgos.has((c.algorithm || '').toUpperCase()));
    }

    // Enrich stats with ROI data
    const enriched = stats.map(coin => {
      const algo = (coin.algorithm || '').toUpperCase();
      const nhData = nhPrices[algo];
      const poolBtc = parseFloat(coin.btcPerDay || 0);
      let roi = null;

      if (nhData && nhData.price > 0 && poolBtc > 0) {
        // ROI = (Profit - Cost) / Cost
        roi = ((poolBtc - nhData.price) / nhData.price) * 100;
      }
      return { ...coin, roi };
    });
    
    return enriched.sort((a, b) => {
      let aVal, bVal;
      
      if (sortConfig.key === 'usdPerDay') {
        // Strip currency symbols and parse as float
        aVal = parseFloat(String(a.usdPerDay || '0').replace(/[^0-9.-]/g, '')) || 0;
        bVal = parseFloat(String(b.usdPerDay || '0').replace(/[^0-9.-]/g, '')) || 0;
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
  }, [heroStats, sortConfig, filterMiningOnly, activeAlgos, nhPrices]);

  // Effect to fetch NiceHash prices for comparison
  useEffect(() => {
    if (!heroStats?.coinStats || !onCall) return;

    const fetchMarketPrices = async () => {
      const uniqueAlgos = [...new Set(heroStats.coinStats.map(c => (c.algorithm || '').toUpperCase()))];
      const newPrices = { ...nhPrices };
      let changed = false;

      for (const algo of uniqueAlgos) {
        if (newPrices[algo] || !algo) continue;
        
        try {
          const nhAlgo = normalizeAlgoForNiceHash(algo);
          if (!nhAlgo || nhAlgo === 'Unknown') continue;

          const res = await onCall('/api/v2/hashpower/order/price', {
            query: { algorithm: nhAlgo, market: 'USA', client: mrrClient === 'VN' ? 'BT' : mrrClient },
            silent: true
          });

          if (res && !res.error) {
            const data = res.price || res;
            newPrices[algo] = {
              price: parseFloat(data.fixedPrice || data.standardPrice?.fast || data.price || 0),
              unit: data.speedUnit || data.unit
            };
            changed = true;
          }
          await new Promise(r => setTimeout(r, 200)); // Throttle
        } catch (e) { console.warn(`Failed price fetch for ${algo}`); }
      }
      if (changed) setNhPrices(newPrices);
    };

    fetchMarketPrices();
  }, [heroStats, onCall, mrrClient]);

  const fetchStats = useCallback(async (type, coinSlug = null) => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchMiningStats(type, mrrClient, null, coinSlug);

      const hero = data.herominers_global || data.herominers || (type.includes('herominers') ? data : null);
      const dutch = data.miningpooldutch || (type === 'miningpooldutch' ? data : null);

      if (hero && hero.success !== false) {
        setHeroStats(hero);
      } else if (hero) {
        setError(hero.error || 'Data not found for this address on the selected pool.');
        setHeroStats(null);
      }

      if (type === 'miningpooldutch' || type === 'all') {
        if (dutch?.success !== false) setDutchStats(dutch);
      }
    } catch (err) {
      setError(err.message || 'Connection error');
      if (type === 'herominers' || type === 'all') setHeroStats(null);
      if (type === 'miningpooldutch' || type === 'all') setDutchStats(null);
    } finally {
      setLoading(false);
    }
  }, [mrrClient]);

  useEffect(() => {
    fetchStats(activeType, selectedCoin);
  }, [activeType, selectedCoin, fetchStats]);

  return (
    <div className="hero-miners-live-card" style={{ padding: '15px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            className="text-button" 
            style={{ fontSize: '14px', color: activeType === 'herominers_global' ? '#60a5fa' : '#94a3b8', fontWeight: activeType === 'herominers_global' ? 'bold' : 'normal' }}
            onClick={() => setActiveType('herominers_global')}
          >
            Global
          </button>
          <button 
            className="text-button" 
            style={{ fontSize: '14px', color: activeType === 'herominers' ? '#fbbf24' : '#94a3b8', fontWeight: activeType === 'herominers' ? 'bold' : 'normal' }}
            onClick={() => {
              setActiveType('herominers');
              if (!selectedCoin) setSelectedCoin('kaspa');
            }}
          >
            {selectedCoin ? `${selectedCoin.toUpperCase()} Dashboard` : 'Pool Details'}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#94a3b8' }}>
            <input type="checkbox" checked={filterMiningOnly} onChange={(e) => setFilterMiningOnly(e.target.checked)} />
            Mining Only
          </label>
          <button className="text-button" onClick={() => fetchStats(activeType)} disabled={loading} style={{ fontSize: '11px' }}>
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div style={{ fontSize: '11px', color: '#f87171', marginBottom: '10px' }}>{error}</div>}

      <div className="code-block-content" style={{ maxHeight: '600px', overflowY: 'auto', fontSize: '11px', color: '#94a3b8', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
        {/* Child Component View: Individual Pool Dashboard */}
        {activeType === 'herominers' && heroStats && heroStats.stats && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
              <div style={{ color: '#fbbf24', fontSize: '11px', fontWeight: 'bold' }}>{selectedCoin?.toUpperCase()} POOL DASHBOARD</div>
              <button className="text-button" onClick={() => { setSelectedCoin(null); setActiveType('herominers_global'); }}>← Back to Global</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}>
              <div style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                <div style={{ fontSize: '8px', opacity: 0.5 }}>BALANCE</div>
                <strong style={{ color: '#10b981', fontSize: '14px' }}>{heroStats.stats.balance || '0.00'}</strong>
              </div>
              <div style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                <div style={{ fontSize: '8px', opacity: 0.5 }}>HASHRATE (1H)</div>
                <strong style={{ color: '#f8fafc', fontSize: '14px' }}>{heroStats.stats.hashrate || '0'}</strong>
              </div>
              <div style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                <div style={{ fontSize: '8px', opacity: 0.5 }}>PAID TOTAL</div>
                <strong style={{ color: '#60a5fa', fontSize: '14px' }}>{heroStats.stats.paid || '0.00'}</strong>
              </div>
            </div>

            {heroStats.workers && heroStats.workers.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '9px', opacity: 0.6, marginBottom: '8px' }}>ACTIVE WORKERS</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'left', opacity: 0.5 }}>
                      <th style={{ padding: '4px' }}>Name</th>
                      <th style={{ padding: '4px' }}>Hashrate</th>
                      <th style={{ padding: '4px' }}>Shares</th>
                    </tr>
                  </thead>
                  <tbody>
                    {heroStats.workers.map((w, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '6px 4px', color: '#f8fafc' }}>{w.name}</td>
                        <td style={{ padding: '6px 4px' }}>{w.hashrate}</td>
                        <td style={{ padding: '6px 4px' }}>{w.shares}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Global Content View */}
        {(activeType === 'herominers_global' || activeType === 'all') && heroStats && (
          <div>
            <div style={{ color: '#fbbf24', marginBottom: '12px', fontSize: '11px', textTransform: 'uppercase', fontWeight: 'bold' }}>HeroMiners Global Stats</div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <div style={{ padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                <div style={{ fontSize: '8px', opacity: 0.6, marginBottom: '2px' }}>AVG. POOL DIFFICULTY</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                  <strong style={{ color: '#f8fafc', fontSize: '11px' }}>{heroStats.avgDifficulty || '0'}</strong>
                  <span style={{ fontSize: '9px', opacity: 0.4 }}>Current Diff.</span>
                </div>
              </div>
              <div style={{ padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                <div style={{ fontSize: '8px', opacity: 0.6, marginBottom: '2px' }}>ACTIVE MINERS / WORKERS</div>
                <strong style={{ color: '#f8fafc', fontSize: '12px' }}>
                  {Number(heroStats.miners) || heroStats.coinStats?.reduce((acc, c) => acc + (Number(c.miners) || 0), 0) || 0} / {Number(heroStats.workers) || heroStats.coinStats?.reduce((acc, c) => acc + (Number(c.workers) || 0), 0) || 0}
                </strong>
              </div>
            </div>

            <div style={{ color: '#fbbf24', marginBottom: '8px', fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', opacity: 0.6 }}>Algorithm Hashrates</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '6px', marginBottom: '20px' }}>
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
                      <tr style={{ color: '#94a3b8' }}>
                        <th style={{ padding: '6px 8px' }}>Coin</th>
                        <th style={{ padding: '6px 8px' }}>Algorithm</th>
                        <th style={{ padding: '6px 8px' }}>Network Hashrate</th>
                        <th style={{ padding: '6px 8px' }}>Pool Hashrate</th>
                        <th style={{ padding: '6px 8px' }}>Block Height</th>
                        <th style={{ padding: '6px 8px' }}>Blocks Found</th>
                        <th style={{ padding: '6px 8px' }}>Miners</th>
                        <th style={{ padding: '6px 8px' }}>Workers</th>
                        <th style={{ padding: '6px 8px' }}>Total Payments</th>
                        <th style={{ padding: '6px 8px', cursor: 'pointer', color: '#34d399' }} onClick={() => requestSort('usdPerDay')}>USD/day {sortConfig.key === 'usdPerDay' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}</th>
                        <th style={{ padding: '6px 8px' }}>BTC/day</th>
                        <th style={{ padding: '6px 8px' }}>Coins/day</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedCoinStats.map((coin, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td 
                            style={{ padding: '6px 8px', fontWeight: 'bold', color: '#60a5fa', cursor: 'pointer' }}
                            onClick={() => {
                              setSelectedCoin(coin.id || coin.coin.toLowerCase());
                              setActiveType('herominers');
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {coin.name} ({coin.coin})
                              {coin.roi > 0 && (
                                <span style={{ background: '#10b981', color: 'white', padding: '1px 4px', borderRadius: '3px', fontSize: '7px', fontWeight: '900' }}>
                                  BEST ROI
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '6px 8px', opacity: 0.8 }}>{coin.algorithm}</td>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{coin.networkHashrate}</td>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>
                            {coin.poolHashrate}
                            <span style={{ fontSize: '8px', opacity: 0.5, marginLeft: '4px' }}>({coin.poolShare}%)</span>
                          </td>
                          <td style={{ padding: '6px 8px' }}>{coin.blockHeight}</td>
                          <td style={{ padding: '6px 8px' }}>{coin.blocksFound || '0'}</td>
                          <td style={{ padding: '6px 8px' }}>{coin.miners}</td>
                          <td style={{ padding: '6px 8px' }}>{coin.workers}</td>
                          <td style={{ padding: '6px 8px', opacity: 0.6 }}>{coin.totalPayments || '0'}</td>
                          <td style={{ padding: '6px 8px', color: '#10b981', fontWeight: 'bold' }}>{coin.usdPerDay}</td>
                          <td style={{ padding: '6px 8px', color: '#fbbf24' }}>
                            {coin.btcPerDay || '0.000000'}
                            {coin.roi !== null && (
                              <div style={{ fontSize: '7px', color: coin.roi >= 0 ? '#10b981' : '#f87171', fontWeight: 'bold' }}>
                                {coin.roi > 0 ? '+' : ''}{coin.roi.toFixed(1)}% vs NH
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '6px 8px', color: '#a78bfa' }}>{coin.coinsPerDay || '0.000'}</td>
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