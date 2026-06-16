import React, { useState, useEffect, useCallback } from 'react';

/**
 * HeroMinersCard Component
 * Fetches and displays live stats from HeroMiners and Mining Pool Dutch using WebSocket.
 * Resolves the 404 error from the legacy /api/v2/external/fetch REST endpoint.
 */
export default function HeroMinersCard({ onCall, mrrClient = 'VN' }) {
  const [heroStats, setHeroStats] = useState(null);
  const [dutchStats, setDutchStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeType, setActiveType] = useState('herominers');

  const fetchStats = useCallback((type) => {
    setLoading(true);
    setError(null);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/v2/mrr/fetch/ws`;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      socket.send(JSON.stringify({
        action: type,
        client: mrrClient
      }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.success && data.stats) {
          if (type === 'herominers') setHeroStats(data.stats);
          if (type === 'miningpooldutch') setDutchStats(data.stats);
        } else if (data.error) {
          setError(data.error);
        }
      } catch (err) {
        setError("Failed to parse WebSocket data");
      } finally {
        socket.close();
        setLoading(false);
      }
    };

    socket.onerror = () => {
      setError("WebSocket connection failed");
      setLoading(false);
    };
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
        </div>
        <button className="text-button" onClick={() => fetchStats(activeType)} disabled={loading} style={{ fontSize: '11px' }}>
          {loading ? '...' : 'Refresh'}
        </button>
      </div>

      {error && <div style={{ fontSize: '11px', color: '#f87171', marginBottom: '10px' }}>{error}</div>}

      <div className="code-block-content" style={{ maxHeight: '300px', overflowY: 'auto', fontSize: '11px', color: '#94a3b8', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
        {activeType === 'herominers' && heroStats && (
          <div>
            {heroStats.globalHashrates && Object.entries(heroStats.globalHashrates).map(([algo, rate]) => (
              <div key={algo} style={{ marginBottom: '4px' }}>
                <span style={{ opacity: 0.6 }}>{algo}:</span> <strong>{rate}</strong>
              </div>
            ))}
            <div style={{ marginTop: '10px', opacity: 0.4, fontSize: '9px' }}>
              Detailed stats available in Pool Configuration modal.
            </div>
          </div>
        )}
        {activeType === 'miningpooldutch' && dutchStats && (
          <div>
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