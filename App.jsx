import { useCallback, useEffect, useState, useRef, useMemo, useReducer } from 'react';
import Login from './src/components/Login';
import Dashboard from './src/components/Dashboard';
import MiningPage from './src/components/MiningPage.jsx';
import { RentedRigProvider } from './src/components/RentedRigContext.jsx';
import CryptoRatePage from './src/components/CryptoRatePage';
import './src/App.css';

// ============================================
// REDUCER FOR STATE MANAGEMENT
// ============================================
const initialState = {
  loading: false,
  error: '',
  poolData: null,
  rigsData: null,
  niceHashData: null,
  lastCall: null,
  modalContent: null,
  responseModalOpen: false,
  calculatorModalOpen: false,
  debugModalOpen: false,
  debugLogs: [],
  algorithm: '',
  market: '',
  nhOrderClient: 'VN',
  nhPoolClient: 'BT',
  mrrClient: 'BT',
  view: (typeof window !== 'undefined' && window.location.pathname === '/mining')
    ? 'mining'
    : (typeof window !== 'undefined' && window.location.pathname === '/cryptorate')
      ? 'cryptorate'
      : 'dashboard',
  activeDashboard: 'nicehash',
};

function appReducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_POOL_DATA':
      return { ...state, poolData: action.payload };
    case 'SET_RIGS_DATA':
      return { ...state, rigsData: action.payload };
    case 'SET_NICEHASH_DATA':
      return { ...state, niceHashData: action.payload };
    case 'SET_LAST_CALL':
      return { ...state, lastCall: action.payload };
    case 'SET_MODAL':
      return { ...state, modalContent: action.payload.content, responseModalOpen: action.payload.open };
    case 'SET_CALCULATOR_MODAL':
      return { ...state, calculatorModalOpen: action.payload };
    case 'SET_DEBUG_MODAL':
      return { ...state, debugModalOpen: action.payload };
    case 'ADD_DEBUG_LOG':
      return { 
        ...state, 
        debugLogs: [`[${new Date().toLocaleTimeString()}] ${action.payload}`, ...state.debugLogs].slice(0, 50)
      };
    case 'CLEAR_DEBUG_LOGS':
      return { ...state, debugLogs: [] };
    case 'SET_ALGORITHM':
      return { ...state, algorithm: action.payload };
    case 'SET_MARKET':
      return { ...state, market: action.payload };
    case 'SET_NH_ORDER_CLIENT':
      return { ...state, nhOrderClient: action.payload };
    case 'SET_NH_POOL_CLIENT':
      return { ...state, nhPoolClient: action.payload };
    case 'SET_MRR_CLIENT':
      return { ...state, mrrClient: action.payload };
    case 'SET_VIEW':
      return { ...state, view: action.payload };
    case 'SET_ACTIVE_DASHBOARD':
      return { ...state, activeDashboard: action.payload };
    case 'RESET_STATE':
      return { ...initialState, view: state.view, nhOrderClient: state.nhOrderClient };
    default:
      return state;
  }
}

// ============================================
// CACHE MANAGEMENT
// ============================================
class ApiCache {
  constructor() {
    this.cache = new Map();
    this.inflight = new Map();
    this.maxSize = 100;
    this.ttl = 30000; // 30 seconds default
  }

  get(key) {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.ttl) {
      return entry.data;
    }
    this.cache.delete(key);
    return null;
  }

  set(key, data, ttl = this.ttl) {
    // Limit cache size
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { data, timestamp: Date.now(), ttl });
  }

  clear() {
    this.cache.clear();
  }

  getInflight(key) {
    return this.inflight.get(key);
  }

  setInflight(key, promise) {
    this.inflight.set(key, promise);
    return promise;
  }

  deleteInflight(key) {
    this.inflight.delete(key);
  }

  clearInflight() {
    this.inflight.clear();
  }
}

