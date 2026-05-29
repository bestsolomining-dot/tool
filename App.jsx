import { useCallback, useEffect, useState } from 'react';
import Pools from './src/components/Pools';
import Modal from './src/components/Modal';
import HashpowerBot from './src/components/HashpowerBot';
import NiceHash from './src/components/NiceHash';
import MiningRigRental from './src/components/MiningRigRental';
import MiningRigSection from './src/components/MiningRigSection';
import HashrateCalculator from './src/components/HashrateCalculator';
import MrrPoolsManager from './src/components/MrrPoolsManager';
import './src/App.css';

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState(null);
  const [lastCall, setLastCall] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [algorithm, setAlgorithm] = useState('');
  const [market, setMarket] = useState('');
  const [nhClient, setNhClient] = useState('BT');
  const [mrrClient, setMrrClient] = useState('BT');
  const [mrrPoolData, setMrrPoolData] = useState(null);
  const [mrrPoolRigId, setMrrPoolRigId] = useState('');
  const [mrrPoolRentalId, setMrrPoolRentalId] = useState('');
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
    if (path.startsWith('/api/v2/') && !path.startsWith('/api/v2/mrr/')) {
      if (!enrichedQuery.ts) enrichedQuery.ts = Date.now();
      if (!enrichedQuery.client) {
        enrichedQuery.client = nhClient;
      }
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

        if (!options.silent) {
          setLastCall({
            method,
            path: finalPath,
            status: `${res.status} ${res.statusText}`,
            durationMs: Math.round(performance.now() - startedAt),
          });
        }

        const isAppError = data && (data.success === false || data.error); // Check for common error indicators

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
              if (!options.silent) setOutput(data);
              setModalContent(data);
              setResponseModalOpen(true);
            }
          }
          if (!options.silent) setOutput(data);
        } else if (!options.silent) {
          const errorMsg =
            typeof data === 'string'
              ? data
              : data?.error || data?.message || data?.data?.message || res.statusText || 'Unknown API Error';

          setError(errorMsg);
          setOutput(null);
          setModalContent(null);
          setResponseModalOpen(false);
        }
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

  }, [nhClient]);

  // Clear output when switching accounts to prevent showing stale data
  useEffect(() => {
    setOutput(null);
    setError('');
  }, [nhClient, mrrClient]);

  const handleMiningCall = useCallback((path, opts = {}) => {
    return callApi(path, { ...opts, section: 'mining' });
  }, [callApi]);

  const handleHashpowerCall = useCallback((path, opts = {}) => {
    return callApi(path, { ...opts, section: 'hashpower' });
  }, [callApi]);

  const handleOpenMrrPools = useCallback(async (rig) => {
    if (!rig || !mrrClient || mrrClient === 'ALL') return;

    // Support both rig object and raw ID (fallback)
    const rigObj = typeof rig === 'object' ? rig : { id: rig };
    const statusStr = String(typeof rigObj.status === 'object' ? rigObj.status.status : rigObj.status || '').toLowerCase();
    const isRented = statusStr.includes('rented');
    const rentalId = String(rigObj.rentalid || rigObj.current_rental_id || rigObj.rental_id || rigObj.id || '').trim();
    const rigId = String(rigObj.rigid || rigObj.rig_id || rigObj.id || '').trim();

    // Prevent calling invalid endpoints that lead to 401/404 errors
    if (isRented && !rentalId) return;
    if (!isRented && !rigId) return;
    const path = (isRented && rentalId)
      ? `/api/v2/mrr/rental/${encodeURIComponent(rentalId)}/pool`
      : `/api/v2/mrr/rig/${encodeURIComponent(rigId)}/pool`;
    const result = await handleMiningCall(path, { query: { client: mrrClient }, silent: true });
    setMrrPoolData(result);
    setMrrPoolRigId(isRented ? '' : String(rigId || ''));
    setMrrPoolRentalId(isRented ? String(rentalId || '') : '');
  }, [handleMiningCall, mrrClient]);

  return (
    <div className="app-shell" style={{ padding: '0 20px 40px', maxWidth: '1600px', margin: '0 auto' }}>
      <header className="app-header" style={{
        padding: '40px 0',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        marginBottom: '30px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end'
      }}>
        <div className="brand-block" style={{ flex: 1 }}>
          <h2>Ben Tre Mining Tool</h2>
          <p className="subtitle" style={{ opacity: 0.5, fontSize: '0.95rem', maxWidth: '600px', marginTop: '8px' }}>
            A powerful desktop tool for Nicehash miners. Manage rigs, monitor stats, and automate hashpower purchases with ease.
          </p>
          <div className="status-card" style={{ marginBottom: '5px' }}>
            <div className="status-item">
              <span style={{ opacity: 0.5, marginRight: '8px' }}>SYSTEM:</span>
              <span className={`status-value ${loading ? 'status-ready' : error ? 'status-error' : 'status-success'}`}>
                {loading ? 'Loading...' : error ? 'Error' : 'Ready'}
              </span>
            </div>
          </div>
        </div>
      </header>
      <section className="pools-section">
        <Pools niceHashData={output} mrrClient={mrrClient} setMrrClient={setMrrClient} />
      </section>
      <main className="dashboard">
        <section className="quick-actions">
          <div className="column-stack" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <article className="panel">
              <NiceHash
                key={nhClient}
                output={output}
                onCall={handleMiningCall}
                algorithm={algorithm}
                market={market}
                nhClient={nhClient}
                setNhClient={setNhClient}
              />
            </article>
            <article className="panel">
              <div style={{ marginTop: '5px' }}>
                <HashpowerBot
                  algorithm={algorithm}
                  market={market}
                  onCall={handleHashpowerCall}
                  nhClient={nhClient}
                  setNhClient={setNhClient}
                />
              </div>
            </article>
          </div>
          <article className="panel">
            <MiningRigSection
              onCall={handleMiningCall}
              mrrClient={mrrClient}
              setMrrClient={setMrrClient}
              onOpenMrrPools={handleOpenMrrPools}
            />
          </article>
          <article className="panel">
            <MrrPoolsManager
              onCall={handleMiningCall}
              mrrClient={mrrClient}
              externalPoolData={mrrPoolData}
              externalRigId={mrrPoolRigId}
              externalRentalId={mrrPoolRentalId}
            />
            <article className="panel">
              <HashrateCalculator />
            </article>
          </article>
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