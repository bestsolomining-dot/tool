import { useCallback, useEffect, useState } from 'react';
import Pools from './src/components/Pools';
import Modal from './src/components/Modal';
import HashpowerBot from './src/components/HashpowerBot';
import NiceHash from './src/components/NiceHash';
import MiningRigRental from './src/components/MiningRigRental';
import MiningRigSection from './src/components/MiningRigSection';
import HashrateCalculator from './src/components/HashrateCalculator';
import MrrPoolsManager from './src/components/MrrPoolsManager';
import { RentedRigProvider, useRentedRigs } from './src/components/RentedRigContext';
import RentedRigCard from './src/components/RentedRigCard';
import './src/App.css';

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
    // NiceHash API v2 requires 'ts'. For MRR, we add it to prevent browser-side caching of GET requests.
    if (path.startsWith('/api/v2/')) {
      if (!enrichedQuery.ts) enrichedQuery.ts = Date.now();
      if (!enrichedQuery.client) {
        enrichedQuery.client = nhClient;
        console.log(`[App.jsx:callApi] Using nhClient: ${nhClient}`);
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

    // Use relative API paths so development proxy and production same-origin routing both work.
    const apiBase = '';

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
      if (res.status !== 204 && res.status !== 205) {
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

      const isAppError = !res.ok || (data && typeof data === 'object' && (data.success === false || data.error));

      if (!isAppError && (res.status === 304 || res.ok)) {
        if (!options.silent && options.showModal) {
          setError('');
          if (res.status === 304) {
            setModalContent({
              status: res.status,
              message: res.statusText,
              note: 'Content not modified. Displaying previously fetched data if available.',
            });
          } else {
            if (data && !options.silent) setOutput(data);
            setModalContent(data || { success: true, message: 'Request completed successfully.' });
          }
          setResponseModalOpen(true);
        } else if (!options.silent && data) {
          setOutput(data);
        }
      } else if (!options.silent) {
        const errorMsg =
          typeof data === 'string' && data.length > 0
            ? data
            : data?.error || data?.message || data?.data?.message || res.statusText || 'Unknown API Error';

        setError(errorMsg);
        setOutput(null);
        setModalContent(null);
        setResponseModalOpen(false);
      }

      return data || (res.ok ? { success: true } : null);
    } catch (err) {
      if (!options.silent) {
        setError(err.message || String(err));
        setLastCall((prev) => ({
          ...prev,
          status: 'Failed',
          durationMs: Math.round(performance.now() - startedAt),
        }));
      }
      // Return a structured object even on network failure to prevent downstream crashes
      if (options.silent) return { success: false, error: err.message };
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
    if (!rig || !mrrClient) return;

    // Resolve the specific client (BT or SL) from the rig metadata if the global filter is 'ALL'
    const targetClient = (mrrClient === 'ALL' && rig.mrrClient) ? rig.mrrClient : mrrClient;
    if (targetClient === 'ALL') return;

    // Support both rig object and raw ID (fallback)
    const rigObj = typeof rig === 'object' ? rig : { id: rig };
    const statusStr = String(typeof rigObj.status === 'object' ? rigObj.status.status : rigObj.status || '').toLowerCase();
    const isRented = statusStr.includes('rented');

    // Correctly distinguish between the physical Rig ID and the Rental ID (Rig Card ID)
    // When rented, the 'id' field is often the rental ID. The physical rig ID is in 'rigid' or 'rig.id'.
    const rigId = String(rigObj.rigid || rigObj.rig_id || rigObj.rig?.id || (isRented ? '' : rigObj.id)).trim();
    const rentalId = String(rigObj.rentalid || rigObj.current_rental_id || rigObj.rental_id || (isRented ? rigObj.id : '')).trim();

    // Logic: Always fetch pool of the physical rig id, not the rig card (rental) id.
    if (!rigId) return;

    const path = `/api/v2/mrr/rig/${encodeURIComponent(rigId)}/pool`;
    const result = await handleMiningCall(path, { query: { client: targetClient }, silent: true });

    setMrrPoolData(result);
    setMrrPoolRigId(rigId);

    if (isRented) {
      setMrrPoolRentalId(rentalId);
    } else {
      setMrrPoolRentalId('');
    }
  }, [handleMiningCall, mrrClient]);

  return (
    <RentedRigProvider nhClient={nhClient} callApi={callApi}>
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
            <h3>Ben Tre Mining Tool</h3>
            <div className="status-card" style={{ marginBottom: '2px' }}>
              <div className="status-item">
                <span style={{ opacity: 0.5, marginRight: '10px' }}>SYSTEM:</span>
                <span className={`status-value ${loading ? 'status-ready' : error ? 'status-error' : 'status-success'}`}>
                  {loading ? 'Loading...' : error ? 'Error' : 'Ready'}
                </span>
              </div>
            </div>
          </div>
        </header>
        <section
          className="pools-section"
          style={{
            marginBottom: '15px',
            marginTop: '0px',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '16px',
            padding: '24px',
            height: '700px',
            minHeight: '200px'
          }}
        >
          <Pools niceHashData={output} mrrClient={mrrClient} setMrrClient={setMrrClient} nhClient={nhClient} setNhClient={setNhClient} />
        </section>
        <main className="dashboard">
          <RentedRigsSummarySection />

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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Actions</h3>
                  <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>Open the hashrate calculator in a popup modal.</p>
                </div>
                <button className="btn-pro secondary" onClick={() => setCalculatorModalOpen(true)} style={{ whiteSpace: 'nowrap' }}>
                  Open Calculator
                </button>
              </div>
              {/* <article className="panel">
              <div style={{ marginTop: '5px' }}>
                <HashpowerBot
                  algorithm={algorithm}
                  market={market}
                  onCall={handleHashpowerCall}
                  nhClient={nhClient}
                  setNhClient={setNhClient}
                />
              </div>
            </article> */}
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
            </article>
          </section>
        </main>
        <Modal
          isOpen={calculatorModalOpen}
          onClose={() => setCalculatorModalOpen(false)}
          title="Hashrate Calculator"
          maxWidth="700px"
        >
          <HashrateCalculator />
        </Modal>
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
    </RentedRigProvider>
  );
}

/** Helper sub-component to display the rented rigs from context */
function RentedRigsSummarySection() {
  const { rentedRigs, summary, loading } = useRentedRigs();

  if (rentedRigs.length === 0 && !loading) return null;

  return (
    <section style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>Active Rented Power</h3>
        <div style={{ fontSize: '0.9rem' }}>
          Total Paid: <span style={{ color: '#f3ba2f', fontWeight: 'bold' }}>{summary.totalPaid} BTC</span>
          <span style={{ margin: '0 10px', opacity: 0.3 }}>|</span>
          Orders: <b>{summary.count}</b>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '8px' }}>
        {loading && <p>Updating rented orders...</p>}
        {rentedRigs.map(rig => <RentedRigCard key={rig.id} order={rig} />)}
      </div>
    </section>
  );
}