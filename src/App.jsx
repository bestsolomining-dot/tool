import { useState } from 'react';
import Pools from './components/Pools';
import Accounting from './components/Accounting';
import HashpowerBot from './components/HashpowerBot';
import './App.css'; // Import the new CSS

export default function App() {
  const [apiResult, setApiResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState(null);
  const [lastCall, setLastCall] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null); // Added for fullscreen modal
  const [algorithm, setAlgorithm] = useState('SHA256');
  const [market, setMarket] = useState('EU');

  const scrollToPools = () => {
    const poolsEl = document.querySelector('.pools-section');
    if (poolsEl) {
      poolsEl.scrollIntoView({ behavior: 'smooth' });
    }
  };

  async function callApi(path, options = {}) {
    const startedAt = performance.now();
    const method = options.method || 'GET';

    setActiveSection(options.section || null);
    setLoading(true);
    setError('');
    // setStatus(`Calling ${path}`); // This was removed as status is now derived from loading/error
    setOutput(null); // Clear previous output
    setLastCall({
      method,
      path,
      status: 'Pending',
      durationMs: null,
    });

    try {
      const res = await fetch(path, options);
      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json() : await res.text();

      setLastCall({
        method,
        path,
        status: `${res.status} ${res.statusText}`,
        durationMs: Math.round(performance.now() - startedAt),
      });

      if (!res.ok) {
        setError(typeof data === 'string' ? data : data?.error || data?.message || res.statusText);
      } else {
        setOutput(data);
      }
    } catch (err) {
      setError(err.message || String(err));
      setLastCall(prev => ({
        ...prev,
        status: 'Failed',
        durationMs: Math.round(performance.now() - startedAt),
      }));
    } finally {
      setLoading(false);
    }
  }

  const ResultPanel = () => {
    const isBalance = output?.total && output?.currencies;

    return (
      <div className="result-panel-container">
        {loading && <div className="loading-spinner-small">Processing Request...</div>}
        {error && <pre className="error-message">{error}</pre>}
        {output && (
          <div className="code-block-wrapper">
            <div className="code-block-header">
               <span>{isBalance ? 'Account Summary' : 'JSON Response'}</span>
               <button className="text-button" onClick={() => {
                 setModalContent(output);
                 setResponseModalOpen(true);
               }}>Fullscreen</button>
            </div>
            {isBalance ? (
              <div className="balance-summary-pro" style={{ padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '0 0 8px 8px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '15px' }}>
                  <div>
                    <small style={{ opacity: 0.6, display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Available</small>
                    <strong style={{ fontSize: '16px', color: '#10b981' }}>{output.total.available} {output.total.currency}</strong>
                  </div>
                  <div>
                    <small style={{ opacity: 0.6, display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Pending</small>
                    <strong style={{ fontSize: '16px', color: '#f59e0b' }}>{output.total.pending} {output.total.currency}</strong>
                  </div>
                  <div>
                    <small style={{ opacity: 0.6, display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Total Balance</small>
                    <strong style={{ fontSize: '16px' }}>{output.total.totalBalance} {output.total.currency}</strong>
                  </div>
                </div>
                <div style={{ marginTop: '10px', fontSize: '11px', opacity: 0.5 }}>
                  Mapped fields shown. Use Fullscreen to see raw data for {output.currencies.length} currencies.
                </div>
              </div>
            ) : (
              <pre className="code-block-content">{JSON.stringify(output, null, 2)}</pre>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <h1>API Management Console</h1>
          <p className="subtitle">
            Explore NiceHash v2 endpoints through a backend proxy. Use your keys in
            the cloud environment with full response inspection.
          </p>
        </div>
        <div className="status-card">
          <div className="status-item">
            <span>Status:</span>
            <span className={`status-value ${loading ? 'status-ready' : error ? 'status-error' : 'status-success'}`}>
              {loading ? 'Loading...' : error ? 'Error' : 'Ready'}
            </span>
          </div>
          {/* {lastCall && (
            <div className="status-item">
              <span>Last Call:</span>
              <span className="status-value">
                {lastCall.method} {lastCall.path} ({lastCall.durationMs}ms)
              </span>
            </div>
          )} */}
          {/* <button
            type="button"
            className="button secondary"
            onClick={() => setResponseModalOpen(true)}
            disabled={!output}
          >
            View API Response
          </button> */}
        </div>
      </header>

      <main className="dashboard">
        <section className="quick-actions">
        <article className="panel">
          <div className="panel-header">
            <h2>Public Services</h2>
            <span className="panel-icon">🌐</span>
          </div>
          <div className="button-group">
            <button className="btn-pro" onClick={() => callApi('/api/v2/time', { section: 'public' })}>
              Server Time
            </button>
            <button className="btn-pro" onClick={() => callApi('/api/v2/algorithms', { section: 'public' })}>
              Algorithms
            </button>
          </div>
          {activeSection === 'public' && <ResultPanel />}
        </article>

        <article className="panel">
           <div className="panel-header">
             <h2>Accounting & Wallet</h2>
             <span className="panel-icon">💰</span>
           </div>
           <Accounting onCall={(path, opts) => callApi(path, { ...opts, section: 'accounting' })} />
           {activeSection === 'accounting' && <ResultPanel />}
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Mining Farm</h2>
            <span className="panel-icon">⛏️</span>
          </div>
          <div className="button-group">
            <button className="btn-pro" onClick={() => callApi('/api/v2/mining/rigs2', { section: 'mining' })}>
              List Rigs (v2)
            </button>
            <button className="btn-pro" onClick={() => callApi('/api/v2/mining/address', { section: 'mining' })}>
              Mining Address
            </button>
            <button className="btn-pro secondary" onClick={scrollToPools}>
              Manage Pools
            </button>
          </div>
          {activeSection === 'mining' && <ResultPanel />}
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Hashpower Market</h2>
            <span className="panel-icon">⚡</span>
          </div>
          <div className="market-inputs">
             <input className="input-pro" placeholder="Algo (e.g. KAWPOW)" value={algorithm} onChange={e => setAlgorithm(e.target.value)} />
             <input className="input-pro" placeholder="Market (EU/USA)" value={market} onChange={e => setMarket(e.target.value)} />
          </div>
          <select 
            className="select-pro" 
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              if (val === 'orderbook') {
                callApi(`/api/v2/hashpower/order-book?algorithm=${algorithm}&market=${market}`, { section: 'hashpower' });
              } else {
                callApi(val, { section: 'hashpower' });
              }
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
          {activeSection === 'hashpower' && <ResultPanel />}
          <div style={{ marginTop: '20px' }}>
            <HashpowerBot algorithm={algorithm} market={market} />
          </div>
        </article>
        </section>

        <section className="pools-section">
          <Pools />
        </section>
      </main>

      {responseModalOpen && (
        <div className="modal-backdrop" onClick={() => setResponseModalOpen(false)}>
          <div className="response-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>API Response Details</h2>
              <button className="close-button" onClick={() => setResponseModalOpen(false)}>&times;</button>
            </div>
            {lastCall && (
              <div className="response-meta">
                <span>{lastCall.method} {lastCall.path}</span>
                <span>{lastCall.status} ({lastCall.durationMs}ms)</span>
              </div>
            )}
            <pre className="response-body modal">
              {JSON.stringify(modalContent || output, null, 2)}
            </pre>
            <div className="modal-actions">
              <button className="btn-pro" onClick={() => setResponseModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}