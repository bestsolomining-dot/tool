import React, { useState, useEffect, useMemo } from 'react';
import { poolApi } from '../core/poolUtils';
import { CountdownTimer } from './MiningRigRental';

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

function formatHashrateValue(rate) {
  if (!rate) return '0 N/A';
  if (typeof rate === 'string' || typeof rate === 'number') return String(rate);
  if (rate.nice) return rate.nice;
  const hash = rate.hash ?? rate.advertised ?? 0;
  const parsed = Number.parseFloat(hash);
  const displayHash = Number.isFinite(parsed) ? parsed.toFixed(2) : String(hash);
  return `${displayHash} ${String(rate.type || '').toUpperCase()}`.trim();
}

function getRentalEndTime(rental) {
  return rental?.end || rental?.normalized?.endTime || null;
}

function getRentalAlgorithm(rental) {
  return rental?.rig?.type || rental?.algorithm || rental?.algorithm || rental?.normalized?.algorithm || 'N/A';
}

function getRentalAdvertisedHashrate(rental) {
  return formatHashrateValue(rental?.hashrate?.advertised) || rental?.normalized?.niceHashrate || '0 N/A';
}

function getRentalAverageHashrate(rental) {
  return formatHashrateValue(rental?.hashrate?.average) || rental?.normalized?.niceAverageHashrate || '0 N/A';
}

function getRentalEfficiency(rental) {
  return String(rental?.hashrate?.average?.percent || rental?.normalized?.percent || '0');
}

