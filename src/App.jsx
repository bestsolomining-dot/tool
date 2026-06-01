import { useCallback, useEffect, useState } from 'react';
import Pools from './components/Pools';
import Modal from './components/Modal';
import './App.css';

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState(null);
  const [lastCall, setLastCall] = useState(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [nhClient, setNhClient] = useState('BT');
  const [mrrClient, setMrrClient] = useState('BT');

  const callApi = useCallback(async (path, options = {}) => {
    const startedAt = performance.now();
    const method = options.method || 'GET';
    const { query, ...fetchOptions } = options;
    let finalPath = path;
    const enrichedQuery = { ...query };

    if (path.startsWith('/api/v2/') && !path.startsWith('/api/v2/mrr/')) {
      if (!enrichedQuery.ts) enrichedQuery.ts = Date.now();
      if (!enrichedQuery.client) enrichedQuery.client = nhClient;
    }

    if (Object.keys(enrichedQuery).length > 0) {
      const params = new URLSearchParams();
      Object.entries(enrichedQuery).forEach(([key, value]) => {
        if (value !== undefined && value !== null) params.append(key, String(value));
      });
      const qs = params.toString();
      if (qs) finalPath += (finalPath.includes('?') ? '&' : '?') + qs;
    }

    if (!options.silent) {
      setLoading(true);
      setError('');
      setLastCall({ method, path: finalPath, status: 'Pending', durationMs: null });
    }

    const apiBase = window.location.port === '5173'
      ? `${window.location.protocol}//${window.location.hostname}:3000`
      : '';

    const headers = { ...fetchOptions.headers };
    let body = fetchOptions.body;

    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      body = JSON.stringify(body);
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    try {
      const res = await fetch(`${apiBase}${finalPath}`, {
        ...fetchOptions,
        method,
        headers,
        body,
        mode: 'cors',
      });

      let data = null;
      if (res.status !== 204) {
        const text = await res.text();
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }

        if (!options.silent) {
          setLastCall({
            method,
            path: finalPath,
            status: `${res.status} ${res.statusText}`,
            durationMs: Math.round(performance.now() - startedAt),
          });
        }

        if (res.ok) {
          if (!options.silent) setOutput(data);
        } else if (!options.silent) {
          setError(data?.error || res.statusText || 'Unknown API Error');
        }
      }
      return data;
    } catch (err) {
      if (!options.silent) {
        setError(err.message || String(err));
      }
      throw err;
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [nhClient]);

  const handleMiningCall = useCallback((path, opts = {}) => {
    return callApi(path, { ...opts });
  }, [callApi]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <h3>Ben Tre Mining Tool</h3>
          <div className="status-card">
            <span style={{ opacity: 0.5 }}>SYSTEM: </span>
            <span className={loading ? 'status-ready' : error ? 'status-error' : 'status-success'}>
              {loading ? 'Loading...' : error ? 'Error' : 'Ready'}
            </span>
          </div>
        </div>
      </header>

      <main className="dashboard">
        <section className="pools-section" style={{ padding: '24px', background: 'rgba(255,255,255,0.02)', borderRadius: '16px' }}>
          <Pools 
            onCall={handleMiningCall}
            niceHashData={output} 
            mrrClient={mrrClient} 
            setMrrClient={setMrrClient} 
            nhClient={nhClient} 
            setNhClient={setNhClient} 
          />
        </section>
      </main>

      <Modal
        isOpen={responseModalOpen}
        onClose={() => setResponseModalOpen(false)}
        title="API Response Details"
        maxWidth="1100px"
      >
        {lastCall && (
          <div className="response-meta" style={{ marginBottom: '15px', opacity: 0.8, fontSize: '12px' }}>
            <span>{lastCall.method} {lastCall.path} — {lastCall.status} ({lastCall.durationMs}ms)</span>
          </div>
        )}
        <pre className="response-body modal" style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {JSON.stringify(modalContent || output, null, 2)}
        </pre>
      </Modal>
    </div>
  );
}
