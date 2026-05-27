import { useState } from 'react';
import Pools from './components/Pools';
import Modal from './components/Modal';
import HashpowerBot from './components/HashpowerBot';
import MiningRigNiceHash from './components/MiningRigNiceHash';
import MiningRigMRR from './components/MiningRigMRR';
import './App.css';

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState(null);
  const [lastCall, setLastCall] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [algorithm, setAlgorithm] = useState('SHA256');
  const [market, setMarket] = useState('EU');

  const scrollToPools = () => {
    const poolsEl = document.querySelector('.pools-section');
    if (poolsEl) poolsEl.scrollIntoView({ behavior: 'smooth' });
  };

  async function callApi(path, options = {}) {
    const startedAt = performance.now();
    const method = options.method || 'GET';

    // Extract custom options and build query string
    const { query, section, ...fetchOptions } = options;
    let finalPath = path;
    if (query) {
      const params = new URLSearchParams();
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null) params.append(k, String(v));
      });
      const qs = params.toString();
      if (qs) finalPath += (finalPath.includes('?') ? '&' : '?') + qs;
    }

    setActiveSection(section || null);
    setLoading(true);
    setError('');
    setLastCall({ method, path: finalPath, status: 'Pending', durationMs: null });

    // Determine actual backend URL. If on Vite dev server, target port 3000.
    const baseUrl = window.location.port === '5173' 
        ? `${window.location.protocol}//${window.location.hostname}:3000` 
        : '';

    try {
      // Determine actual backend URL. If on Vite dev server (5173), target backend port 3000.
      const apiBase = window.location.port === '5173' 
        ? `${window.location.protocol}//${window.location.hostname}:3000` 
        : '';

      const res = await fetch(`${apiBase}${finalPath}`, { 
        ...fetchOptions, 
        mode: 'cors',
        credentials: 'omit' // Ensures no cookie conflicts on localhost
      });

      // Safely parse body if it exists. Status 304 (Not Modified) and 204 (No Content)
      // typically have no body; we handle this to prevent parsing errors.
      let data = null;
      if (res.status !== 204) {
        const text = await res.text();
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
      }

      setLastCall({
        method,
        path: finalPath,
        status: `${res.status} ${res.statusText}`,
        durationMs: Math.round(performance.now() - startedAt),
      });

      // Check if the response is actually an application-level error
      // (e.g., success: false from MRR even with 200 OK)
      const isAppError = data && data.success === false;

      if (!isAppError && (res.status === 304 || res.ok)) {
        setError('');
        if (res.status === 304) {
          // For 304 Not Modified, the content hasn't changed.
          // The modal will display the *current* `output` state, which is correct.
          // We set modalContent to a specific message for clarity.
          setModalContent({ status: res.status, message: res.statusText, note: "Content not modified. Displaying previously fetched data if available." });
          setResponseModalOpen(true);
        } else { // res.ok (2xx status)
          setOutput(data);
          setModalContent(data);
          setResponseModalOpen(true);
        }
      } else {
        const errorMsg = typeof data === 'string' ? data : data?.error || data?.message || data?.data?.message || res.statusText;
        setError(errorMsg);
        setOutput(null); // Clear previous output on error
        setModalContent(null); // Clear modal content on error
        setResponseModalOpen(false); // Ensure modal is closed on error
      }
    } catch (err) {
      setError(err.message || String(err));
      setLastCall((prev) => ({
        ...prev,
        status: 'Failed',
        durationMs: Math.round(performance.now() - startedAt),
      }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <h1>Ben Tre Mining Tool</h1>
          <p className="subtitle">A powerful desktop tool for Nicehash miners. Manage rigs, monitor stats, and automate hashpower purchases with ease.</p>
        </div>
        <div className="status-card">
          <div className="status-item">
            <span>Status:</span>
            <span className={`status-value ${loading ? 'status-ready' : error ? 'status-error' : 'status-success'}`}>
              {loading ? 'Loading...' : error ? 'Error' : 'Ready'}
            </span>
          </div>
        </div>
      </header>

      <main className="dashboard">
        <section className="quick-actions">
          <div className="column-stack" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <article className="panel">
              <MiningRigNiceHash output={output} onCall={(path, opts) => callApi(path, { ...opts, section: 'mining' })} />
              <div style={{ marginTop: '10px' }}>
                <button className="btn-pro secondary" onClick={scrollToPools}>Manage Pools</button>
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <h2>Hashpower Market</h2>
                <span className="panel-icon">?</span>
              </div>
              <div className="market-inputs">
                <input className="input-pro" placeholder="Algo (e.g. KAWPOW)" value={algorithm} onChange={(e) => setAlgorithm(e.target.value)} />
                <input className="input-pro" placeholder="Market (EU/USA)" value={market} onChange={(e) => setMarket(e.target.value)} />
              </div>
              <select
                className="select-pro"
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  if (val === 'orderbook') callApi(`/api/v2/hashpower/order-book?algorithm=${algorithm}&market=${market}`, { section: 'hashpower' });
                  else callApi(val, { section: 'hashpower' });
                }}
                value=""
              >
                <option value="" disabled>Select Endpoint...</option>
                <option value="/api/v2/hashpower/my-orders">My Orders</option>
                <option value="orderbook">Order Book</option>
                <option value="/api/v2/public/stats/24h">Global Stats 24h</option>
              </select>
              <div style={{ marginTop: '10px' }}>
                <button className="btn-pro secondary" onClick={scrollToPools}>Configure Target Pool</button>
              </div>
              <div style={{ marginTop: '20px' }}>
                <HashpowerBot algorithm={algorithm} market={market} />
              </div>
            </article>
          </div>

          <article className="panel">
            <MiningRigMRR onCall={(path, opts) => callApi(path, { ...opts, section: 'mining' })} />
          </article>
        </section>

        <section className="pools-section">
          <Pools />
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
