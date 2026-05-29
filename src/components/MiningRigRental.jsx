import { useState, useCallback, useEffect, useRef } from 'react';
import MrrRigs from './MrrRigs';
import Modal from './Modal';

/** Safely extracts an array from various MRR API response shapes */
function extractArray(payload, keys = ['rentals', 'rigs', 'list', 'result', 'items', 'data']) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  // If payload.data is an object, recurse once to look for keys inside the envelope
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return extractArray(payload.data, keys);
  }
  return [];
}

function calculateRemainingTime(endTime) {
  if (!endTime) return null;
  const normalizedEndTime = /\bUTC\b/i.test(String(endTime)) ? String(endTime) : `${endTime} UTC`;
  const end = new Date(normalizedEndTime);
  if (Number.isNaN(end.getTime())) return 'Expired';
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();

  if (diffMs <= 0) return 'Expired';

  const diffSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(diffSeconds / (3600 * 24));
  const hours = Math.floor((diffSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;

  let parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`); // Always show seconds if no other unit or if it's the only unit

  return parts.join(' ');
}

export function CountdownTimer({ endTime }) {
  const [remaining, setRemaining] = useState(() => calculateRemainingTime(endTime));
  const timerRef = useRef(null);

  useEffect(() => {
    if (!endTime) {
      setRemaining(null);
      return;
    }

    const updateCountdown = () => {
      const newRemaining = calculateRemainingTime(endTime);
      setRemaining(newRemaining);
      if (newRemaining === 'Expired') {
        clearInterval(timerRef.current);
      }
    };

    // Initial update
    updateCountdown();

    // Set up interval for subsequent updates
    timerRef.current = setInterval(updateCountdown, 1000);

    // Cleanup on unmount
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [endTime]);

  if (!remaining) return <span style={{ opacity: 0.6 }}>N/A</span>;

  const isExpired = remaining === 'Expired';
  return <span style={{ color: isExpired ? '#f87171' : '#a78bfa' }}>{remaining}</span>;
}

/** Structured view for active rentals */
function MrrRentalsTable({ data }) {
  // MRR API v2 GET /rental returns { "success": true, "data": { "rentals": [...] } }
  // OR sometimes the array is directly at data.data: { "success": true, "data": [...] }
  
  // Detect errors: check for failure flag, explicit error string, or plain error message
  const isError = !data || 
                 (typeof data === 'string' && data.length > 0 && !data.startsWith('{')) || 
                 (typeof data === 'object' && data.success === false) || 
                 data.error;

  if (isError) {
    const errMsg = typeof data === 'string' ? data : (data?.error || data?.message || data?.data?.message || 'Unauthorized or API Error');
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ color: '#f87171', marginBottom: '10px', fontWeight: 'bold', fontSize: '1.2rem' }}>
          {String(errMsg).includes('401') || errMsg === 'Unauthorized' ? 'Authentication Failed (401)' : 'Data Fetch Error'}
        </div>
        <div style={{ opacity: 0.8, fontSize: '13px', maxWidth: '500px', margin: '0 auto' }}>{errMsg}</div>
        <p style={{ marginTop: '20px', fontSize: '11px', opacity: 0.5 }}>Ensure MRR_KEY_RIG_BT and MRR_SECRET_RIG_BT are set correctly in your .env file.</p>
      </div>
    );
  }

  const rentals = extractArray(data);

  if (!Array.isArray(rentals) || !rentals.length) return <div style={{ padding: '30px', textAlign: 'center', opacity: 0.5 }}>No active rentals found.</div>;

  return (
    <div className="table-responsive">
      <table className="pro-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name / ID</th>
            <th>Algo</th>
            <th>Hashrate</th>
            <th>Price</th>
            <th>Duration</th>
            <th>Remaining</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rentals.map(r => (
            <tr key={r.id}>
              <td style={{ fontFamily: 'monospace', color: '#94a3b8', fontSize: '11px' }}>{r.id}</td>
              <td style={{ fontWeight: 'bold' }}>
                {r.rig?.name || r.name || r.rig_name || r.rigName || 'N/A'}{' '}
                <small style={{ opacity: 0.5, fontWeight: 'normal' }}>
                  #{r.rig?.id || r.rigid || r.rig_id || r.rigId || r.id}
                </small>
              </td>
              <td style={{ color: '#60a5fa' }}>{r.rig?.type || r.algo || r.algorithm || r.miningAlgorithm || 'N/A'}</td>
              <td style={{ fontFamily: 'monospace' }}>
                {r.hashrate?.advertised?.nice || (typeof r.hashrate === 'object' ? r.hashrate?.advertised : r.hashrate) || '0'} 
                <small>{!r.hashrate?.advertised?.nice && (r.hashrate?.suffix || '')}</small>
              </td>
              <td style={{ color: '#fbbf24' }}>
                {typeof r.price === 'object' ? (r.price?.paid || r.price?.advertised || r.price?.price || '0.00') : (r.price || '0.00')} {r.price?.currency || r.currency || r.price_unit || r.price_currency || 'BTC'}
              </td>
              <td style={{ opacity: 0.8 }}>
                {r.hours || r.length || '0'}h
              </td>
              <td>
                <CountdownTimer endTime={r.end} />
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <span className={String(r.status?.status || r.status || '').toLowerCase().includes('active') || String(r.status?.status || r.status || '').toLowerCase().includes('rented') ? 'status-success' : 'status-ready'}>
                  {String(r.status?.status || r.status || '').toUpperCase().includes('ACTIVE') ? 'RENTED' : (r.status?.status || r.status || (r.end ? 'FINISHED' : 'READY'))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Structured view for Rig Pools */
export function MrrPoolsTable({ data }) {
  // Expect data to be the direct API response (unwrapped by App.jsx's callApi)
  // It can be a single object { pools: [...] } or an array of such objects for bulk requests.
  if (!data || (typeof data === 'object' && !Array.isArray(data) && data.success === false) || data.error) {
    const errMsg = typeof data === 'string' ? data : (data?.error || data?.message || data?.data?.message || 'Failed to fetch pool data');
    return (
      <div style={{ padding: '30px', textAlign: 'center' }}>
        <div style={{ color: '#f87171', fontWeight: 'bold' }}>Pool Data Error</div>
        <div style={{ opacity: 0.7, fontSize: '12px', marginTop: '5px' }}>{errMsg}</div>
      </div>
    );
  }

  // Normalize pool results into an array of objects containing a 'pools' property
  const rawResults = extractArray(data, ['pools', 'data', 'result']);
  
  // If the extracted array contains objects that are pools themselves (flat list), wrap them
  const results = rawResults.length > 0 && !rawResults[0].pools && (rawResults[0].user || rawResults[0].host || rawResults[0].stratumHost)
    ? [{ id: 'Pools', pools: rawResults }]
    : rawResults;
  
  if (!results.length) return <div style={{ padding: '30px', textAlign: 'center', opacity: 0.5 }}>No pool data found.</div>;

  return (
    <div className="mrr-pools-modal-content">
      {results.map((res, idx) => (
        <div key={res.rigId || res.id || idx} style={{ marginBottom: '25px', borderBottom: '1px solid #333', paddingBottom: '15px' }}>
          <h4 style={{ color: '#ff1cbb', margin: '25px 5px 10px 0' }}>{res.rigId ? `Rig ID: ${res.rigId}` : res.id ? `Rental ID: ${res.id}` : 'Target ID: N/A'}</h4>
          <table className="pro-table">
            <thead>
              <tr><th>Priority</th><th>Host</th><th>Worker</th><th>Algo</th></tr>
            </thead>
            <tbody>
              {(Array.isArray(res.pools) ? res.pools : (Array.isArray(res) ? res : [])).map((p, pIdx) => (
                <tr key={pIdx}>
                  <td>{p.priority}</td>
                  <td>{p.host || p.stratumHost}</td>
                  <td style={{ fontWeight: 'bold' }}>{p.user || p.username}</td>
                  <td>{p.algo || p.algorithm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export default function MiningRigRental({ onCall, mrrClient, setMrrClient, algorithm, showRentalsInline = false, onOpenMrrPools }) {
  const [activeModal, setActiveModal] = useState(null); // 'list', 'pool', 'rental'
  const [modalData, setModalData] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);

  const [rentals, setRentals] = useState([]);
  const [loadingRentals, setLoadingRentals] = useState(false);
  
  // Notification State
  const [newRentalFound, setNewRentalFound] = useState(null);
  const knownRentalIds = useRef(new Set());

  const fetchActiveRentals = useCallback(async () => {
    if (!mrrClient || mrrClient === 'ALL' || loadingRentals) {
      setRentals([]);
      knownRentalIds.current.clear();
      return;
    }
    setLoadingRentals(true);
    try {
      const result = await onCall('/api/v2/mrr/rentals', { query: { client: mrrClient }, silent: true });
      if (result?.success) {
        const newList = extractArray(result);
        
        // Detect new rentals
        if (knownRentalIds.current.size > 0) {
          const fresh = newList.find(r => !knownRentalIds.current.has(String(r.id)));
          if (fresh) {
            setNewRentalFound(fresh);
            // Optionally trigger a system notification
            if (Notification.permission === 'granted') {
              new Notification(`Rig Rented: ${fresh.name || fresh.id}`, { body: `New rental active for ${fresh.hours}h` });
            }
          }
        }
        
        // Update known IDs
        newList.forEach(r => knownRentalIds.current.add(String(r.id)));
        setRentals(newList);
      }
    } catch (err) {
      console.error("Auto Fetch Rentals Error:", err);
    } finally {
      setLoadingRentals(false);
    }
  }, [mrrClient, onCall]);

  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
    fetchActiveRentals();
  }, [fetchActiveRentals]);

  const openManagementModal = async (type, id = null) => { // id is for specific rig actions
    setActiveModal(type);
    if (type === 'list') return; // MrrRigs fetches its own data

    if ((!mrrClient || mrrClient === 'ALL') && (type === 'rental' || type === 'rental_history')) {
      setModalData({ success: false, message: "Client 'ALL' is not supported for this action. Please select a specific client." });
      setModalLoading(false);
      return;
    }

    setModalLoading(true);
    setModalData(null);
    try {
      let path;
      let clientToUse = mrrClient;

      if (type === 'list_all_rigs') {
        path = '/api/v2/mrr/rig/all';
      } else if (type === 'rental') {
        path = '/api/v2/mrr/rentals';
      } else if (type === 'rental_history') {
        path = '/api/v2/mrr/rental/history';
      }

      
      const result = await onCall(path, { query: { client: clientToUse }, silent: true });
      setModalData(result);
    } catch (err) {
      console.error("MRR Modal Error:", err);
      setModalData({ success: false, message: err.message || String(err) });
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <div className="rig-section nh-theme" style={{ marginLeft: '5px', marginRight: '5px', marginTop: '5px', paddingTop: '5px', paddingBottom: '5px' }}>
      <h2 className="section-title" style={{paddingBottom: '10px' }}>Mining Rig Rentals</h2>
      {/* Client Selector */}
      <div className="market-inputs">
        <select className="select-pro" value={mrrClient || 'BT'} onChange={(e) => setMrrClient(e.target.value)}>
          <option value="BT">Client: BT</option>
          <option value="SL">Client: SL</option>
          <option value="ALL">Client: ALL</option>
        </select>
      </div>

      {/* Dashboard Actions */}
      <div className="button-group" style={{ marginTop: '10px' }}>
        <button className="btn-pro primary" onClick={() => openManagementModal('list_all_rigs')}>
          Browse Marketplace
        </button>
        {/* <button className="btn-pro secondary" onClick={() => openManagementModal('list')}>My Rigs Manager</button> */}
        {/* <button className="btn-pro secondary" onClick={() => openManagementModal('rental')}>
          Rentals {rentals.length > 0 && `(${rentals.length})`}
        </button> */}
        {/* <button className="btn-pro secondary" onClick={() => openManagementModal('list_all_rigs')}>Marketplace Status</button>
        <button className="btn-pro secondary" onClick={() => openManagementModal('rental_history')}>Rental History</button> */}
        <button className="btn-pro secondary" onClick={() => onCall('/api/v2/mrr/balance', { query: { client: mrrClient }, showModal: true })}>Balance</button>
      </div>

      {/* New Rental Notification Modal */}
      <Modal 
        isOpen={!!newRentalFound} 
        onClose={() => setNewRentalFound(null)} 
        title="🚀 New Rig Rented!" 
        maxWidth="500px"
      >
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <div style={{ 
            width: '60px', height: '60px', background: 'rgba(16, 185, 129, 0.2)', 
            borderRadius: '50%', display: 'flex', alignItems: 'center', 
            justifyContent: 'center', margin: '0 auto 20px', color: '#10b981', fontSize: '24px'
          }}>
            ✔
          </div>
          <h3 style={{ margin: '0 0 10px 0' }}>{newRentalFound?.name || `Rental #${newRentalFound?.id}`}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
            <div className="stat-card-mini" style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '6px' }}>
              <div style={{ fontSize: '10px', opacity: 0.5 }}>ALGORITHM</div>
              <div style={{ fontWeight: 'bold', color: '#60a5fa' }}>{newRentalFound?.algo || 'N/A'}</div>
            </div>
            <div className="stat-card-mini" style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '6px' }}>
              <div style={{ fontSize: '10px', opacity: 0.5 }}>DURATION</div>
              <div style={{ fontWeight: 'bold', color: '#fbbf24' }}>{newRentalFound?.hours} Hours</div>
            </div>
          </div>
          <div style={{ 
            background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', 
            padding: '12px', borderRadius: '6px', color: '#34d399', fontSize: '13px', marginBottom: '20px' 
          }}>
            This rig has been successfully added to your active rentals.
          </div>
          <div className="modal-actions" style={{ justifyContent: 'center' }}>
            <button className="btn-pro primary" onClick={() => {
              setNewRentalFound(null);
              openManagementModal('rental');
            }}>View All Rentals</button>
            <button className="btn-pro secondary" onClick={() => setNewRentalFound(null)}>Dismiss</button>
          </div>
        </div>
      </Modal>

      {/* Inline Quick View */}
      <div style={{ marginTop: '24px' }}>
        <MrrRigs 
          mrrClient={mrrClient} 
          algo={algorithm}
          onOpenPool={onOpenMrrPools}
          onInfo={(id) => onCall(`/api/v2/mrr/rig/${encodeURIComponent(id)}/info`, { query: { client: mrrClient } })}
        />
      </div>

      {/* Dedicated Management Modals */}
      <Modal 
        isOpen={!!activeModal} 
        onClose={() => setActiveModal(null)} 
        title={
          activeModal === 'list' ? 'Rigs Manager' : 
          // activeModal === 'list_all_rigs' ? 'All Available Rigs' :
          activeModal === 'rental_history' ? 'Rental History' : 'Active Rentals'
        }
        maxWidth="1200px"
      >
        <div style={{ padding: '5px' }}> {/* Removed maxHeight and overflowY: 'auto' from here */}
          {activeModal === 'list' && (
            <MrrRigs 
              mrrClient={mrrClient} 
              algo={algorithm}
              onOpenPool={onOpenMrrPools}
              onInfo={(id) => onCall(`/api/v2/mrr/rig/${encodeURIComponent(id)}/info`, { query: { client: mrrClient } })}
            />
          )}
          
          {activeModal === 'list_all_rigs' && (
            <MrrRigs 
              mrrClient={mrrClient} 
              endpoint="/rig" 
              algo={algorithm} 
              onOpenPool={onOpenMrrPools}
              onInfo={(id) => onCall(`/api/v2/mrr/rig/${encodeURIComponent(id)}/info`, { query: { client: mrrClient } })} 
            />
          )}

          {modalLoading && <div style={{ textAlign: 'center', padding: '40px' }}>Loading data from MiningRigRentals...</div>}
          
          {!modalLoading && (activeModal === 'rental' || activeModal === 'rental_history') && (
            <div style={{ 
              maxHeight: '75vh', 
              overflowY: 'auto', 
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.2) transparent'
            }}>
              <MrrRentalsTable data={modalData} />
            </div>
          )}

        </div>
        
        <div className="modal-actions" style={{ marginTop: '20px', textAlign: 'right' }}>
          <button className="btn-pro secondary" onClick={() => setActiveModal(null)}>Close</button>
        </div>
      </Modal>
    </div>
  );
}
