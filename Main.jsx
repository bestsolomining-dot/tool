import { useCallback, useEffect, useState, useRef } from 'react';
import Pools from './src/components/Pools';
import Modal from './src/components/Modal';
import HashpowerBot from './src/components/HashpowerBot';
import NiceHash from './src/components/NiceHash';
import MiningRigRental from './src/components/MiningRigRental';
import MiningRigSection from './src/components/MiningRigSection';
import HashrateCalculator from './src/components/HashrateCalculator';
import HashCompletionCalculator from './src/components/HashCompletionCalculator';
import MrrPoolsManager from './src/components/MrrManager';
import Login from './src/components/Login';
import HeroMinersCard from './src/components/HeroMinersCard';
import MiningCoin from './src/components/MiningCoin.jsx';
import { HASHRATE_SUFFIXES, normalizeAlgoForNiceHash, getAlgorithmUnit } from './src/core/mapping';
import { RentedRigProvider } from './src/components/NiceHashContext';
import './src/App.css';

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState(null);
  
  // Auth state initialized from localStorage
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('token'));

  const [lastCall, setLastCall] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [calculatorModalOpen, setCalculatorModalOpen] = useState(false);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [algorithm, setAlgorithm] = useState('');
  const [market, setMarket] = useState('');
  const [nhClient, setNhClient] = useState('BT');
  const [mrrClient, setMrrClient] = useState('VN');
  const [mrrPoolData, setMrrPoolData] = useState(null);
  const [mrrPoolRigId, setMrrPoolRigId] = useState('');
  const [mrrPoolRentalId, setMrrPoolRentalId] = useState('');
  const [completionCalculatorContext, setCompletionCalculatorContext] = useState(null);

  const inFlightRequests = useRef(new Map());

  const handleLoginSuccess = useCallback((token) => {
    localStorage.setItem('token', token);
    setAuthToken(token);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    setAuthToken(null);
    setOutput(null);
    setMrrPoolData(null);
    setError('');
  }, []);

  const toDateTimeLocal = (value) => {
    if (!value) return '';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';
    const offsetMs = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  };

  const parseHashrateValue = (value) => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') {
      const parsed = parseFloat(value.replace(/,/g, ''));
      return Number.isFinite(parsed) ? String(parsed) : '';
    }
    if (typeof value === 'object') {
      return parseHashrateValue(value.hash || value.advertised || value.nice || value.value || Object.values(value)[0]);
    }
    return '';
  };

  const inferUnitValue = (source) => {
    const unitMap = { EH: 1e18, PH: 1e15, TH: 1e12, GH: 1e9, MH: 1e6, KH: 1e3, H: 1 };
    if (source === undefined || source === null) return 1e12;
    if (typeof source === 'number' && Number.isFinite(source)) return source;
    const normalized = String(source).toUpperCase().replace(/\s+/g, '');
    const match = normalized.match(/(EH|PH|TH|GH|MH|KH|H)(?:\/S)?$/) || normalized.match(/(EH|PH|TH|GH|MH|KH|H)/);
    if (match && match[1]) return unitMap[match[1]] || 1e12;
    return 1e12;
  };

  const openCompletionCalculator = useCallback((rig, info = {}) => {
    const algo = info?.algo || rig?.algo || rig?.algorithm || rig?.type || '';
    const start = toDateTimeLocal(info?.startTime || rig?.start || (typeof rig?.status === 'object' ? rig.status.start : '') || '');
    const end = toDateTimeLocal(info?.endTime || rig?.end || (typeof rig?.status === 'object' ? rig.status.end : '') || '');
    const adsHashrate = parseHashrateValue(info?.advertised || rig?.hashrate?.advertised || rig?.advertised || rig?.hashrate?.hash || rig?.hash || '');
    const avgHashrate = parseHashrateValue(info?.average || rig?.hashrate?.average || rig?.average || rig?.hash || '');
    const nhAlgo = normalizeAlgoForNiceHash(algo);
    const unit = HASHRATE_SUFFIXES[getAlgorithmUnit(nhAlgo)]; // Use HASHRATE_SUFFIXES directly with the algorithm's unit
    const nhPriceData = info?.nicehashPrice || rig?.nicehashPrice;
    const rawPrice = info?.price || rig?.price || rig?.min_price || null;
    const priceSource = rawPrice?.paid !== undefined
      ? { paid: rawPrice.paid, currency: rawPrice.currency || rawPrice.price_unit || 'BTC' }
      : rawPrice;
    const btcPriceSource = info?.price_converted || rig?.price_converted || info?.price?.BTC || rig?.price?.BTC || priceSource;
    const priceUnit = getAlgorithmUnit(nhAlgo); // This is the string unit

    setCompletionCalculatorContext({
      initialAlgo: algo,
      initialStartTime: start,
      initialEndTime: end,
      initialAdsHashrate: adsHashrate,
      initialAvgHashrate: avgHashrate,
      initialUnit: unit,
      initialPriceSource: priceSource,
      initialBtcPriceSource: btcPriceSource,
      initialPriceUnit: priceUnit,
      initialNhPriceData: nhPriceData,
    });
    setCompletionModalOpen(true);
  }, []);

  const scrollToPools = useCallback(() => {
    const poolsEl = document.querySelector('.pools-section');
    if (poolsEl) poolsEl.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const callApi = useCallback(async (path, options = {}) => {
    const startedAt = performance.now();
    const method = options.method || 'GET';
    const { query, section, silent, ...fetchOptions } = options;
    const isSilent = !!silent;

    // Prepare headers with Auth Token
    const token = authToken;
    const headers = { 
      ...fetchOptions.headers,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };

    let finalPath = path;
    const enrichedQuery = { ...query };
    if (path.startsWith('/api/v2/') && !path.startsWith('/api/v2/mrr/')) {
      if (!enrichedQuery.ts) enrichedQuery.ts = Date.now();
      if (!enrichedQuery.client) {
        enrichedQuery.client = nhClient;
      }
    }

    // Ensure body is stringified before key calculation to prevent [object Object] collisions
    let body = fetchOptions.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      body = JSON.stringify(body);
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    // Deduplication check
    const cacheKey = `${method}:${path}:${JSON.stringify(enrichedQuery)}:${body || ''}:${authToken || ''}`;
    if (method === 'GET' && inFlightRequests.current.has(cacheKey)) {
      return inFlightRequests.current.get(cacheKey);
    }

    if (Object.keys(enrichedQuery).length > 0) {
      const params = new URLSearchParams();
      Object.entries(enrichedQuery).forEach(([key, value]) => {
        if (value !== undefined && value !== null) params.append(key, String(value));
      });
      const qs = params.toString();
      if (qs) finalPath += (finalPath.includes('?') ? '&' : '?') + qs;
    }

    if (!isSilent) {
      setActiveSection(section || null);
      setLoading(true);
      setError('');
      setLastCall({ method, path: finalPath, status: 'Pending', durationMs: null });
    }

    const requestPromise = (async () => {
      let data = null;
      try {
        const res = await fetch(finalPath, {
          ...fetchOptions,
          method,
          headers,
          body,
          mode: 'cors',
          credentials: 'omit',
        });

        if (res.status === 401) {
          handleLogout();
          return null;
        }

        if (res.status !== 204) {
          const text = await res.text();
          try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        }

        if (!isSilent) {
          setLastCall({
            method,
            path: finalPath,
            status: `${res.status} ${res.statusText}`,
            durationMs: Math.round(performance.now() - startedAt),
          });
        }

        const isAppError = !res.ok || (data && (data.success === false || data.error || data.errors)); // Check for common error indicators

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
            typeof data === 'string' ?
              (data.trim().startsWith('<') ?
                'API returned an invalid (HTML) response.' :
                data
              )
              : data?.errors?.[0]?.message || data?.error || data?.message || data?.data?.message || res.statusText || 'Unknown API Error';

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
    })();

    if (method === 'GET') {
      inFlightRequests.current.set(cacheKey, requestPromise);
    }

    try {
      return await requestPromise;
    } finally {
      if (method === 'GET') {
        inFlightRequests.current.delete(cacheKey);
      }
    }
  }, [authToken, handleLogout, nhClient]);

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
    
    // Inject rig name into the pool response data so the Pool Manager UI can display it
    if (result && result.success && result.data && rigObj.name) {
      const items = Array.isArray(result.data) ? result.data : [result.data];
      items.forEach(item => {
        if (item && !item.name) item.name = rigObj.name;
      });
    }

    setMrrPoolData(result);
    setMrrPoolRigId(rigId);

    if (isRented) {
      setMrrPoolRentalId(rentalId);
    } else {
      setMrrPoolRentalId('');
    }
  }, [handleMiningCall, mrrClient]);

  if (!authToken) {
    return <Login onLoginSuccess={handleLoginSuccess} onCall={callApi} />;
  }

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
          {/* <h3>Ben Tre Mining Tool</h3> */}
          <div className="status-card" style={{ marginBottom: '2px' }}>
            <div className="status-item">
              <span style={{ opacity: 0.5, marginRight: '10px' }}>SYSTEM:</span>
              <span className={`status-value ${loading ? 'status-ready' : error ? 'status-error' : 'status-success'}`}>
                {loading ? 'Loading...' : error ? 'Error' : 'Ready'}
              </span>
            </div>
            <div style={{ marginTop: '10px' }}>
              <button className="btn-pro secondary" onClick={handleLogout} style={{ fontSize: '10px' }}>Logout</button>
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
          height: '12800px',
          minHeight: '700px'
        }}
      >
        <Pools 
          onCall={callApi}
          niceHashData={output} 
          mrrClient={mrrClient} 
          setMrrClient={setMrrClient} 
          nhClient={nhClient} 
          setNhClient={setNhClient} 
        />
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Quick Actions</h3>
                <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>Unit conversions and rental projections.</p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn-pro secondary" onClick={() => {
                  setCompletionCalculatorContext(null);
                  setCompletionModalOpen(true);
                }} style={{ whiteSpace: 'nowrap' }}>
                  Completion Calc
                </button>
                <button className="btn-pro secondary" onClick={() => setCalculatorModalOpen(true)} style={{ whiteSpace: 'nowrap' }}>
                  Unit Converter
                </button>
              </div>
            </div>
          </div>
          <article className="panel">
            <MiningRigSection
              onCall={handleMiningCall}
              mrrClient={mrrClient}
              setMrrClient={setMrrClient}
              onOpenMrrPools={handleOpenMrrPools}
            />
          </article>
          <article className="panel" style={{ maxHeight: '800px', overflowY: 'auto' }}>
            <MrrPoolsManager
              onCall={handleMiningCall}
              mrrClient={mrrClient}
              externalPoolData={mrrPoolData}
              externalRigId={mrrPoolRigId}
              externalRentalId={mrrPoolRentalId}
              onClose={() => setMrrPoolData(null)}
            />
          </article>
          <article className="panel">
            <HeroMinersCard mrrClient={mrrClient} onCall={callApi} />
          </article>
          <article className="panel">
            <MiningCoin onCall={callApi} nhClient={nhClient} />
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
        isOpen={completionModalOpen}
        onClose={() => setCompletionModalOpen(false)}
        title="Rental Completion Calculator"
        maxWidth="750px"
      >
        <HashCompletionCalculator {...completionCalculatorContext} />
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
