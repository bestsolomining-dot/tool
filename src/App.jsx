import { useCallback, useState, useEffect } from 'react';
import Pools from './components/Pools';
import Modal from './components/Modal';
import './App.css';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [configStatus, setConfigStatus] = useState({ loading: true, ready: false });
  const [password, setPassword] = useState('');
  const [setupData, setSetupData] = useState({
    NICEHASH_API_KEY: '',
    NICEHASH_API_SECRET: '',
    NICEHASH_ORG_ID: '',
    APP_PASSWORD: 'admin'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState(null);
  const [lastCall, setLastCall] = useState(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);

  const callApi = useCallback(async (path, options = {}) => {
    const startedAt = performance.now();
    const method = options.method || 'GET';
    const { query, ...fetchOptions } = options;
    let finalPath = path;
    const enrichedQuery = { ...query };

    if (path.startsWith('/api/v2/')) {
      if (!enrichedQuery.ts) enrichedQuery.ts = Date.now();
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

    const apiBase = import.meta.env.VITE_API_URL || (window.location.port === '5173'
      ? `${window.location.protocol}//${window.location.hostname}:3000`
      : '');

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
  }, []);

  useEffect(() => {
    const checkConfig = async () => {
      try {
        const status = await callApi('/api/config-status', { silent: true });
        if (status && typeof status === 'object') {
          setConfigStatus({ loading: false, ready: !!status?.nicehash, data: status });
        } else {
          // Fallback if API returns empty or invalid
          throw new Error("Invalid config response");
        }
      } catch {
        console.warn("Backend configuration check failed (404 or Network Error). Defaulting to setup mode.");
        setConfigStatus({ loading: false, ready: false });
      }
    };
    checkConfig();
  }, [callApi]);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const data = await callApi('/api/login', { method: 'POST', body: { password } });
      if (data?.success) setIsAuthenticated(true);
      else setError('Invalid password');
    } catch (err) {
      setError('Login failed');
    }
  };

  const handleSetup = async (e) => {
    e.preventDefault();
    try {
      await callApi('/api/update-config', { method: 'POST', body: { config: setupData } });
      window.location.reload();
    } catch (err) {
      setError('Failed to save config');
    }
  };

  const handleMiningCall = useCallback((path, opts = {}) => {
    return callApi(path, { ...opts });
  }, [callApi]);

  if (configStatus.loading) return <div className="loader-fullscreen">Checking System Config...</div>;

  if (!configStatus.ready) {
    return (
      <div className="login-container">
        <form onSubmit={handleSetup} className="card login-card">
          <h2>Initial Setup</h2>
          <p>Provide your API credentials to begin.</p>
          <input type="text" placeholder="NiceHash API Key" className="input-pro" value={setupData.NICEHASH_API_KEY} onChange={e => setSetupData({...setupData, NICEHASH_API_KEY: e.target.value})} required />
          <input type="password" placeholder="NiceHash API Secret" className="input-pro" value={setupData.NICEHASH_API_SECRET} onChange={e => setSetupData({...setupData, NICEHASH_API_SECRET: e.target.value})} required />
          <input type="text" placeholder="NiceHash Org ID" className="input-pro" value={setupData.NICEHASH_ORG_ID} onChange={e => setSetupData({...setupData, NICEHASH_ORG_ID: e.target.value})} required />
          <input type="password" placeholder="Set Dashboard Password" className="input-pro" value={setupData.APP_PASSWORD} onChange={e => setSetupData({...setupData, APP_PASSWORD: e.target.value})} required />
          <button type="submit" className="btn-pro primary">Save & Initialize</button>
          {error && <p className="error-message">{error}</p>}
        </form>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="login-container">
        <form onSubmit={handleLogin} className="card login-card">
          <h2>BT Tool Login</h2>
          <input type="password" name="password" className="input-pro" placeholder="App Password" value={password} onChange={e => setPassword(e.target.value)} autoFocus />
          <button type="submit" className="btn-pro primary">Unlock Dashboard</button>
          {error && <p className="error-message">{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <h3>BT Tool</h3>
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
