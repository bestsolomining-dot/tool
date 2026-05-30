import { useCallback, useState } from 'react';
import Pools from './components/Pools';
import Modal from './components/Modal';
import HashrateCalculator from './components/HashrateCalculator';
import HashpowerBot from './components/HashpowerBot';
import NiceHash from './components/NiceHash';
import MiningRigRental from './components/MiningRigRental';
import './App.css';

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState(null);
  const [lastCall, setLastCall] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [calculatorModalOpen, setCalculatorModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [algorithm, setAlgorithm] = useState('');
  const [market, setMarket] = useState('');
  const [mrrClient, setMrrClient] = useState('BT');

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

      // Improved detection for both JSON errors and plain string errors
      const isAppError = !res.ok ||
        (data && typeof data === 'object' && (data.success === false || data.error)) ||
        (typeof data === 'string' && data.length > 0 && !data.startsWith('{'));

      if (!isAppError && (res.status === 304 || res.ok)) {
        if (!options.silent) {
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
          <h2>Ben Tre Mining Tool</h2>
          <p className="subtitle">
            A powerful desktop tool for Nicehash miners. Manage rigs, monitor stats, and automate hashpower purchases with ease.
          </p>
        </div>
        <div className="status-card">
          <div className="status-item">
            <span>Status:</span>
            <span className={`status-value ${loading ? 'status-ready' : error ? 'status-error' : 'status-success'}`} style={{ color: 'green' }}>
              {loading ? 'Loading...' : error ? 'Error' : 'Ready'}
            </span>
          </div>
        </div>
      </header>

      <main className="dashboard">
        <section className="quick-actions">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Actions</h3>
              <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>Open the hashrate calculator in a popup modal.</p>
            </div>
            <button className="btn-pro secondary" onClick={() => setCalculatorModalOpen(true)} style={{ whiteSpace: 'nowrap' }}>
              Open Calculator
            </button>
          </div>
          <div className="column-stack" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <article className="panel">
              <NiceHash
                output={output}
                onCall={handleMiningCall}
                algorithm={algorithm}
                market={market}
              />
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

      <Modal
        isOpen={calculatorModalOpen}
        onClose={() => setCalculatorModalOpen(false)}
        title="Hashrate Calculator"
        maxWidth="700px"
      >
        <HashrateCalculator />
      </Modal>
    </div>
  );
}
