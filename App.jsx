import { useCallback, useState } from 'react';
import Pools from './src/components/Pools';
import Modal from './src/components/Modal';
import HashpowerBot from './src/components/HashpowerBot';
import NiceHash from './src/components/NiceHash';
import MiningRigRental from './src/components/MiningRigRental';
import './src/App.css';

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState(null);
  const [lastCall, setLastCall] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [algorithm, setAlgorithm] = useState(null);
  const [market, setMarket] = useState(null);
  const [mrrClient, setMrrClient] = useState('BT'); // Default to BT to prevent initial errors

  const scrollToPools = useCallback(() => {
    const poolsEl = document.querySelector('.pools-section');
    if (poolsEl) poolsEl.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const callApi = useCallback(async (path, options = {}) => {
    const startedAt = performance.now();
    const method = options.method || 'GET';

    const { query, section, ...fetchOptions } = options;
    let finalPath = path;

    const enrichedQuery = { ...query };
    // NiceHash API v2 requires a 'ts' parameter. MRR does not.
    if (path.startsWith('/api/v2/') && !path.startsWith('/api/v2/mrr/') && !enrichedQuery.ts) {
      enrichedQuery.ts = Date.now();
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
      setActiveSection(section || null);
      setLoading(true);
      setError('');
    }
    if (!options.silent) {
      setLastCall({ method, path: finalPath, status: 'Pending', durationMs: null });
    }

    const apiBase = window.location.port === '5173'
      ? `${window.location.protocol}//${window.location.hostname}:3000`
      : '';

    const headers = { ...fetchOptions.headers };
    let body = fetchOptions.body;

    // Automatically stringify object bodies and set the default Content-Type
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
        credentials: 'omit',
      });

      let data = null;
      if (res.status !== 204) {
        const text = await res.text();
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
      }

      if (!options.silent) {
        setLastCall({
          method,
          path: finalPath,
          status: `${res.status} ${res.statusText}`,
          durationMs: Math.round(performance.now() - startedAt),
        });
      }

      const isAppError = data && data.success === false;

      if (!isAppError && (res.status === 304 || res.ok)) {
        if (!options.silent && options.showModal) {
          setError('');
          if (res.status === 304) {
            setModalContent({
              status: res.status,
              message: res.statusText,
              note: 'Content not modified. Displaying previously fetched data if available.',
            });
            setResponseModalOpen(true);
          } else {
            setOutput(data);
            setModalContent(data);
            setResponseModalOpen(true);
          }
        } else if (!options.silent) {
          setOutput(data);
        }
      } else if (!options.silent) {
        const errorMsg =
          typeof data === 'string'
            ? data
            : data?.error || data?.message || data?.data?.message || res.statusText;

        setError(errorMsg);
        setOutput(null);
        setModalContent(null);
        setResponseModalOpen(false);
      }
      return data;
    } catch (err) {
      if (!options.silent) {
        setError(err.message || String(err));
        setLastCall((prev) => ({
          ...prev,
          status: 'Failed',
          durationMs: Math.round(performance.now() - startedAt),
        }));
      }
      throw err;
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, []);

  const handleMiningCall = useCallback((path, opts = {}) => {
    return callApi(path, { ...opts, section: 'mining' });
  }, [callApi]);

  const handleHashpowerCall = useCallback((path, opts = {}) => {
    return callApi(path, { ...opts, section: 'hashpower' });
  }, [callApi]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <h1>Ben Tre Mining Tool</h1>
          <p className="subtitle">
            A powerful desktop tool for Nicehash miners. Manage rigs, monitor stats, and automate hashpower purchases with ease.
          </p>
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
              <NiceHash
                output={output}
                onCall={handleMiningCall}
                algorithm={algorithm}
                market={market}
              />
              {/* <div style={{ marginTop: '10px' }}>
                <button className="btn-pro secondary" onClick={scrollToPools}>Manage Pools</button>
              </div> */}
            </article>

            <article className="panel">
              <div className="panel-header">
                <h2>Hashpower Market</h2>
                <span className="panel-icon">?</span>
              </div>
              <div className="market-inputs">
                <input
                  className="input-pro"
                  placeholder="Algo (e.g. KAWPOW)"
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value)}
                />
                <input
                  className="input-pro"
                  placeholder="Market (e.g. EU/USA)"
                  value={market}
                  onChange={(e) => setMarket(e.target.value)}
                />
              </div>
              <select
                className="select-pro"
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  if (val === 'orderbook' || val === '/api/v2/hashpower/myOrders') {
                    const path = val === 'orderbook' ? '/api/v2/hashpower/order-book' : val;
                    handleHashpowerCall(path, {
                      query: { 
                        algorithm, 
                        market, 
                        op: 'LE', 
                        ts: Date.now(), 
                        limit: 100
                        // active: true // Removed to show all orders (active and inactive)
                      },
                      silent: true // Prevents modal from opening when selecting from dropdown
                    });
                  } else {
                    handleHashpowerCall(val);
                  }
                }}
                value=""
              >
                <option value="" disabled>Select Endpoint...</option>
                <option value="/api/v2/hashpower/myOrders">My Orders</option>
                <option value="orderbook">Order Book</option>
                <option value="/api/v2/public/stats/24h">Global Stats 24h</option>
              </select>
              <div style={{ marginTop: '10px' }}>
                <button className="btn-pro secondary" onClick={scrollToPools}>Configure Target Pool</button>
              </div>
              <div style={{ marginTop: '20px' }}>
                <HashpowerBot algorithm={algorithm} market={market} onCall={handleHashpowerCall} />
              </div>
            </article>
          </div>

          <article className="panel">
            <MiningRigRental 
              onCall={handleMiningCall} 
              mrrClient={mrrClient} 
              setMrrClient={setMrrClient} 
            />
          </article>
        </section>

        <section className="pools-section">
          <Pools niceHashData={output} mrrClient={mrrClient} setMrrClient={setMrrClient} />
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