import { useCallback, useState } from 'react';
import { useApi } from './src/hooks/useApi';
import AppHeader from './src/components/AppHeader';
import ApiResponseModal from './src/components/ApiResponseModal';
import Pools from './src/components/Pools';
import HashpowerBot from './src/components/HashpowerBot';
import NiceHash from './src/components/NiceHash';
import MiningRigSection from './src/components/MiningRigSection';
import HashrateCalculator from './src/components/HashrateCalculator';
import MrrPoolsManager from './src/components/MrrPoolsManager';
import './src/App.css';

export default function App() {
  // Centralized API and Modal State Logic
  const api = useApi();

  // Shared UI configuration state
  const [algorithm, setAlgorithm] = useState('');
  const [market, setMarket] = useState('');
  const [mrrClient, setMrrClient] = useState('BT');
  const [mrrPoolData, setMrrPoolData] = useState(null);
  const [mrrPoolRigId, setMrrPoolRigId] = useState('');
  const [mrrPoolRentalId, setMrrPoolRentalId] = useState('');

  // Typed API wrappers for better organization
  const handleMiningCall = useCallback((path, opts = {}) =>
    api.callApi(path, { ...opts, section: 'mining' }), [api.callApi]);

  const handleHashpowerCall = useCallback((path, opts = {}) =>
    api.callApi(path, { ...opts, section: 'hashpower' }), [api.callApi]);

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
      <AppHeader loading={api.loading} error={api.error} />

      <main className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '32px' }}>
        {/* NiceHash & Bot Column */}
        <section className="dashboard-column">
          <div className="column-stack" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <article className="panel">
              <NiceHash output={api.output} onCall={handleMiningCall} algorithm={algorithm} market={market} />
            </article>
            <article className="panel">
              <HashpowerBot algorithm={algorithm} market={market} onCall={handleHashpowerCall} />
            </article>
            <article className="panel">
              <HashrateCalculator />
            </article>
          </div>
        </section>

        {/* MRR Management Column */}
        <section className="dashboard-column">
          <article className="panel">
            <MiningRigSection onCall={handleMiningCall} mrrClient={mrrClient} setMrrClient={setMrrClient} onOpenMrrPools={handleOpenMrrPools} />
          </article>
          <article className="panel" style={{ marginTop: '32px' }}>
            <MrrPoolsManager onCall={handleMiningCall} mrrClient={mrrClient} externalPoolData={mrrPoolData} externalRigId={mrrPoolRigId} externalRentalId={mrrPoolRentalId} />
          </article>
        </section>
      </main>

      {/* Global Bottom Section */}
      <section className="full-width-section" style={{ marginTop: '40px', borderTop: '1px solid #333', paddingTop: '40px' }}>
        <Pools niceHashData={api.output} mrrClient={mrrClient} setMrrClient={setMrrClient} />
      </section>

      <ApiResponseModal
        isOpen={api.responseModalOpen}
        onClose={() => api.setResponseModalOpen(false)}
        lastCall={api.lastCall}
        content={api.modalContent || api.output}
      />
    </div>
  );
}
