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

  const fetchPools = async (type, id = null) => {
    if ((!mrrClient || mrrClient === 'ALL') && type !== 'all_rigs') {
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

      {/* Rented Status Modal */}
      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={`Rental Status: #${rentalInfo?.id}`}
        maxWidth="500px"
      >
        {rentalInfo && (
          <div style={{ padding: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
              <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '15px', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', opacity: 0.6, marginBottom: '5px' }}>ALGORITHM</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#60a5fa' }}>{rentalInfo.algo || 'N/A'}</div>
              </div>
              <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '15px', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', opacity: 0.6, marginBottom: '5px' }}>HASHRATE</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#34d399' }}>
                  {(() => {
                    const hr = rentalInfo?.hashrate;
                    if (!hr) return '0';
                    if (typeof hr === 'object') {
                      // Safely pick 'nice' display string or raw hashrate number
                      return hr.advertised?.nice || hr.advertised?.hashrate || hr.hashrate || '0';
                    }
                    return String(hr);
                  })()}
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', opacity: 0.5 }}>DURATION</div>
                <div style={{ fontWeight: 'bold' }}>{rentalInfo.hours} Hours</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', opacity: 0.5 }}>STATUS</div>
                <div style={{ fontWeight: 'bold', color: '#10b981' }}>{String(rentalInfo.status || 'ACTIVE').toUpperCase()}</div>
              </div>
            </div>
            
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '6px', fontSize: '12px', marginBottom: '20px' }}>
              <strong>Rig Name:</strong> {rentalInfo.name || 'N/A'}<br/>
              <strong>Price Paid:</strong> {(() => {
                const p = rentalInfo?.price;
                if (p && typeof p === 'object') {
                  return p.paid || p.price || '0.00';
                }
                return p || '0.00';
              })()} BTC
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