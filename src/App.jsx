import { useCallback, useMemo, useState } from 'react';
import Pools from './components/Pools';
import Modal from './components/Modal';
import HashrateCalculator from './components/HashrateCalculator';
import HashpowerBot from './components/HashpowerBot';
import NiceHash from './components/NiceHash';
import MiningRigRental from './components/MiningRigRental';
import { createApiClient } from './core/apiClient';
import './App.css';

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState(null);
  const [lastCall, setLastCall] = useState(null);
  const [responseModalOpen, setResponseModalOpen] = useState(false);
  const [calculatorModalOpen, setCalculatorModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [algorithm, setAlgorithm] = useState('');
  const [market, setMarket] = useState('');
  const [mrrClient, setMrrClient] = useState('BT');

  const callApi = useMemo(() => createApiClient({
    onState: ({ type, payload }) => {
      if (type === 'request-start') {
        setLoading(true);
        setError('');
        setLastCall({ method: payload.method, path: payload.path, status: 'Pending', durationMs: null });
        return;
      }
      if (type === 'request-finish') {
        setLastCall(payload);
        return;
      }
      if (type === 'request-success') {
        setError('');
        if (payload.status === 304) {
          setModalContent({
            status: payload.status,
            message: payload.statusText,
            note: 'Content not modified. Displaying previously fetched data if available.',
          });
        } else {
          setOutput(payload.data);
          setModalContent(payload.data || { success: true });
        }
        setResponseModalOpen(true);
        return;
      }
      if (type === 'request-error') {
        setError(payload.errorMsg);
        if (payload.showModal) {
          setModalContent(payload.data || { error: payload.errorMsg, status: payload.status });
          setResponseModalOpen(true);
        } else {
          setOutput(null);
          setModalContent(null);
          setResponseModalOpen(false);
        }
        return;
      }
      if (type === 'request-failed') {
        setError(payload.error);
        setLastCall(prev => ({ ...(prev || {}), status: 'Failed', durationMs: payload.durationMs }));
        return;
      }
      if (type === 'request-end') {
        setLoading(false);
      }
    }
  }), []);

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