// ============================================
// MAIN APP COMPONENT
// ============================================
export default function App() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const apiCache = useRef(new ApiCache());
  const authTokenRef = useRef(() => localStorage.getItem('token'));
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('token'));
  const isMounted = useRef(true);
  const backgroundIntervalRef = useRef(null);

  // ============================================
  // MEMOIZED SELECTORS
  // ============================================
  const isAuthenticated = useMemo(() => !!authToken, [authToken]);

  // ============================================
  // DEBUG LOGGING
  // ============================================
  const addDebugLog = useCallback((msg, type = 'info') => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEBUG:${type.toUpperCase()}] ${msg}`);
    }
    dispatch({ type: 'ADD_DEBUG_LOG', payload: msg });
  }, []);

  // ============================================
  // AUTH HANDLERS
  // ============================================
  const handleLoginSuccess = useCallback((token) => {
    localStorage.setItem('token', token);
    setAuthToken(token);
    addDebugLog('Login successful, token stored.', 'success');
  }, [addDebugLog]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    setAuthToken(null);
    apiCache.current.clear();
    apiCache.current.clearInflight();
    dispatch({ type: 'RESET_STATE' });
    addDebugLog('Logged out, token cleared.', 'info');
  }, [addDebugLog]);

  // ============================================
  // API CALL WITH PERFORMANCE OPTIMIZATIONS
  // ============================================
  const callApi = useCallback(async (path, options = {}) => {
    const startedAt = performance.now();
    const method = options.method || 'GET';
    const { query, section, silent = false, background = false, noCache = false } = options;

    // Skip if not authenticated and path requires auth
    if (!authToken && !path.includes('/auth/')) {
      addDebugLog('No auth token, skipping API call', 'warn');
      return { success: false, error: 'Not authenticated' };
    }

    const headers = {
      ...options.headers,
      ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
    };

    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      body = JSON.stringify(body);
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    // Build query string
    const enrichedQuery = { ...query };
    const isPriceReq = path.includes('/order/price');
    if (path.startsWith('/api/v2/') && !enrichedQuery.client && !isPriceReq) {
      const isPoolReq = path.includes('/pools') || section === 'pools';
      enrichedQuery.client = isPoolReq ? state.nhPoolClient : state.nhOrderClient;
    }

    // Generate cache key
    const queryEntries = Object.entries(enrichedQuery)
      .filter(([k]) => k !== 'ts')
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const cacheKey = `${method}:${path}:${queryEntries}:${body || ''}:${authToken || ''}`;

    // Deduplicate inflight requests (GET only)
    if (method === 'GET') {
      const inflight = apiCache.current.getInflight(cacheKey);
      if (inflight) {
        addDebugLog(`Deduplicating: ${path}`, 'api');
        return inflight;
      }
    }

    // Check cache (GET only, not for price requests which are highly dynamic)
    if (method === 'GET' && !noCache && !isPriceReq) {
      const cached = apiCache.current.get(cacheKey);
      if (cached) {
        addDebugLog(`Cache hit: ${path}`, 'api');
        if (!silent) updateSectionState(section, cached);
        return cached;
      }
    }

    // Build final path
    let finalPath = path;
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

    addDebugLog(`API: ${method} ${finalPath}`, 'api');

    if (!silent) {
      dispatch({ type: 'SET_LOADING', payload: true });
      dispatch({ type: 'SET_ERROR', payload: '' });
    }

    const requestPromise = (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

        const res = await fetch(finalPath, {
          ...options,
          method,
          headers,
          body,
          mode: 'cors',
          credentials: 'omit',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        let data = null;
        if (res.status !== 204 && res.status !== 205) {
          const text = await res.text();
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = text;
          }
        }

        const duration = Math.round(performance.now() - startedAt);
        dispatch({
          type: 'SET_LAST_CALL',
          payload: { method, path: finalPath, status: `${res.status} ${res.statusText}`, durationMs: duration }
        });

        // Handle 401 - unauthorized
        if (res.status === 401) {
          const isProxyFailure = data?.msg?.includes('Invalid Key') || data?.message?.includes('Invalid Key');
          if (!isProxyFailure) {
            addDebugLog('Session expired (401), logging out', 'error');
            handleLogout();
          }
          return { success: false, error: 'Unauthorized' };
        }

        // Check for API errors
        const isError = !res.ok || (data && typeof data === 'object' && 
          (data.success === false || data.error || data.errors));

        if (isError) {
          const errorMsg = typeof data === 'string' ? data :
            data?.errors?.[0]?.message || data?.error || data?.message || res.statusText;
          addDebugLog(`API Error ${res.status}: ${errorMsg}`, 'error');
          if (!silent) dispatch({ type: 'SET_ERROR', payload: errorMsg });
          if (options.showModal) {
            dispatch({ type: 'SET_MODAL', payload: { content: data || { error: errorMsg }, open: true } });
          }
          return { success: false, error: errorMsg };
        }

        // Success
        if (!silent) dispatch({ type: 'SET_ERROR', payload: '' });

        if (options.showModal && data) {
          dispatch({ type: 'SET_MODAL', payload: { content: data, open: true } });
        }

        // Update section state
        const detectedSection = section || (
          path.includes('/pools') ? 'pools' :
          path.includes('/mining') || path.includes('/hashpower') ? 'mining' :
          path.includes('/rigs') ? 'rigs' : ''
        );
        updateSectionState(detectedSection, data);

        // Cache successful GET responses (not price requests)
        if (method === 'GET' && data && !isPriceReq) {
          const ttl = path.includes('/pools') || path.includes('/algorithms') ? 300000 : 30000;
          apiCache.current.set(cacheKey, data, ttl);
        }

        return data || { success: true };
      } catch (err) {
        let errorMsg = err.message || String(err);
        if (err.name === 'AbortError') {
          errorMsg = 'Request timeout (30s)';
        } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('ERR_CONNECTION_REFUSED')) {
          errorMsg = 'Backend server unreachable. Please ensure the server is running.';
        }

        if (!silent) {
          dispatch({ type: 'SET_ERROR', payload: errorMsg });
          dispatch({
            type: 'SET_LAST_CALL',
            payload: { method, path: finalPath, status: 'Failed', durationMs: Math.round(performance.now() - startedAt) }
          });
        }

        return { success: false, error: errorMsg };
      } finally {
        apiCache.current.deleteInflight(cacheKey);
        if (!silent) dispatch({ type: 'SET_LOADING', payload: false });
      }
    })();

    // Store inflight request
    if (method === 'GET') {
      apiCache.current.setInflight(cacheKey, requestPromise);
    }

    return requestPromise;
  }, [authToken, state.nhOrderClient, state.nhPoolClient, addDebugLog, handleLogout]);

  // ============================================
  // STATE UPDATE HELPER
  // ============================================
  const updateSectionState = useCallback((section, data) => {
    if (!data) return;
    switch (section) {
      case 'pools':
        dispatch({ type: 'SET_POOL_DATA', payload: data });
        break;
      case 'rigs':
        dispatch({ type: 'SET_RIGS_DATA', payload: data });
        break;
      case 'mining':
        dispatch({ type: 'SET_NICEHASH_DATA', payload: data });
        break;
      default:
        if (state.niceHashData === null) {
          dispatch({ type: 'SET_NICEHASH_DATA', payload: data });
        }
        break;
    }
  }, [state.niceHashData]);

  // ============================================
  // FORCE CHECK STATUS
  // ============================================
  const forceCheckStatus = useCallback(async () => {
    addDebugLog('Force checking system status...', 'warn');
    try {
      await callApi('/api/v2/mining/address', { silent: true, noCache: true });
      addDebugLog('System status check complete.', 'success');
    } catch (err) {
      addDebugLog(`Status check failed: ${err.message}`, 'error');
    }
  }, [callApi, addDebugLog]);

  // ============================================
  // HANDLERS
  // ============================================
  const handleMiningCall = useCallback((path, opts = {}) => {
    return callApi(path, { ...opts, section: 'mining' });
  }, [callApi]);

  const handleOpenMrrPools = useCallback(() => {
    // Placeholder for MRR pools modal
    addDebugLog('Opening MRR pools modal', 'info');
  }, [addDebugLog]);

  const setNhOrderClient = useCallback((client) => {
    dispatch({ type: 'SET_NH_ORDER_CLIENT', payload: client });
  }, []);

  const setNhPoolClient = useCallback((client) => {
    dispatch({ type: 'SET_NH_POOL_CLIENT', payload: client });
  }, []);

  const setMrrClient = useCallback((client) => {
    dispatch({ type: 'SET_MRR_CLIENT', payload: client });
  }, []);

  // ============================================
  // EFFECTS
  // ============================================
  
  // Route handling
  useEffect(() => {
    const handlePath = () => {
      const path = window.location.pathname;
      dispatch({
        type: 'SET_VIEW',
        payload: path === '/cryptorate' ? 'cryptorate' : path === '/mining' ? 'mining' : 'dashboard',
      });
    };
    window.addEventListener('popstate', handlePath);
    handlePath();
    return () => window.removeEventListener('popstate', handlePath);
  }, []);

  // Initial load - fetch data
  useEffect(() => {
    if (isAuthenticated) {
      addDebugLog('App initialized, fetching initial data', 'info');
      forceCheckStatus();
      
      // Fetch pools and rigs in parallel
      Promise.all([
        callApi('/api/v2/pools', { silent: true, section: 'pools' }),
        callApi('/api/v2/mining/rigs2', { silent: true, section: 'mining' }),
      ]).catch(err => addDebugLog(`Initial fetch error: ${err.message}`, 'error'));
    }
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Background refresh interval
  useEffect(() => {
    if (isAuthenticated) {
      backgroundIntervalRef.current = setInterval(() => {
        // Only refresh if not already loading
        if (!state.loading) {
          callApi('/api/v2/mining/address', { silent: true, background: true, section: 'mining' });
          callApi('/api/v2/pools', { silent: true, background: true, section: 'pools', noCache: true });
        }
      }, 60000); // 60 seconds
    }

    return () => {
      if (backgroundIntervalRef.current) {
        clearInterval(backgroundIntervalRef.current);
        backgroundIntervalRef.current = null;
      }
    };
  }, [isAuthenticated, callApi, state.loading]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
      apiCache.current.clear();
      apiCache.current.clearInflight();
    };
  }, []);

  // ============================================
  // RENDER
  // ============================================
  
  // Login screen
  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} onCall={callApi} />;
  }

  // CryptoRate view
  if (state.view === 'cryptorate') {
    return (
      <div className="app-shell" style={{ background: '#0f172a', minHeight: '100vh' }}>
        <div style={{ padding: '16px 20px' }}>
          <button 
            className="btn-pro secondary" 
            onClick={() => {
              window.history.pushState({}, '', '/');
              dispatch({ type: 'SET_VIEW', payload: 'dashboard' }); // Navigate home
            }}
          >
            ← Back to Dashboard
          </button>
        </div>
        <CryptoRatePage onCall={callApi} />
      </div>
    );
  }

  if (state.view === 'mining') {
    return (
      <RentedRigProvider callApi={callApi}>
        <MiningPage
          onCall={callApi}
          nhClient={state.nhOrderClient}
          onNavigateHome={() => {
            window.history.pushState({}, '', '/');
            dispatch({ type: 'SET_VIEW', payload: 'dashboard' });
          }}
        />
      </RentedRigProvider>
    );
  }

  // ============================================
  // DASHBOARD
  // ============================================
  return (
    <RentedRigProvider callApi={callApi}>
      <Dashboard
        state={state}
        dispatch={dispatch}
        callApi={callApi}
        handleLogout={handleLogout}
        forceCheckStatus={forceCheckStatus}
        handleMiningCall={handleMiningCall}
        handleOpenMrrPools={handleOpenMrrPools}
        setNhOrderClient={setNhOrderClient}
        setNhPoolClient={setNhPoolClient}
        setMrrClient={setMrrClient}
      />
    </RentedRigProvider>
  );
}
