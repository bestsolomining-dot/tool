import React, { useState, useEffect, useCallback } from 'react';

/**
 * HeroMinersCard Component
 * Fetches and displays live content/stats from HeroMiners.
 */
export default function HeroMinersCard({ onCall }) {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeType, setActiveType] = useState('herominers');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(60);

  // Use useCallback to prevent infinite re-renders in useEffect dependency
  const fetchStats = useCallback(async (type) => {
    setLoading(true);
    setError(null);
    setContent(null);

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/v2/mrr/fetch/ws`;
      setCountdown(60);
      
      const socket = new WebSocket(wsUrl);

      // Return a promise that resolves when we get data or error
      await new Promise((resolve, reject) => {
        socket.onopen = () => {
          socket.send(JSON.stringify({
            action: type,
            client: 'mrrClient' // Fixed: was referencing undefined variable
          }));
        };

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.success && data.stats) {
              if (type === 'herominers') {
                setContent(JSON.stringify(data.stats, null, 2));
              }
              if (type === 'miningpooldutch') {
                setContent(JSON.stringify(data.stats, null, 2));
              }
              resolve();
            } else if (data.error) {
              setError(data.error);
              reject(new Error(data.error));
            }
          } catch (err) {
            setError("Failed to parse WebSocket data");
            reject(err);
          } finally {
            socket.close();
          }
        };

        socket.onerror = (err) => {
          setError("WebSocket connection failed");
          reject(err);
          socket.close();
        };

        // Add timeout for connection
        setTimeout(() => {
          if (socket.readyState === WebSocket.OPEN || 
              socket.readyState === WebSocket.CONNECTING) {
            setError("Connection timeout");
            socket.close();
            reject(new Error("Connection timeout"));
          }
        }, 10000);
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []); // Empty deps since it doesn't depend on any state

  // Initial fetch
  useEffect(() => {
    fetchStats(activeType);
  }, []); // Only run on mount

  // Handle type changes
  useEffect(() => {
    fetchStats(activeType);
  }, [activeType, fetchStats]);

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
    <div 
      className="hero-miners-live-card" 
      style={{ 
        padding: '15px', 
        background: 'rgba(255,255,255,0.02)', 
        borderRadius: '12px', 
        border: '1px solid rgba(255,255,255,0.05)' 
      }}
    >
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '12px' 
      }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            className="text-button" 
            style={{ 
              fontSize: '14px', 
              color: activeType === 'herominers' ? '#60a5fa' : '#94a3b8', 
              fontWeight: activeType === 'herominers' ? 'bold' : 'normal',
              background: 'none',
              border: 'none',
              cursor: 'pointer'
            }}
            onClick={() => setActiveType('herominers')}
            disabled={loading}
          >
            HeroMiners
          </button>
          <button 
            className="text-button" 
            style={{ 
              fontSize: '14px', 
              color: activeType === 'miningpooldutch' ? '#60a5fa' : '#94a3b8', 
              fontWeight: activeType === 'miningpooldutch' ? 'bold' : 'normal',
              background: 'none',
              border: 'none',
              cursor: 'pointer'
            }}
            onClick={() => setActiveType('miningpooldutch')}
            disabled={loading}
          >
            MiningPoolDutch
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span 
            style={{ 
              fontSize: '9px', 
              opacity: 0.4, 
              cursor: 'pointer',
              userSelect: 'none'
            }} 
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? `Auto-refresh in ${countdown}s` : 'Auto-refresh paused'}
          </span>
          <button 
            className="text-button" 
            onClick={() => fetchStats(activeType)} 
            disabled={loading} 
            style={{ 
              fontSize: '11px',
              background: 'none',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '4px',
              padding: '2px 8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1
            }}
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>
      
      {error && (
        <div style={{ 
          fontSize: '10px', 
          color: '#f87171', 
          marginBottom: '8px',
          padding: '8px',
          background: 'rgba(248, 113, 113, 0.1)',
          borderRadius: '4px'
        }}>
          {error}
        </div>
      )}
      
      <div 
        className="code-block-content" 
        style={{ 
          maxHeight: '400px', 
          overflowY: 'auto', 
          fontSize: '11px', 
          whiteSpace: 'pre-wrap', 
          color: '#94a3b8', 
          background: 'rgba(0,0,0,0.2)', 
          padding: '12px', 
          borderRadius: '8px',
          fontFamily: 'monospace'
        }}
      >
        {content || (!loading && !error && 'Waiting for source data... ensure backend allows external fetching.')}
      </div>
    </div>
  );
}