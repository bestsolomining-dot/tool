import React, { useState, useEffect } from 'react';

/**
 * HeroMinersCard Component
 * Fetches and displays live content/stats from HeroMiners.
 */
export default function HeroMinersCard({ onCall }) {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHeroContent = async () => {
    setLoading(true);
    setError(null);
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

  return (
    <div className="hero-miners-live-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: '#60a5fa' }}>HeroMiners Live Content</h3>
        <button className="text-button" onClick={fetchHeroContent} disabled={loading} style={{ fontSize: '10px' }}>
          {loading ? 'Fetching...' : 'Refresh Source'}
        </button>
      </div>
      {error && <div style={{ fontSize: '10px', color: '#f87171', marginBottom: '8px' }}>{error}</div>}
      <div className="code-block-content" style={{ maxHeight: '400px', overflowY: 'auto', fontSize: '11px', whiteSpace: 'pre-wrap', color: '#94a3b8', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
        {content || (!loading && !error && 'Waiting for source data... ensure backend allows external fetching.')}
      </div>
    </div>
  );
}