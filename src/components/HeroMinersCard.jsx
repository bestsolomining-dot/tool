import React, { useState, useEffect } from 'react';

/**
 * HeroMinersCard Component
 * Fetches and displays live content/stats from HeroMiners.
 */
export default function HeroMinersCard({ onCall }) {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
<<<<<<< Updated upstream
=======
  const [activeType, setActiveType] = useState('herominers');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(60);
>>>>>>> Stashed changes

  const fetchHeroContent = async () => {
    setLoading(true);
    setError(null);
<<<<<<< Updated upstream
    try {
      // Using a proxy/fetch endpoint assumed to be available on the backend
      // to fetch data from the provided HeroMiners URL.
      const res = await onCall('/api/v2/external/fetch', { 
        query: { url: 'https://herominers.com/' }, 
        silent: true 
      });
      if (res && res.success) {
        setContent(res.data);
      } else {
        setError(res?.message || 'Failed to fetch source content');
=======

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/v2/mrr/fetch/ws`;
    setCountdown(60);
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
>>>>>>> Stashed changes
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHeroContent();
  }, []);

  // Auto-refresh logic
  useEffect(() => {
    if (!autoRefresh) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchStats(activeType);
          return 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoRefresh, activeType, fetchStats]);

  return (
<<<<<<< Updated upstream
    <div className="hero-miners-live-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: '#60a5fa' }}>HeroMiners Live Content</h3>
        <button className="text-button" onClick={fetchHeroContent} disabled={loading} style={{ fontSize: '10px' }}>
          {loading ? 'Fetching...' : 'Refresh Source'}
        </button>
=======
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span 
            style={{ fontSize: '9px', opacity: 0.4, cursor: 'pointer' }} 
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? `Auto-refresh in ${countdown}s` : 'Auto-refresh paused'}
          </span>
          <button className="text-button" onClick={() => fetchStats(activeType)} disabled={loading} style={{ fontSize: '11px' }}>
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
>>>>>>> Stashed changes
      </div>
      {error && <div style={{ fontSize: '10px', color: '#f87171', marginBottom: '8px' }}>{error}</div>}
      <div className="code-block-content" style={{ maxHeight: '400px', overflowY: 'auto', fontSize: '11px', whiteSpace: 'pre-wrap', color: '#94a3b8', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
        {content || (!loading && !error && 'Waiting for source data... ensure backend allows external fetching.')}
      </div>
    </div>
  );
}