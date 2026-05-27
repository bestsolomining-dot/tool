import { useState } from 'react';
import { MrrPoolsTable } from './MiningRigRental';
import Modal from './Modal';

export default function MrrPoolsManager({ onCall, mrrClient }) {
  const [rigId, setRigId] = useState('');
  const [rentalId, setRentalId] = useState('');
  const [poolData, setPoolData] = useState(null);
  const [rentalInfo, setRentalInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [mrrMethod, setMrrMethod] = useState('GET');
  const [mrrEndpoint, setMrrEndpoint] = useState('/rig/mine');
  const [mrrBody, setMrrBody] = useState('');

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

  const fetchRentalInfo = async () => {
    const targetId = rentalId.trim();
    if (!targetId) return;
    setLoading(true);
    setRentalInfo(null);
    try {
      const result = await onCall(`/api/v2/mrr/rental/${encodeURIComponent(targetId)}`, { query: { client: mrrClient }, silent: true });
      if (result && result.success) {
        // Extract the rental object from the MRR response wrapper
        const info = result.data || result;
        setRentalInfo(info);
        setIsModalOpen(true);
      } else {
        window.alert(result?.message || 'Rental not found or API error');
      }
    } catch (err) {
      window.alert(`Fetch Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

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
          style={{ background: '#10b981' }}
          disabled={!rentalId.trim() || loading} 
          onClick={fetchRentalInfo}
        >
          Fetch Status
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '20px', opacity: 0.6 }}>Fetching pool configurations...</div>}

      {poolData && (
        <div className="pool-results-container" style={{ marginTop: '20px', maxHeight: '400px', overflowY: 'auto' }}>
          {poolData.success === false ? (
            <div className="error-message">{poolData.message}</div>
          ) : (
            <MrrPoolsTable data={poolData} />
          )}
        </div>
      )}

      <details style={{ marginTop: '30px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
        <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.7 }}>
          <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Manual API Executor</h4>
          <span style={{ fontSize: '11px', color: '#3b82f6', textTransform: 'uppercase', fontWeight: 'bold' }}>Show Developer Tools</span>
        </summary>
        <div className="market-inputs" style={{ marginTop: '15px' }}>
          <select className="select-pro" value={mrrMethod} onChange={(e) => setMrrMethod(e.target.value)}>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input className="input-pro" placeholder="Endpoint (e.g. /rig/mine)" value={mrrEndpoint} onChange={(e) => setMrrEndpoint(e.target.value)} />
          <button className="btn-pro secondary" onClick={callMrrFunction}>Execute</button>
          <button className="text-button" onClick={() => { setMrrEndpoint('/rig/mine'); setMrrMethod('GET'); setMrrBody(''); }}>Reset</button>
        </div>
        <textarea className="input-pro" style={{ marginTop: '10px', minHeight: '80px', width: '100%' }} placeholder='JSON Body (Optional)' value={mrrBody} onChange={(e) => setMrrBody(e.target.value)} />
      </details>

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
                 color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)' 
               }}>
                 {String(rentalInfo.status || 'RENTED').toUpperCase()}
               </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              <div className="stat-box" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px' }}>
                <div style={{ fontSize: '9px', opacity: 0.5, marginBottom: '4px', textTransform: 'uppercase' }}>Algorithm</div>
                <div style={{ fontWeight: 'bold', color: '#60a5fa' }}>{rentalInfo.algo || rentalInfo.rig?.type || 'N/A'}</div>
              </div>
              <div className="stat-box" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px' }}>
                <div style={{ fontSize: '9px', opacity: 0.5, marginBottom: '4px', textTransform: 'uppercase' }}>Hashrate</div>
                <div style={{ fontWeight: 'bold', color: '#34d399' }}>
                  {(() => {
                    const hr = rentalInfo?.hashrate;
                    if (!hr) return '0';
                    if (typeof hr === 'object') return hr.advertised?.nice || hr.advertised?.hashrate || hr.nice || hr.hashrate || '0';
                    return String(hr);
                  })()}
                </div>
              </div>
              <div className="stat-box" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px' }}>
                <div style={{ fontSize: '9px', opacity: 0.5, marginBottom: '4px', textTransform: 'uppercase' }}>Price</div>
                <div style={{ fontWeight: 'bold', color: '#fbbf24' }}>
                  {(() => {
                    const p = rentalInfo?.price;
                    if (p && typeof p === 'object') return p.paid || p.price || '0.00';
                    return p || '0.00';
                  })()} BTC
                </div>
              </div>
              <div className="stat-box" style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px' }}>
                <div style={{ fontSize: '9px', opacity: 0.5, marginBottom: '4px', textTransform: 'uppercase' }}>Type</div>
                <div style={{ fontWeight: 'bold' }}>{rentalInfo.price_type || 'Day'}</div>
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '6px', fontSize: '11px', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ marginBottom: '4px' }}><span style={{ opacity: 0.6 }}>Rig ID:</span> {rentalInfo.id}</div>
              <div><span style={{ opacity: 0.6 }}>Duration:</span> {rentalInfo.hours} Hours</div>
            </div>

            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button className="btn-pro secondary" onClick={() => setIsModalOpen(false)}>Dismiss</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}