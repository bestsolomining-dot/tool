import { useCallback, useEffect, useState, useRef } from 'react';
import Pools from './src/components/Pools';
import Modal from './src/components/Modal';
import HashpowerBot from './src/components/HashpowerBot';
import NiceHash from './src/components/NiceHash';
import MiningRigRental from './src/components/MiningRigRental';
import MiningRigSection from './src/components/MiningRigSection';
import HashrateCalculator from './src/components/HashrateCalculator';
import MrrPoolsManager from './src/components/MrrManager';
import Login from './src/components/Login';
import HeroMinersCard from './src/components/HeroMinersCard';
import { RentedRigProvider } from './src/components/RentedRigContext';
import CryptoRatePage from './src/components/CryptoRatePage';
import './src/App.css';

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [poolData, setPoolData] = useState(null);
  const [niceHashData, setNiceHashData] = useState(null);
  const [rigsData, setRigsData] = useState(null);

  // State for authentication token, initialized from localStorage
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('token'));

  const [lastCall, setLastCall] = useState(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [calculatorModalOpen, setCalculatorModalOpen] = useState(false);
  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  const addDebugLog = useCallback((msg, type = 'info') => {
    console.log(`[DEBUG:${type.toUpperCase()}] ${msg}`);
    setDebugLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  }, []);
  const [algorithm, setAlgorithm] = useState('');
  const [market, setMarket] = useState('');
  const [nhOrderClient, setNhOrderClient] = useState('VN');
  const [nhPoolClient, setNhPoolClient] = useState('BT');
  const [mrrClient, setMrrClient] = useState('VN');
  const [mrrPoolData, setMrrPoolData] = useState(null);
  const [mrrPoolRigId, setMrrPoolRigId] = useState('');
  const [mrrPoolRentalId, setMrrPoolRentalId] = useState('');
  const [view, setView] = useState(window.location.pathname === '/cryptorate' ? 'cryptorate' : 'dashboard');

  useEffect(() => {
    const handlePath = () => setView(window.location.pathname === '/cryptorate' ? 'cryptorate' : 'dashboard');
    window.addEventListener('popstate', handlePath);
    return () => window.removeEventListener('popstate', handlePath);
  }, []);

  const apiCache = useRef(new Map());
  const inFlightRequests = useRef(new Map());

  // Function to handle successful login (stores token)
  const handleLoginSuccess = useCallback((token) => {
    localStorage.setItem('token', token);
    setAuthToken(token);
    addDebugLog('Login successful, token stored.', 'success');
    // Optionally, trigger a refresh of data after login
    forceCheckStatus(); // This will be called implicitly by effects if needed
  }, [addDebugLog]);

  // Function to handle logout (clears token)
  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    setAuthToken(null);
    addDebugLog('Logged out, token cleared.', 'info');
    // Clear all sensitive data and potentially redirect to login page
    setNiceHashData(null);
    setPoolData(null);
    setRigsData(null);
    setError('');
    // window.history.pushState({}, '', '/login'); // Example: navigate to login page
  }, [addDebugLog]);

  const callApi = useCallback(async (path, options = {}) => {
    const startedAt = performance.now();
    const method = options.method || 'GET';
    const { query, section, ...fetchOptions } = options;
    const isSilent = !!options.silent || !!options.background;

    // Use the authToken state variable for consistent token handling
    const token = authToken;
    const headers = { 
      ...fetchOptions.headers,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
    let body = fetchOptions.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      body = JSON.stringify(body);
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    // Prepare base query parameters
    const enrichedQuery = { ...query };
    const isPriceReq = path.includes('/order/price');

    if (path.startsWith('/api/v2/') && !enrichedQuery.client) {
      
      const isPoolReq = path.includes('/pools') || section === 'pools';
      // Don't add default client for price lookups to improve caching and avoid NiceHash parameter rejection
      if (!isPriceReq) enrichedQuery.client = isPoolReq ? nhPoolClient : nhOrderClient;
    }

    // Generate Cache Key (excluding dynamic 'ts' which changes every call)
    const queryEntriesForCache = Object.entries(enrichedQuery).filter(([k]) => k !== 'ts').sort();
    const cacheQueryPart = queryEntriesForCache.map(([k, v]) => `${k}=${v}`).join('&');
    // Include token in cache key to differentiate cached responses for different users
    const cacheKey = `${method}:${path}:${cacheQueryPart}:${body || ''}:${token || ''}`;

    // 1. Deduplication: Only apply to GET requests to avoid swallowing mutations (POST/PUT/DELETE)
    if (method === 'GET' && inFlightRequests.current.has(cacheKey)) {
      addDebugLog(`Deduplicating overlapping call: ${path}`, 'api');
      return inFlightRequests.current.get(cacheKey);
    }

    // 2. Cache: For GET requests, return cached data if fresh (10s TTL)
    if (method === 'GET' && !options.noCache) {
      const cached = apiCache.current.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 10000) {
        addDebugLog(`Serving ${path} from cache`, 'api');
        if (cached.data && !isSilent) updateSectionState(section, cached.data);
        return Promise.resolve(cached.data);
      }
    }

    // Final Path construction for the network request (adding cache-busting 'ts')
    let finalPath = path;
    // Skip automatic ts for price requests as some NiceHash endpoints are strict about query params
    if (path.startsWith('/api/v2/') && !enrichedQuery.ts && !isPriceReq) {
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

    addDebugLog(`API Call: ${method} ${finalPath}`, 'api');

    if (!isSilent) {
      setActiveSection(section || null);
      setLoading(true);
      setError('');
    }

    if (!isSilent) {
      setLastCall({ method, path: finalPath, status: 'Pending', durationMs: null });
    }

    const apiBase = '';
    const requestPromise = (async () => {
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

        if (!isSilent) {
          setLastCall({
            method,
            path: finalPath,
            status: `${res.status} ${res.statusText}`,
            durationMs: Math.round(performance.now() - startedAt),
          });
        }

        if (res.status === 401) {
          const isProxyFailure = data?.msg?.includes('Invalid Key') || data?.message?.includes('Invalid Key');
          if (!isProxyFailure) {
            addDebugLog('Session expired or invalid (401). Clearing token.', 'error');
            handleLogout();
          }
        }

        const isAppError = !res.ok || (data && typeof data === 'object' && (data.success === false || data.error || data.errors));
        
        if (isAppError) {
          addDebugLog(`API Error ${res.status}: ${JSON.stringify(data)}`, 'error');
        } else {
          addDebugLog(`Response ${res.status} from ${path}`, 'success');
        }

        if (!isAppError && (res.status === 304 || res.ok) && res.status !== 401) {
          setError('');
          if (options.showModal) {
            setModalContent(data || { success: true });
            setResponseModalOpen(true);
          }
          // Always attempt to update state based on path if section is missing
          const detectedSection = section || (
            path.includes('/pools') ? 'pools' :
            (path.includes('/mining') || path.includes('/hashpower')) ? 'mining' :
            path.includes('/rigs') ? 'rigs' : ''
          );
          updateSectionState(detectedSection, data);
        } else if (!isSilent) {
          const errorMsg =
            typeof data === 'string' && data.length > 0
              ? data
              : data?.errors?.[0]?.message || data?.error || data?.message || data?.data?.message || res.statusText || 'Unknown API Error';

          if (options.showModal) {
            setModalContent(data || { error: errorMsg });
            setResponseModalOpen(true);
          }
        }

        // Cache successful GET responses
        if (!isAppError && method === 'GET' && data) {
          apiCache.current.set(cacheKey, { data, timestamp: Date.now() });
        }

        return data || (res.ok ? { success: true } : null);
      } catch (err) {
        let errorMsg = err.message || String(err);

        // Handle generic network errors that mean the server is down
        if (errorMsg.includes('Failed to fetch') || errorMsg.includes('ERR_CONNECTION_REFUSED')) {
          errorMsg = 'Backend server unreachable. Please ensure the Node.js process is running.';
        }

        if (!options.silent) {
          setError(errorMsg);
          setLastCall((prev) => ({
            ...prev,
            status: 'Failed',
            durationMs: Math.round(performance.now() - startedAt),
          }));
        }

        // Return a structured object even on network failure to prevent downstream crashes
        if (options.silent) return { success: false, error: errorMsg };
        throw err;
      } finally {
        inFlightRequests.current.delete(cacheKey);
        if (!isSilent) setLoading(false);
      }
    })();

    inFlightRequests.current.set(cacheKey, requestPromise);
    return requestPromise;
  }, [nhOrderClient, authToken, addDebugLog, handleLogout]); // Added authToken and handleLogout to dependencies

  const updateSectionState = (section, data) => {
    if (section === 'pools') setPoolData(data);
    else if (section === 'mining') setNiceHashData(data);
    else if (section === 'rigs') setRigsData(data);
    // If no specific section, we check paths or default
    else if (!section && niceHashData === null) setNiceHashData(data);
  };

  const forceCheckStatus = useCallback(async () => {
    addDebugLog('Force checking system status...', 'warn');
    setLoading(true);
    try {
      await callApi('/api/v2/mining/address', { silent: true });
      addDebugLog('System status check complete.', 'success');
    } finally {
      setLoading(false);
    }
  }, [callApi, addDebugLog]); // No change here, callApi now implicitly uses authToken

  // Clear output when switching accounts to prevent showing stale data
  useEffect(() => {
    setNiceHashData(null);
    setPoolData(null);
    setRigsData(null);
    setError('');
    if (authToken) {
      addDebugLog(`Account switch detected. nhOrderClient: ${nhOrderClient}, mrrClient: ${mrrClient}`);
      // Background silent fetch to populate main dashboard data for new account
      callApi('/api/v2/mining/address', { silent: true, background: true, section: 'mining' });
    }
  }, [nhOrderClient, mrrClient, callApi, addDebugLog, authToken]);

  useEffect(() => {
    addDebugLog('App initialized. Current origin: ' + (window.location.origin || 'local'));
  }, [addDebugLog]);

  // Setup periodic silent background updates for dashboard data (Balance, etc)
  useEffect(() => {
    const intervalId = setInterval(() => { // Only fetch if authenticated
      if (nhOrderClient && authToken) {
        callApi('/api/v2/mining/address', { silent: true, background: true, section: 'mining' });
      }
    }, 60000); // 60 seconds
    return () => clearInterval(intervalId); // Added authToken to dependencies
  }, [nhOrderClient, authToken, callApi]);

  const handleMiningCall = useCallback((path, opts = {}) => {
    return callApi(path, { ...opts, section: 'mining' });
  }, [callApi]);

  const handleOpenMrrPools = useCallback(async (rig) => {
    if (!rig || !mrrClient) return;

    // Resolve the specific client (BT or SL) from the rig metadata if the global filter is 'VN'
    const targetClient = (mrrClient === 'VN' && rig.mrrClient) ? rig.mrrClient : mrrClient;
    if (targetClient === 'VN') return;

    // Support both rig object and raw ID (fallback)
    const rigObj = typeof rig === 'object' ? rig : { id: rig };
    const statusStr = String(typeof rigObj.status === 'object' ? rigObj.status.status : rigObj.status || '').toLowerCase();
    const isRented = statusStr.includes('rented');

    // Correctly distinguish between the physical Rig ID and the Rental ID (Rig Card ID)
    // When rented, the 'id' field is often the rental ID. The physical rig ID is in 'rigid' or 'rig.id'.
    const rigId = String(rigObj.rigid || rigObj.rig_id || rigObj.rig?.id || (isRented ? '' : rigObj.id)).trim();
    const rentalId = String(rigObj.rentalid || rigObj.current_rental_id || rigObj.rental_id || (isRented ? rigObj.id : '')).trim();

    addDebugLog(`Opening MRR pools for rig: ${rigId} (Rental: ${rentalId})`, 'info');
    // Logic: Always fetch pool of the physical rig id, not the rig card (rental) id.
    if (!rigId) return;

    // Use the rig-specific pool endpoint to avoid 404 errors for Rig IDs
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
  }, [handleMiningCall, mrrClient, addDebugLog]); // Added addDebugLog to dependencies

  // Guard: Show login screen if not authenticated to prevent background 401s
  if (!authToken) {
    return <Login onLoginSuccess={handleLoginSuccess} onCall={callApi} />;
  }

  // Simple path routing
  if (view === 'cryptorate') {
    return (
      <div className="app-shell" style={{ background: '#0f172a', minHeight: '100vh' }}>
        <div style={{ padding: '20px' }}>
          <button className="btn-pro secondary" onClick={() => { window.history.pushState({}, '', '/'); setView('dashboard'); }}>
            ← Back to Dashboard
          </button>
        </div>
        <CryptoRatePage onCall={callApi} />
      </div>
    );
  }

  return (
    <RentedRigProvider nhClient={nhOrderClient} callApi={callApi}>
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
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button className="text-button" onClick={forceCheckStatus} style={{ fontSize: '10px' }}>Force Check</button>
                <button className="text-button" onClick={() => setDebugModalOpen(true)} style={{ fontSize: '10px' }}>Debug Logs</button>
                {/* Added temporary Login/Logout buttons for demonstration */}
                {authToken && (
                  <button className="text-button" onClick={handleLogout} style={{ fontSize: '10px' }}>Logout</button>
                )}
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
            height: '850px',
            minHeight: '200px'
          }}
        >
          <Pools 
            onCall={callApi}
            poolData={poolData}
            niceHashData={niceHashData} 
            mrrClient={mrrClient} 
            setMrrClient={setMrrClient} 
            nhClient={nhPoolClient} 
            setNhClient={setNhPoolClient} 
          />
        </section>
        <main className="dashboard">
          <section className="quick-actions">
            <div className="column-stack" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <article className="panel">
                <NiceHash
                  key={nhOrderClient}
                  onCall={handleMiningCall}
                  output={niceHashData}
                  algorithm={algorithm}
                  market={market}
                  nhClient={nhOrderClient}
                  setNhClient={setNhOrderClient}
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
                <button className="btn-pro secondary" onClick={() => { window.history.pushState({}, '', '/cryptorate'); setView('cryptorate'); }}>
                  Live Rates
                </button>
              </div>
            </div>
            <article className="panel">
                <MiningRigSection
                  onCall={handleMiningCall}
                  rigsData={rigsData}
                  mrrClient={mrrClient}
                  setMrrClient={setMrrClient}
                  onOpenMrrPools={handleOpenMrrPools}
                />
              </article>
            <article className="panel">
              <HeroMinersCard mrrClient={mrrClient} onCall={callApi} />
            </article>
          </section>
        </main>

        <Modal
          isOpen={responseModalOpen}
          onClose={() => setResponseModalOpen(false)}
          title="API Operation Result"
          maxWidth="800px"
        >
          {lastCall && (
            <div style={{ marginBottom: '15px', opacity: 0.7, fontSize: '11px', fontFamily: 'monospace' }}>
              {lastCall.method} {lastCall.path} — {lastCall.status} ({lastCall.durationMs}ms)
            </div>
          )}
          <pre className="response-body" style={{ maxHeight: '50vh', overflow: 'auto' }}>
            {JSON.stringify(modalContent, null, 2)}
          </pre>
        </Modal>

        {/* MRR Pool Configuration Modal */}
        {(mrrPoolData || mrrPoolRigId) && (
          <MrrPoolsManager
            onCall={handleMiningCall}
            mrrClient={mrrClient}
            externalPoolData={mrrPoolData}
            externalRigId={mrrPoolRigId}
            externalRentalId={mrrPoolRentalId}
            onClose={() => {
              setMrrPoolData(null);
              setMrrPoolRigId('');
              setMrrPoolRentalId('');
            }}
          />
        )}

        <Modal
          isOpen={calculatorModalOpen}
          onClose={() => setCalculatorModalOpen(false)}
          title="Hashrate Calculator"
          maxWidth="700px"
        >
          <HashrateCalculator />
        </Modal>
        <Modal
          isOpen={debugModalOpen}
          onClose={() => setDebugModalOpen(false)}
          title="System Debug Logs"
          maxWidth="800px"
        >
          <div className="code-block-content" style={{ maxHeight: '60vh', overflow: 'auto', fontSize: '11px', fontFamily: 'monospace' }}>
            {debugLogs.length === 0 && <div style={{ opacity: 0.5 }}>No logs captured yet.</div>}
            {debugLogs.map((log, i) => <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{log}</div>)}
          </div>
          <div className="modal-actions"><button className="btn-pro secondary" onClick={() => setDebugLogs([])}>Clear Logs</button></div>
        </Modal>
      </div>
    </RentedRigProvider>
  );
}