export default function MrrRigs({ mrrClient, onOpenPool, onInfo, endpoint = '/rig/mine', algo, initialStatus = 'available' }) {
  const [rigs, setRigs] = useState([]);
  const [userRigIds, setUserRigIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [enrichedInfo, setEnrichedInfo] = useState({}); // rigId -> details object
  const [infoLoadingId, setInfoLoadingId] = useState(null);

  // More granular status filtering: 'available', 'rented', or 'all'
  const [statusFilter, setStatusFilter] = useState(endpoint === '/rig' ? initialStatus : 'rented');

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
            const myRigsPayload = myRigsResult.data?.data || myRigsResult.data || [];
            const myRigsArray = Array.isArray(myRigsPayload) ? myRigsPayload : (myRigsPayload.rigs || []);
            const myIds = new Set(myRigsArray.map(r => String(r.id || r.rigid || r.rig_id || '').trim()).filter(Boolean));
            setUserRigIds(myIds);
          }
        } else {
          setUserRigIds(new Set(rigList.map(r => String(r.id))));
        }

        setRigs(rigList);

        // Auto-fetch detail info for rented rigs so "More Info" isn't required manually
        rigList.forEach(rig => {
          const statusStr = String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toLowerCase();
          if (statusStr.includes('rented')) {
            fetchRigDetailInfo(rig);
          }
        });
      } else {
        setError(result.data?.message || 'Failed to fetch MRR rigs');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchRigDetailInfo = async (rig) => {
    const rigId = rig.id || rig.rigid || rig.rig_id;
    const statusStr = String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toLowerCase();
    const isRented = statusStr.includes('rented');
    const rentalId = rig.rentalid || rig.current_rental_id || rig.rental_id || rig.id;

    setInfoLoadingId(rigId);
    try {
      const apiBase = window.location.port === '5173'
        ? `${window.location.protocol}//${window.location.hostname}:3000`
        : '';

      const url = (isRented && rentalId)
        ? `${apiBase}/api/v2/mrr/rental/${encodeURIComponent(rentalId)}?client=${mrrClient}` 
        : `${apiBase}/api/v2/mrr/rig/${encodeURIComponent(rigId)}/info?client=${mrrClient}`;

      const result = await fetch(url);
      const data = await result.json();
      if (data && !data.error) {
        let infoBoxData;
        if (isRented && rentalId) {
          const rental = data.data || data;
          const pools = rental.pools || [];
          const firstPool = pools[0];
          infoBoxData = {
            stratumHost: firstPool?.host || firstPool?.stratumHost || rental.rig?.stratumHost || 'N/A',
            stratumPort: firstPool?.port || firstPool?.stratumPort || rental.rig?.stratumPort || '',
            username: firstPool?.user || firstPool?.username || rental.rig?.username || 'N/A',
            algo: getRentalAlgorithm(rental),
            percent: getRentalEfficiency(rental),
            endTime: getRentalEndTime(rental),
            advertised: getRentalAdvertisedHashrate(rental),
            average: getRentalAverageHashrate(rental),
            pools: pools.map(p => ({
              host: p.host || p.stratumHost || rental.rig?.stratumHost || 'N/A',
              port: p.port || p.stratumPort || rental.rig?.stratumPort || 'N/A',
              username: p.user || p.username || rental.rig?.username || 'N/A',
            })),
            isRental: true,
          };
        } else {
          // For rig info, the data is already structured correctly by the backend's extractRigInfo
          infoBoxData = data;
        }
        setEnrichedInfo(prev => ({ ...prev, [rigId]: infoBoxData }));
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
          <small style={{ opacity: 0.3 }}>
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
            const rigId = rig.id || rig.rigid || rig.rig_id;
            const isMine = rigId && userRigIds.has(String(rigId));
            const info = enrichedInfo[rig.id];
            
            const statusStr = String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toLowerCase();
            const isRented = statusStr.includes('rented');
            const rentalId = rig.rentalid || rig.current_rental_id || rig.rental_id;
            const displayId = (isRented && rentalId) ? rentalId : rig.id;
            const idLabel = (isRented && rentalId) ? 'Rental' : 'Rig';

            return (
              <div key={rig.id} style={{padding: '1px 2px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {isMine ? (
                  <div style={{ padding: '2px 2px' }}>
                    <span style={{ background: '#5c005f', color: 'white', fontSize: '9px', padding: '2px 8px', borderRadius: '5px', fontWeight: 'bold', textTransform: 'uppercase', display: 'inline-block' }}>
                      {idLabel}: #{displayId} 
                      {rig.mrrClient && (
                        <span style={{ padding: '3px 3px 3px 3px', marginTop: '-10px', fontSize: '13px', opacity: 1.5, marginTop: '3px', marginLeft: '3px', color: rig.mrrClient === 'SL' ? '#3b82f6' : rig.mrrClient === 'BT' ? '#fbbf24' : rig.mrrClient === 'ALL' ? '#ef4444' : 'inherit' }}>
                          [{rig.mrrClient}]
                        </span>
                      )}
                    </span>
                  </div>
                ) : (
                  <div style={{ height: '-30px' }} />
                )}
                <div className="rig-card" style={{ 
                  background: isMine ? 'rgba(59, 130, 246, 0.1)' : 'rgba(30, 41, 59, 0.4)', 
                  border: isMine ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255,255,255,0.1)', 
                  borderRadius: '8px', 
                  padding: '15px',
                  position: 'relative',
                  minHeight: '300px'
                }}>
                
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <strong style={{ fontSize: '13px', minHeight: '60px' }}>{rig.name}</strong>
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
                    return s.includes('AVAILABLE') ? 'AVAILABLE' : s.includes('RENTED') ? 'RENTED' : s;
                  })()}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px', marginBottom: '15px' }}>
                <div>
                  <div style={{ opacity: 0.5, fontSize: '10px', textTransform: 'uppercase' }}>Algorithm</div>
                  <div style={{ color: '#60a5fa' }}>{info?.algo || rig.algo || rig.algorithm || rig.type || 'N/A'}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ opacity: 0.5, fontSize: '10px', textTransform: 'uppercase' }}>
                    Average Hashrate
                  </div>
                  <div>
                    {(() => {
                      if (info?.isRental) return info.average || '0 N/A';
                      const hr = rig.hashrate || rig.hash;
                      if (!hr && hr !== 0) return '0 N/A';
                      if (typeof hr === 'object') {
                        // Use Average for rented rigs if available in the payload
                        if (isRented && hr.average) {
                          if (typeof hr.average === 'object') {
                            return hr.average.nice || `${parseFloat(hr.average.hash || 0).toFixed(2)} ${hr.average.type || ''}`.trim();
                          }
                          return hr.average;
                        }
                        // Fallback to "nice" formatted strings or advertised rate
                        return hr.advertised?.nice || hr.nice || hr.advertised?.hash || hr.advertised || '0';
                      }
                      return hr;
                    })()}
                    {info?.isRental && (
                      <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '2px' }}>
                        Advertised: <span style={{ color: '#34d399' }}>{info.advertised}</span>
                      </div>
                    )}

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
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '4px', marginBottom: '15px', fontSize: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  {info.isRental && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '10px', alignItems: 'center' }}>
                      <div><span style={{ opacity: 0.6 }}>Algo:</span> <span style={{ color: '#60a5fa' }}>{info.algo}</span></div>
                      <div><span style={{ opacity: 0.6 }}>Efficiency:</span> <span style={{ color: info.percent < 90 ? '#f87171' : '#34d399' }}>{info.percent}%</span></div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ opacity: 0.6 }}>Ends In:</span>{' '}
                        <CountdownTimer endTime={info.endTime} />
                      </div>
                    </div>
                  )}
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
                    onClick={() => onOpenPool?.(rig, info)}
                  >
                    Pools
                  </button>
                )}

                {isRented && info && (
                  <button 
                    className="btn-pro secondary" 
                    style={{ width: '36px', fontSize: '14px', padding: '6px 0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
                    onClick={() => fetchRigDetailInfo(rig)}
                    disabled={infoLoadingId === rig.id}
                    title="Refresh Stats"
                  >
                    {infoLoadingId === rig.id ? '...' : '↻'}
                  </button>
                )}

                <button 
                  className="btn-pro" 
                  style={{ flex: 1, fontSize: '11px', padding: '6px' }} 
                  onClick={() => info ? setEnrichedInfo(prev => { const n = {...prev}; delete n[rig.id]; return n; }) : fetchRigDetailInfo(rig)}
                  disabled={infoLoadingId === rig.id}
                >
                  {infoLoadingId === rig.id ? '...' : info ? 'Hide Info' : 'More Info'}
                </button>
              </div>
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
