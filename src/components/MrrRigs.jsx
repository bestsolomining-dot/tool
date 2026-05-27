import React, { useState, useEffect, useMemo } from 'react';
import { poolApi } from '../core/poolUtils';

/** Deeply searches for a rig array in the MRR response */
function findRigArray(obj) {
  if (!obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.rigs)) return obj.rigs;
  if (Array.isArray(obj.data)) return obj.data;
  
  for (const key in obj) {
    const result = findRigArray(obj[key]);
    if (result && result.length > 0) return result;
  }
  return [];
}

export default function MrrRigs({ mrrClient, onOpenPool, onInfo, endpoint = '/rig/mine', algo, initialStatus = 'available' }) {
  const [rigs, setRigs] = useState([]);
  const [userRigIds, setUserRigIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [enrichedInfo, setEnrichedInfo] = useState({}); // rigId -> details object
  const [infoLoadingId, setInfoLoadingId] = useState(null);

  // More granular status filtering: 'available', 'rented', or 'all'
  const [statusFilter, setStatusFilter] = useState(endpoint === '/rig' ? initialStatus : 'all');

  // Debug count to see if items are being filtered out
  const totalFetchedCount = rigs.length;

  const filteredRigs = useMemo(() => {
    return rigs.filter(rig => {
      if (statusFilter === 'all') return true;
      const statusValue = typeof rig.status === 'object' ? rig.status.status : rig.status;
      return String(statusValue || '').toLowerCase().includes(statusFilter);
    });
  }, [rigs, statusFilter]);

  const fetchRigs = async () => {
    setLoading(true);
    setError('');
    try {
      // 1. Prepare parameters for Marketplace
      const params = { endpoint };
      
      if (endpoint === '/rig') {
        if (algo) params.algo = String(algo).trim();
        
        // Server-side status filtering for the Marketplace
        if (statusFilter !== 'all') {
          params.status = statusFilter;
        }
      }

      const result = await poolApi.mrrRigs(mrrClient, endpoint, params); 
      
      if (result.ok) {
        const rigList = findRigArray(result.data);

        // 2. Identify "My Rigs" if in Marketplace view
        if (endpoint === '/rig') {
          const myRigsResult = await poolApi.mrrRigs(mrrClient, '/rig/mine');
          if (myRigsResult.ok) {
            const myRigsPayload = myRigsResult.data?.data || myRigsResult.data;
            const myIds = new Set((Array.isArray(myRigsPayload) ? myRigsPayload : (myRigsPayload?.rigs || [])).map(r => String(r.id)));
            setUserRigIds(myIds);
          }
        } else {
          setUserRigIds(new Set(rigList.map(r => String(r.id))));
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

  const fetchRigDetailInfo = async (rigId) => {
    setInfoLoadingId(rigId);
    try {
      const result = await fetch(`http://localhost:3000/api/v2/mrr/rig/${encodeURIComponent(rigId)}/info?client=${mrrClient}`);
      const data = await result.json();
      if (data && !data.error) {
        setEnrichedInfo(prev => ({ ...prev, [rigId]: data }));
      }
    } catch (err) {
      console.error("Failed to fetch rig info:", err);
    } finally {
      setInfoLoadingId(null);
    }
  };

  useEffect(() => {
    if (mrrClient && endpoint) fetchRigs(); // Re-fetch if endpoint changes
  }, [mrrClient, endpoint]);

  const getStatusClass = (status) => {
    const statusValue = typeof status === 'object' ? status.status : status;
    const s = String(statusValue || '').toLowerCase();
    if (s.includes('available') || s.includes('online')) return { color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)' };
    if (s.includes('rented')) return { color: '#a78bfa', background: 'rgba(167, 139, 250, 0.1)', border: '1px solid rgba(167, 139, 250, 0.2)' };
    if (s.includes('offline') || s.includes('disabled')) return { color: '#f87171', background: 'rgba(248, 113, 113, 0.1)', border: '1px solid rgba(248, 113, 113, 0.2)' };
    return '';
  };

  return (
    <div className="mrr-rigs-dashboard">
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '15px' }}>
        <div>
          <h2 style={{ margin: 0 }}>{endpoint === '/rig' ? 'MRR Marketplace' : 'RIGS'} ({mrrClient})</h2>
          <small style={{ opacity: 0.5 }}>
            Showing {filteredRigs.length} of {totalFetchedCount} rigs {algo && `for ${algo}`}
          </small>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <select 
            className="select-pro" 
            style={{ fontSize: '11px', padding: '4px' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="available">Status: Available</option>
            <option value="rented">Status: Rented</option>
            <option value="all">Status: All</option>
          </select>
          <button className="btn-pro secondary" onClick={fetchRigs} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="error-message" style={{ margin: '15px 0', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '6px', color: '#f87171' }}><strong>Error:</strong> {error}</div>}

      <div className="rig-list" style={{ marginTop: '15px' }}>
        {filteredRigs.length === 0 && !loading && !error && (
          <div style={{ opacity: 0.5, textAlign: 'center', padding: '20px' }}>No rigs found for this account.</div>
        )}
        
        <div className="rig-grid-container" style={{ 
          minHeight: '800px',
          maxHeight: '800px',
          overflowY: 'auto', 
          paddingRight: '8px',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.1) transparent',
          overscrollBehavior: 'contain'
        }}>
          <div className="rig-grid" style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
          gap: '15px' 
        }}>
          {filteredRigs.map((rig) => {
            const isMine = userRigIds.has(String(rig.id));
            const info = enrichedInfo[rig.id];

            return (
              <div key={rig.id} className="rig-card" style={{ 
                background: isMine ? 'rgba(59, 130, 246, 0.1)' : 'rgba(30, 41, 59, 0.4)', 
                border: isMine ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255,255,255,0.1)', 
                borderRadius: '8px', 
                padding: '15px',
                position: 'relative'
              }}>
                {isMine && <span style={{ position: 'absolute', top: '1px', left: '10px', background: '#494947', color: 'white', fontSize: '9px', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Rig ID: #{rig.id} {rig.mrrClient && `[${rig.mrrClient}]`}</span>}
                
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {/* <span style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>#{rig.id} {rig.mrrClient && `[${rig.mrrClient}]`}</span> */}
                  <strong style={{ fontSize: '14px' }}>{rig.name}</strong>
                </div>
                <span 
                  style={{ 
                    fontSize: '10px', 
                    fontWeight: 'bold', 
                    height: 'fit-content', 
                    padding: '4px 10px', 
                    borderRadius: '4px', 
                    letterSpacing: '0.5px',
                    ...getStatusClass(rig.status)
                  }}>
                  {(() => {
                    const s = String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toUpperCase();
                    return s.includes('AVAILABLE') ? 'NOT RENTED' : s.includes('RENTED') ? 'RENTED' : s;
                  })()}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px', marginBottom: '15px' }}>
                <div>
                  <div style={{ opacity: 0.5, fontSize: '10px', textTransform: 'uppercase' }}>Algorithm</div>
                  <div style={{ color: '#60a5fa' }}>{rig.algo || rig.algorithm || 'N/A'}</div>
                </div>
                <div>
                  <div style={{ opacity: 0.5, fontSize: '10px', textTransform: 'uppercase' }}>Hashrate</div>
                  <div>
                    {(() => {
                      if (typeof rig.hashrate === 'object' && rig.hashrate !== null) {
                        return rig.hashrate.advertised?.hashrate ?? '0';
                      }
                      if (rig.hash) {
                        return rig.hash.advertised ?? rig.hash;
                      }
                      return rig.hashrate ?? '0';
                    })()} {rig.hashrate?.advertised?.suffix ?? ''}
                  </div>
                </div>
                <div>
                  <div style={{ opacity: 0.5, fontSize: '10px', textTransform: 'uppercase' }}>Price</div>
                  <div style={{ color: '#fbbf24' }}>
                    {(() => {
                      let p = rig.price;
                      if (typeof p === 'object' && p !== null) {
                        const unit = rig.price_unit || 'BTC';
                        p = p[unit]?.price ?? p[unit] ?? '0.00';
                      }
                      if (endpoint === '/rig' && !p) { // Marketplace fallback
                        p = rig.min_price || rig.price;
                      }
                      return p || '0.00';
                    })()}
                    <small style={{ opacity: 0.5, marginLeft: '4px' }}>{rig.price_unit || 'BTC'}</small>
                  </div>
                </div>
                <div>
                  <div style={{ opacity: 0.5, fontSize: '10px', textTransform: 'uppercase' }}>Type</div>
                  <div style={{ textTransform: 'capitalize' }}>{rig.price_type || 'Day'}</div>
                </div>
              </div>

              {info && (
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '4px', marginBottom: '15px', fontSize: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                    <div><span style={{ opacity: 0.6 }}>Host:</span> {info.stratumHost}</div>
                    <div><span style={{ opacity: 0.6 }}>Port:</span> {info.stratumPort}</div>
                    <div style={{ gridColumn: 'span 2' }}><span style={{ opacity: 0.6 }}>User:</span> {info.username}</div>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
                {isMine && (
                  <button 
                    className="btn-pro secondary" 
                    style={{ flex: 1, fontSize: '11px', padding: '6px' }} 
                    onClick={() => onOpenPool?.(rig.id)}
                  >
                    Pools
                  </button>
                )}
                <button 
                  className="btn-pro" 
                  style={{ flex: 1, fontSize: '11px', padding: '6px' }} 
                  onClick={() => info ? setEnrichedInfo(prev => { const n = {...prev}; delete n[rig.id]; return n; }) : fetchRigDetailInfo(rig.id)}
                  disabled={infoLoadingId === rig.id}
                >
                  {infoLoadingId === rig.id ? '...' : info ? 'Hide Info' : 'More Info'}
                </button>
              </div>
            </div>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
}