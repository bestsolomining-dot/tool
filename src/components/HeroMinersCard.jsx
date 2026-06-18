import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRentedRigs } from './RentedRigContext';
import { fetchMiningStats } from './miningStatsFetcher'; // your WebSocket wrapper

// ---------- Component ----------
export default function HeroMinersCard({ onCall, pollInterval = 30000 }) {
  const { rentedRigs } = useRentedRigs();
  const [heroGlobalStats, setHeroGlobalStats] = useState(null);
  const [dutchStats, setDutchStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCoin, setSelectedCoin] = useState('');
  const [activeType, setActiveType] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'usdPerDay', direction: 'desc' });
  const [filterMiningOnly, setFilterMiningOnly] = useState(false);
  const pollTimerRef = useRef(null);

  // ---------- Sorting ----------
  const requestSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const activeAlgos = useMemo(() => {
    return new Set(rentedRigs.map((r) => (r.algo || '').toUpperCase()));
  }, [rentedRigs]);

  const sortedCoinStats = useMemo(() => {
    if (!heroGlobalStats?.coinStats) return [];
    let stats = [...heroGlobalStats.coinStats];
    if (filterMiningOnly) {
      stats = stats.filter((c) => activeAlgos.has((c.algorithm || '').toUpperCase()));
    }
    return stats.sort((a, b) => {
      let aVal, bVal;
      if (sortConfig.key === 'usdPerDay') {
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
  }, [heroGlobalStats, sortConfig, filterMiningOnly, activeAlgos]);

  // ---------- Data fetching ----------
  const fetchAllData = useCallback(async (force = false) => {
    setLoading(true);
    let heroGlobalError = null;
    let dutchGlobalError = null;

    try {
      // Use a single WebSocket call to fetch all global stats
      const allStats = await fetchMiningStats('all', 'BT', null, null, 20000, force);

      if (allStats.herominers_global?.success) {
        setHeroGlobalStats(allStats.herominers_global);
      } else {
        heroGlobalError = allStats.herominers_global?.error || 'Failed to fetch HeroMiners stats.';
        setHeroGlobalStats(null);
      }

      if (allStats.miningpooldutch?.success) {
        setDutchStats(allStats.miningpooldutch);
      } else {
        dutchGlobalError = allStats.miningpooldutch?.error || 'Failed to fetch Mining-Dutch stats.';
        setDutchStats(null);
      }

      // Combine errors for display
      const errors = [heroGlobalError, dutchGlobalError].filter(Boolean);
      if (errors.length > 0) {
        setError(errors.join('\n'));
      } else {
        setError(null); // Clear error if all fetches were successful
      }
    } catch (err) {
      // This catch block would only be hit if something truly unexpected happened outside the individual try/catch blocks
      console.error('[HeroMinersCard] Unexpected error during fetchAllData:', err);
      setError(err.message || 'Failed to fetch mining stats');
    } finally {
      setLoading(false);
    }
  }, [onCall]);

  // Polling
  useEffect(() => {
    fetchAllData();
    if (pollInterval > 0) {
      pollTimerRef.current = setInterval(fetchAllData, pollInterval);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [fetchAllData, pollInterval]);

  const refreshData = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(fetchAllData, pollInterval);
    }
    fetchAllData(true); // Manual click forces a fresh scrape
  };

  // ---------- Rendering ----------
  const renderCoinTable = (stats, title) => {
    if (!stats || !Array.isArray(stats) || stats.length === 0) {
      return <div style={{ opacity: 0.6, padding: '10px' }}>No data available</div>;
    }
    return (
      <div>
        {title && <h4 style={{ margin: '0 0 8px 0', color: '#e2e8f0' }}>{title}</h4>}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ color: '#64748b', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: '6px 4px', textAlign: 'left', cursor: 'pointer' }} onClick={() => requestSort('algorithm')}>Algorithm</th>
              <th style={{ padding: '6px 4px', textAlign: 'right', cursor: 'pointer' }} onClick={() => requestSort('miners')}>Miners</th>
              <th style={{ padding: '6px 4px', textAlign: 'right', cursor: 'pointer' }} onClick={() => requestSort('usdPerDay')}>USD/Day</th>
              <th style={{ padding: '6px 4px', textAlign: 'right', cursor: 'pointer' }} onClick={() => requestSort('btcPerDay')}>BTC/Day</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((coin, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '6px 4px', color: '#e2e8f0' }}>{coin.algorithm || 'N/A'}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>{Number(coin.miners || 0).toLocaleString()}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>${parseFloat(coin.usdPerDay || 0).toFixed(2)}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>{parseFloat(coin.btcPerDay || 0).toFixed(8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderDutchStats = () => {
    if (!dutchStats?.coinStats) return null;
    return renderCoinTable(dutchStats.coinStats, 'Mining-Dutch Global');
  };

  const renderContent = () => {
    if (loading && !error) {
      return <div style={{ textAlign: 'center', padding: '20px', opacity: 0.7 }}>Loading…</div>;
    }
    if (error) {
      return (
        <div style={{ color: '#f87171', padding: '10px' }}>
          <div>{error}</div>
          <button
            onClick={refreshData}
            style={{
              marginTop: '8px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid #475569',
              color: '#e2e8f0',
              padding: '4px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    switch (activeType) {
      case 'herominers_global':
        return renderCoinTable(sortedCoinStats, 'HeroMiners Global');
      case 'miningpooldutch':
        return renderDutchStats();
      case 'all':
      default:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {renderCoinTable(sortedCoinStats, 'HeroMiners Global')}
            {renderDutchStats()}
          </div>
        );
    }
  };

  const coinOptions = useMemo(() => {
    if (!heroGlobalStats?.coinStats) return [];
    return heroGlobalStats.coinStats.map(c => c.algorithm).filter(Boolean);
  }, [heroGlobalStats]);

  // ---------- UI ----------
  return (
    <div
      className="hero-miners-live-card"
      style={{
        padding: '15px',
        background: 'rgba(255,255,255,0.02)',
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            className="text-button"
            style={{
              fontSize: '14px',
              color: activeType === 'herominers_global' ? '#60a5fa' : '#94a3b8',
              fontWeight: activeType === 'herominers_global' ? 'bold' : 'normal',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
            onClick={() => setActiveType('herominers_global')}
          >
            Global
          </button>
          <button
            className="text-button"
            style={{
              fontSize: '14px',
              color: activeType === 'miningpooldutch' ? '#fbbf24' : '#94a3b8',
              fontWeight: activeType === 'miningpooldutch' ? 'bold' : 'normal',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
            onClick={() => setActiveType('miningpooldutch')}
          >
            Mining-Dutch Global
          </button>
          <button
            className="text-button"
            style={{
              fontSize: '14px',
              color: activeType === 'all' ? '#60a5fa' : '#94a3b8',
              fontWeight: activeType === 'all' ? 'bold' : 'normal',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
            onClick={() => setActiveType('all')}
          >
            All
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {coinOptions.length > 0 && (
            <select
              value={selectedCoin}
              onChange={(e) => setSelectedCoin(e.target.value)}
              style={{
                background: 'rgba(255,255,255,0.05)',
                color: '#e2e8f0',
                border: '1px solid #334155',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '11px',
              }}
            >
              <option value="">Select coin</option>
              {coinOptions.map((coin) => (
                <option key={coin} value={coin}>
                  {coin.toUpperCase()}
                </option>
              ))}
            </select>
          )}

          <label
            style={{
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              color: '#94a3b8',
            }}
          >
            <input
              type="checkbox"
              checked={filterMiningOnly}
              onChange={(e) => setFilterMiningOnly(e.target.checked)}
            />
            Mining Only
          </label>

          <button
            className="text-button"
            onClick={refreshData}
            disabled={loading}
            style={{
              fontSize: '11px',
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div
        className="code-block-content"
        style={{
          maxHeight: '600px',
          overflowY: 'auto',
          fontSize: '11px',
          color: '#94a3b8',
          background: 'rgba(0,0,0,0.2)',
          padding: '12px',
          borderRadius: '8px',
        }}
      >
        {renderContent()}
      </div>
    </div>
  );
}