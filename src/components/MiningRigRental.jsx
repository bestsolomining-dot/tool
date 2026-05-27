import { useState, useCallback } from 'react';
import MrrRigs from './MrrRigs';
import Modal from './Modal';

/** Structured view for active rentals */
function MrrRentalsTable({ data }) {
  const rentals = data?.rentals || data?.data?.rentals || (Array.isArray(data) ? data : []);
  if (!rentals.length) return <div style={{ padding: '30px', textAlign: 'center', opacity: 0.5 }}>No active rentals found.</div>;

  return (
    <div className="table-responsive">
      <table className="pro-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Rig ID</th>
            <th>Algo</th>
            <th>Price</th>
            <th>Duration</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rentals.map(r => (
            <tr key={r.id}>
              <td style={{ fontFamily: 'monospace', color: '#888' }}>{r.id}</td>
              <td>{r.rig_id}</td>
              <td>{r.algo}</td>
              <td style={{ color: '#fbbf24' }}>{r.price} {r.currency}</td>
              <td>{r.hours}h</td>
              <td><span className="status-success">{r.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Structured view for Rig Pools */
function MrrPoolsTable({ data }) {
  const results = Array.isArray(data?.data) ? data.data : (data?.success ? [data] : []);
  if (!results.length) return <div style={{ padding: '30px', textAlign: 'center', opacity: 0.5 }}>No pool data found.</div>;

  return (
    <div className="mrr-pools-modal-content">
      {results.map((res, idx) => (
        <div key={res.rigId || idx} style={{ marginBottom: '25px', borderBottom: '1px solid #333', pb: '15px' }}>
          <h4 style={{ color: '#3b82f6', margin: '0 0 10px 0' }}>Rig ID: {res.rigId || 'N/A'}</h4>
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

export default function MiningRigRental({ onCall, mrrClient, setMrrClient }) {
  const [mrrMethod, setMrrMethod] = useState('GET');
  const [mrrEndpoint, setMrrEndpoint] = useState('/rig/mine');
  const [mrrBody, setMrrBody] = useState('');
  const [rigId, setRigId] = useState('');
  const [activeModal, setActiveModal] = useState(null); // 'list', 'pool', 'rental'
  const [modalData, setModalData] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);

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

  const openManagementModal = async (type, id = null) => { // id is for specific rig actions
    setActiveModal(type);
    if (type === 'list') return; // MrrRigs fetches its own data
    
    if (mrrClient === 'ALL' && (type === 'rental' || (type === 'pool' && !id))) {
      setModalData({ success: false, message: "Client 'ALL' is not supported for this action. Please select a specific client." });
      setModalLoading(false);
      return;
    }

    setModalLoading(true);
    setModalData(null);
    try {
      let path = '/api/v2/mrr/rentals';
      let clientToUse = mrrClient;

      if (type === 'pool' && id) { // Only fetch for a specific rig if an ID is provided
        const targetId = id || rigId.trim() || 'mine'; 
        path = `/api/v2/mrr/rig/${encodeURIComponent(targetId)}/pool`;
      }
      
      const result = await onCall(path, { query: { client: clientToUse }, silent: true });
      setModalData(result);
    } catch (err) {
      console.error("MRR Modal Error:", err);
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <div className="rig-section mrr-theme" style={{ marginTop: '30px', borderTop: '1px solid #444', paddingTop: '20px' }}>
      <h3 className="section-title">Mining Rig Rentals</h3>
      
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
        <button className="btn-pro primary" onClick={() => openManagementModal('list')}>Open Rigs List</button>
        <button className="btn-pro secondary" onClick={() => openManagementModal('rental')}>Rentals Dashboard</button>
        <button className="btn-pro secondary" onClick={() => onCall('/api/v2/mrr/balance', { query: { client: mrrClient } })}>Balance</button>
      </div>

      {/* Rig-specific Actions */}
      <div className="market-inputs" style={{ marginTop: '15px' }}>
        <input className="input-pro" placeholder="MRR Rig ID(s) (e.g. 81;82;83)" value={rigId} onChange={(e) => setRigId(e.target.value)} />
        <button 
          className="btn-pro secondary" 
          disabled={!rigId.trim()} 
          onClick={() => openManagementModal('pool')}
        >
          Manage Pools
        </button>
        <button 
          className="btn-pro secondary" 
          disabled={!rigId.trim()} 
          onClick={() => onCall(`/api/v2/mrr/rig/${encodeURIComponent(rigId.trim())}/info`, { query: { client: mrrClient } })}
        >
          Rig Info
        </button>
      </div>

      <div className="market-inputs" style={{ marginTop: '25px', borderTop: '1px solid #444', paddingTop: '15px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '10px' }}>
          <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Manual API Executor</h4>
          <button className="text-button" onClick={() => { setMrrEndpoint('/rig/mine'); setMrrMethod('GET'); setMrrBody(''); }}>Reset</button>
        </div>
        <select className="select-pro" value={mrrMethod} onChange={(e) => setMrrMethod(e.target.value)}>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
        </select>
        <input className="input-pro" placeholder="Endpoint (e.g. /rig/mine)" value={mrrEndpoint} onChange={(e) => setMrrEndpoint(e.target.value)} />
        <button className="btn-pro secondary" onClick={callMrrFunction}>Execute</button>
      </div>
      <textarea className="input-pro" style={{ marginTop: '10px', minHeight: '80px', width: '100%' }} placeholder='JSON Body (Optional)' value={mrrBody} onChange={(e) => setMrrBody(e.target.value)} />

      {/* Inline Quick View */}
      <div style={{ marginTop: '24px' }}>
        <MrrRigs 
          mrrClient={mrrClient} 
          onOpenPool={(id) => openManagementModal('pool', id)}
          onInfo={(id) => onCall(`/api/v2/mrr/rig/${encodeURIComponent(id)}/info`, { query: { client: mrrClient } })}
        />
      </div>

      {/* Dedicated Management Modals */}
      <Modal 
        isOpen={!!activeModal} 
        onClose={() => setActiveModal(null)} 
        title={
          activeModal === 'list' ? 'Rigs Manager' : 
          activeModal === 'pool' ? 'Rig Pool Configuration' : 
          'Rental History / Rented Rigs'
        }
        maxWidth="1200px"
      >
        {activeModal === 'list' && (
          <MrrRigs 
            mrrClient={mrrClient} 
            onOpenPool={(id) => openManagementModal('pool', id)}
            onInfo={(id) => onCall(`/api/v2/mrr/rig/${encodeURIComponent(id)}/info`, { query: { client: mrrClient } })}
          />
        )}
        
        {modalLoading && <div style={{ textAlign: 'center', padding: '40px' }}>Loading data from MiningRigRentals...</div>}
        
        {!modalLoading && activeModal === 'rental' && <MrrRentalsTable data={modalData} />}
        {!modalLoading && activeModal === 'pool' && <MrrPoolsTable data={modalData} />}
        
        <div className="modal-actions" style={{ marginTop: '20px', textAlign: 'right' }}>
          <button className="btn-pro secondary" onClick={() => setActiveModal(null)}>Close</button>
        </div>
      </Modal>
    </div>
  );
}