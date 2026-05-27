import { useState } from 'react';
import { MrrPoolsTable } from './MiningRigRental';

export default function MrrPoolsManager({ onCall, mrrClient }) {
  const [rigId, setRigId] = useState('');
  const [rentalId, setRentalId] = useState('');
  const [poolData, setPoolData] = useState(null);
  const [loading, setLoading] = useState(false);

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
    </div>
  );
}