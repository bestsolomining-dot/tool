import { useEffect, useState } from 'react';
import Modal from './Modal';
import { MrrPoolsTable, CountdownTimer } from './MiningRigRental'; // Import CountdownTimer

function formatHashrateValue(rate) {
  if (!rate) return '0 N/A';
  if (typeof rate === 'string' || typeof rate === 'number') return String(rate);
  if (rate.nice) return rate.nice;
  const hash = rate.hash ?? 0;
  const parsed = Number.parseFloat(hash);
  const displayHash = Number.isFinite(parsed) ? parsed.toFixed(2) : String(hash);
  return `${displayHash} ${String(rate.type || '').toUpperCase()}`.trim();
}

export default function MrrPoolsManager({ onCall, mrrClient, externalPoolData = null, externalRigId = '', externalRentalId = '' }) {
  const [rigId, setRigId] = useState('');
  const [rentalId, setRentalId] = useState('');
  const [poolData, setPoolData] = useState(null);
  const [rentalInfo, setRentalInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mrrMethod, setMrrMethod] = useState('GET');
  const [mrrEndpoint, setMrrEndpoint] = useState('/rig/mine');
  const [mrrBody, setMrrBody] = useState('');

  useEffect(() => {
    if (externalPoolData) {
      setPoolData(externalPoolData);
    }
  }, [externalPoolData]);

  useEffect(() => {
    if (externalRigId) setRigId(String(externalRigId));
  }, [externalRigId]);

  const fetchRentalInfo = async (id = null) => {
    const targetId = String(id || rentalId).trim();
    if (!targetId || targetId === 'undefined') return;

    setLoading(true);
    setRentalInfo(null);
    try {
      const result = await onCall(`/api/v2/mrr/rental/${encodeURIComponent(targetId)}`, { 
        query: { client: mrrClient }, 
        silent: true 
      });
      if (result && result.success) {
        // Extract the rental object from the MRR response wrapper
        const info = result.data || result;

        // Additionally fetch pool info to display in status modal
        const poolRes = await onCall(`/api/v2/mrr/rental/${encodeURIComponent(targetId)}/pool`, { 
          query: { client: mrrClient }, 
          silent: true 
        });
        if (poolRes && poolRes.success) {
          info.pools = Array.isArray(poolRes.data) ? poolRes.data : (poolRes.data?.pools || poolRes.pools || []);
        }

        setRentalInfo(info);
        setIsModalOpen(true);
      } else {
        // Error will be handled by parent App.jsx's setError
      }
    } catch (err) {
      // Error will be handled by parent App.jsx's setError
    } finally {
      setLoading(false);
    }
  };

  const fetchPools = async (type, id = null) => {
    if (!mrrClient) {
      setPoolData({ success: false, message: "Please select a specific client for this action." });
      return;
    }

    setLoading(true);
    setPoolData(null);
    try {
      let path;
      if (type === 'all_rigs') {
        path = '/api/v2/mrr/rigs/pools';
      } else if (type === 'rig') {
        const targetId = id || rigId.trim();
        path = `/api/v2/mrr/rig/${encodeURIComponent(targetId)}/pool`;
      } else if (type === 'rental') {
        const targetId = id || rentalId.trim();
        path = `/api/v2/mrr/rental/${encodeURIComponent(targetId)}/pool`;
      }

      const result = await onCall(path, { query: { client: mrrClient }, silent: true });
      setPoolData(result);
    } catch (err) {
      setPoolData({ success: false, message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const callMrrFunction = () => {
    const endpoint = mrrEndpoint.trim();
    if (!endpoint) return;

    let parsedBody;
    if (mrrBody.trim()) {
      try {
        parsedBody = JSON.parse(mrrBody);
      } catch {
        window.alert('Invalid JSON body');
        return;
      }
    }

    onCall('/api/v2/mrr/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: mrrClient,
        method: mrrMethod,
        endpoint,
        body: parsedBody,
      }),
    });
  };

  useEffect(() => {
    if (externalRigId) setRigId(String(externalRigId));
  }, [externalRigId]);

  useEffect(() => {
    if (externalRentalId) {
      const id = String(externalRentalId);
      setRentalId(id);
      fetchRentalInfo(id);
    }
  }, [externalRentalId]);

  return (
    <div className="mrr-pools-manager nh-theme" style={{ marginTop: '20px', padding: '20px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="panel-header" style={{ marginBottom: '15px' }}>
        <h3 style={{ margin: 0 }}>MRR Pool Manager</h3>
        <button className="btn-pro primary" onClick={() => fetchPools('all_rigs')} disabled={loading}>
          {loading ? 'Fetching...' : 'Get All Rig Pools'}
        </button>
      </div>

      <div className="market-inputs" style={{ gap: '10px', marginBottom: '15px' }}>
        <input
          className="input-pro"
          placeholder="Specific Rig ID"
          value={rigId}
          onChange={(e) => setRigId(e.target.value)}
        />
        <button
          className="btn-pro secondary"
          disabled={!rigId.trim() || loading}
          onClick={() => fetchPools('rig')}
        >
          Fetch Rig Pools
        </button>
      </div>

      <div className="market-inputs" style={{ gap: '10px' }}>
        <input
          className="input-pro"
          placeholder="Specific Rental ID"
          value={rentalId}
          onChange={(e) => setRentalId(e.target.value)}
        />
        <button
          className="btn-pro secondary"
          disabled={!rentalId.trim() || loading}
          onClick={() => fetchPools('rental')}
        >
          Fetch Rental Pools
        </button>
        <button
          className="btn-pro"
          style={{ background: '#744b71' }}
          disabled={!rentalId.trim() || loading}
          onClick={fetchRentalInfo}
        >
          Fetch Status
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '20px', opacity: 0.6 }}>Fetching pool configurations...</div>}

      {poolData && (
        <div className="pool-results-container" style={{ fontSize: '12px', marginTop: '20px', maxHeight: '600px', maxWidth: '480px', overflowY: 'auto' }}>
          {poolData.success === false ? (
            <div className="error-message">{poolData.message}</div>
          ) : (
            <MrrPoolsTable data={poolData} />
          )}
        </div>
      )}

      {/* Rented Status Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`Rental Status: #${rentalInfo?.id}`}
        maxWidth="500px"
      >
        {rentalInfo && (
          <div style={{ padding: '0 10px 10px' }}>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 8px 0', color: '#f8fafc', fontSize: '1.1rem' }}>
                {rentalInfo.name || `Rental #${rentalInfo.id}`}
              </h3>
              <span style={{
                display: 'inline-block', padding: '4px 12px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold',
                color: '#20775a', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)'
              }}>
                {String(rentalInfo.status || 'RENTED').toUpperCase()}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              <div className="stat-box" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px' }}>
                <div style={{ fontSize: '9px', opacity: 0.5, marginBottom: '4px', textTransform: 'uppercase' }}>Algorithm</div>
                <div style={{ fontWeight: 'bold', color: '#60a5fa' }}>{rentalInfo.rig?.type || rentalInfo.algo || rentalInfo.normalized?.algo || 'N/A'}</div>
              </div>
              <div className="stat-box" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px' }}>
                <div style={{ fontSize: '9px', opacity: 0.5, marginBottom: '4px', textTransform: 'uppercase' }}>Advertised Hashrate</div>
                <div style={{ fontWeight: 'bold', color: '#34d399' }}>{formatHashrateValue(rentalInfo.hashrate?.advertised)}</div>
              </div>
              <div className="stat-box" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px' }}>
                <div style={{ fontSize: '9px', opacity: 0.5, marginBottom: '4px', textTransform: 'uppercase' }}>Price</div>
                <div style={{ fontWeight: 'bold', color: '#fbbf24' }}>
                  {(() => {
                    const p = rentalInfo?.price || rentalInfo?.rig?.price;
                    const cur = (p && typeof p === 'object' && p.currency) || rentalInfo?.currency || rentalInfo?.price_unit || 'BTC';
                    
                    let val = (p && typeof p === 'object') ? (p.paid || p.price || p.advertised) : p;
                    // Handle rig-style objects where price is nested under currency keys (e.g. p.BTC.price)
                    if (p && typeof p === 'object' && !val && p[cur]) val = p[cur].price || p[cur].paid;
                    val = val || '0.00';

                    // Prevent repeating the currency if it's already in the value string
                    if (String(val).toUpperCase().includes(String(cur).toUpperCase())) return val;
                    return `${val} ${cur}`;
                  })()}
                </div>
              </div>
              <div className="stat-box" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px' }}>
                <div style={{ fontSize: '9px', opacity: 0.5, marginBottom: '4px', textTransform: 'uppercase' }}>Type</div>
                <div style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>{rentalInfo.normalized?.type || rentalInfo.price_type || 'Day'}</div>
              </div>
              <div className="stat-box" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px' }}>
                <div style={{ fontSize: '9px', opacity: 0.5, marginBottom: '4px', textTransform: 'uppercase' }}>Efficiency</div>
                <div style={{ fontWeight: 'bold', color: '#f59e0b' }}>{rentalInfo.hashrate?.average?.percent || rentalInfo.normalized?.percent || '0'}%</div>
              </div>
              <div className="stat-box" style={{ gridColumn: 'span 2', background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px' }}>
                <div style={{ fontSize: '9px', opacity: 0.5, marginBottom: '4px', textTransform: 'uppercase' }}>Time To End</div>
                <div style={{ fontWeight: 'bold', fontSize: '12px' }}>
                  <CountdownTimer endTime={rentalInfo.end || rentalInfo.normalized?.endTime} />
                </div>
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '6px', fontSize: '11px', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ marginBottom: '8px' }}><span style={{ opacity: 0.8 }}>Rental</span> {rentalInfo.id || rentalInfo.rental_id}</div>
              <div style={{ marginBottom: '14px' }}><span style={{ opacity: 0.8 }}>Rig ID:</span> {rentalInfo.normalized?.rigId || rentalInfo.rig?.id || rentalInfo.rigid || 'N/A'}</div>
              <div>
                <span style={{ opacity: 0.6 }}>Duration:</span> {rentalInfo.normalized?.duration || rentalInfo.length || rentalInfo.hours || '0'} Hours
              </div>
            </div>
            {rentalInfo.pools && rentalInfo.pools.length > 0 && (
              <div style={{ frontSize: '8px', marginTop: '20px', maxHeight: '100px', overflowY: 'auto', paddingRight: '1px' }}>
                <MrrPoolsTable data={{ pools: rentalInfo.pools }} />
              </div>
            )}
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button className="btn-pro secondary" onClick={() => setIsModalOpen(false)}>Dismiss</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
