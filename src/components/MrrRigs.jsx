import React, { useState, useEffect } from 'react';
import { poolApi } from '../core/poolUtils';

export default function MrrRigs({ mrrClient, onOpenPool, onInfo }) {
  const [rigs, setRigs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchRigs = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await poolApi.mrrRigs(mrrClient);
      if (result.ok) {
        // MRR returns rigs in result.data.data.rigs or result.data.rigs depending on the specific endpoint structure
        // If mrrClient is 'ALL', the backend will return { success: true, rigs: [...], errors: [...] }
        let rigList = [];
        if (mrrClient === 'ALL' && Array.isArray(result.data?.rigs)) {
          rigList = result.data.rigs;
        } else if (Array.isArray(result.data)) {
          rigList = result.data;
        } else if (result.data?.data?.rigs) {
          rigList = result.data.data.rigs;
        } else if (result.data?.rigs) {
          rigList = result.data.rigs;
        }
        setRigs(rigList);
      } else {
        setError(result.data?.message || 'Failed to fetch MRR rigs');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mrrClient) fetchRigs();
  }, [mrrClient]);

  const getStatusClass = (status) => {
    const s = String(status || '').toLowerCase();
    if (s.includes('available') || s.includes('online')) return 'status-success';
    if (s.includes('rented')) return 'status-ready';
    if (s.includes('offline') || s.includes('disabled')) return 'status-error';
    return '';
  };

  return (
    <div className="mrr-rigs-dashboard">
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>MRR Rigs ({mrrClient})</h2>
        <button className="btn-pro secondary" onClick={fetchRigs} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error-message" style={{ margin: '15px 0', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '6px', color: '#f87171' }}><strong>Error:</strong> {error}</div>}

      <div className="rig-list" style={{ marginTop: '15px' }}>
        {rigs.length === 0 && !loading && !error && (
          <div style={{ opacity: 0.5, textAlign: 'center', padding: '20px' }}>No rigs found for this account.</div>
        )}
        
        <div className="table-responsive">
          <table className="pro-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #444' }}>
                <th style={{ padding: '10px' }}>ID</th>
                {mrrClient === 'ALL' && <th>Client</th>}
                <th>Name</th>
                <th>Status</th>
                <th>Algorithm</th>
                <th>Hashrate</th>
                <th>Price</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rigs.map((rig) => (
                <tr key={rig.id} style={{ borderBottom: '1px solid #333' }}>
                  <td style={{ padding: '12px 10px', fontFamily: 'monospace', color: '#888' }}>{rig.id}</td>
                  {mrrClient === 'ALL' && <td>{rig.mrrClient}</td>}
                  <td style={{ fontWeight: 'bold' }}>{rig.name}</td>
                  <td>
                    <span className={`status-item`} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className={`status-dot ${getStatusClass(rig.status)}`} style={{ width: '8px', height: '8px', borderRadius: '50%' }}></span>
                      <span className={getStatusClass(rig.status)} style={{ fontSize: '12px', textTransform: 'capitalize' }}>
                        {rig.status}
                      </span>
                    </span>
                  </td>
                  <td style={{ fontSize: '12px' }}>{rig.algo || rig.algorithm}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span>{rig.hashrate?.advertised?.hashrate || rig.hashrate || '0'} {rig.hashrate?.advertised?.suffix || ''}</span>
                      {rig.hashrate?.average && (
                        <small style={{ opacity: 0.5, fontSize: '10px' }}>Avg: {rig.hashrate.average.hashrate} {rig.hashrate.average.suffix}</small>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ color: '#fbbf24' }}>{rig.price || '0.00'}</span>
                      <small style={{ opacity: 0.5, fontSize: '10px' }}>{rig.price_unit || 'BTC'} / {rig.price_type || 'day'}</small>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="text-button" onClick={() => onOpenPool?.(rig.id)}>Pools</button>
                      <button className="text-button" onClick={() => onInfo?.(rig.id)}>Info</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}