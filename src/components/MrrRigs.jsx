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

function getRentalStartTime(rental) {
  return rental?.start || rental?.normalized?.startTime || null;
}

function formatRentalStartTime(startTime) {
  if (!startTime) return 'N/A';
  const normalized = /\bUTC\b/i.test(String(startTime)) ? String(startTime) : `${startTime} UTC`;
  const date = new Date(normalized);
  if (isNaN(date.getTime())) return startTime;

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return `Starts at ${date.toLocaleTimeString()}`;

  const diffSec = Math.floor(diffMs / 1000);
  const d = Math.floor(diffSec / 86400);
  const h = Math.floor((diffSec % 86400) / 3600);
  const m = Math.floor((diffSec % 3600) / 60);

  let elapsed = '';
  if (d > 0) elapsed += `${d}d `;
  if (h > 0 || d > 0) elapsed += `${h}h `;
  elapsed += `${m}m`;

  return `Started ${elapsed} ago`;
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
  const [loadingInfoIds, setLoadingInfoIds] = useState(new Set());

  const [expandedAlgos, setExpandedAlgos] = useState({}); // algoKey -> boolean
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

  const groupedRigs = useMemo(() => {
    const groups = {};
    filteredRigs.forEach(rig => {
      const info = enrichedInfo[rig.id];
      const algoKey = (info?.algo || rig.algo || rig.algorithm || rig.type || 'N/A').toUpperCase();
      if (!groups[algoKey]) groups[algoKey] = [];
      groups[algoKey].push(rig);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRigs, enrichedInfo]);

  const toggleAlgoGroup = (algo) => {
    setExpandedAlgos(prev => ({
      ...prev,
      [algo]: !prev[algo]
    }));
  };

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
    const statusStr = String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toLowerCase();
    const isRented = statusStr.includes('rented') || statusStr.includes('active');

    // Extract physical Rig ID and Rental ID correctly for fetching detailed info
    const rigId = rig.rigid || rig.rig_id || rig.rig?.id || (isRented ? '' : rig.id);
    const rentalId = rig.rentalid || rig.current_rental_id || rig.rental_id || (isRented ? rig.id : '');

    setLoadingInfoIds(prev => new Set(prev).add(rig.id));
    try {
      const apiBase = window.location.port === '5173'
        ? `${window.location.protocol}//${window.location.hostname}:3000`
        : '';

      const url = (isRented && rentalId) 
        ? `${apiBase}/api/v2/mrr/rental/${encodeURIComponent(rentalId)}?client=${mrrClient}` 
        : `${apiBase}/api/v2/mrr/rig/${encodeURIComponent(rigId || rig.id)}/info?client=${mrrClient}`;

      const result = await fetch(url);
      const data = await result.json();
      if (data && !data.error) {
        let infoBoxData;
        if (isRented && rentalId) {
          const rental = data.data || data;
          const pools = rental.pools || [];
          const firstPool = pools[0];
          infoBoxData = {
            stratumHost: firstPool?.host || firstPool?.stratumHost || firstPool?.stratumHostname || rental.rig?.stratumHost || rental.rig?.host || rental.rig?.stratumHostname || 'N/A',
            stratumPort: firstPool?.port || firstPool?.stratumPort || rental.rig?.stratumPort || rental.rig?.port || '',
            username: firstPool?.user || firstPool?.username || rental.rig?.username || rental.rig?.user || 'N/A',
            algo: getRentalAlgorithm(rental),
            percent: getRentalEfficiency(rental),
            startTime: getRentalStartTime(rental),
            endTime: getRentalEndTime(rental),
            advertised: getRentalAdvertisedHashrate(rental),
            average: getRentalAverageHashrate(rental),
            pools: pools.map(p => ({
              host: p.host || p.stratumHost || p.stratumHostname || rental.rig?.stratumHost || rental.rig?.host || 'N/A',
              port: p.port || p.stratumPort || rental.rig?.stratumPort || rental.rig?.port || 'N/A',
              username: p.user || p.username || rental.rig?.username || rental.rig?.user || 'N/A',
            })),
            isRental: true,
          };
        } else {
          // For rig info, the data is already structured correctly by the backend's extractRigInfo
          infoBoxData = data;
        }
        setEnrichedInfo(prev => ({ ...prev, [rig.id]: infoBoxData }));
      }
    } catch (err) {
      console.error("Failed to fetch rig info:", err);
    } finally {
      setLoadingInfoIds(prev => {
        const next = new Set(prev);
        next.delete(rig.id);
        return next;
      });
    }
  };

  useEffect(() => {
    if (mrrClient && endpoint) fetchRigs(); // Re-fetch if endpoint changes
  }, [mrrClient, endpoint]);

  // Auto-fetch details for rented rigs so "Started X ago" and "Eff" show up automatically
  useEffect(() => {
    if (loading) return;
    const rentedWithoutInfo = filteredRigs.filter(r => {
      const s = String(typeof r.status === 'object' ? r.status.status : r.status || '').toLowerCase();
      return (s.includes('rented') || s.includes('active')) && !enrichedInfo[r.id] && !loadingInfoIds.has(r.id);
    });

    if (rentedWithoutInfo.length > 0) {
      rentedWithoutInfo.forEach(r => fetchRigDetailInfo(r));
    }
  }, [filteredRigs, enrichedInfo, loading, loadingInfoIds]);

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

      <div className="rig-list" style={{ marginTop: '15px', position: 'relative', flexGrow: 1, display: 'flex', flexDirection: 'column', maxHeight: '800px', overflowY: 'auto', paddingRight: '2px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(143, 64, 64, 0.59) transparent', overscrollBehavior: 'contain' }}>
        {filteredRigs.length === 0 && !loading && !error && (
          <div style={{ opacity: 0.5, textAlign: 'center', padding: '20px' }}>No rigs found for this account.</div>
        )}
        
        <div className="rig-grid-container" style={{ 
          minHeight: '800px',
          maxHeight: 'auto',
          overflowY: 'auto', 
          paddingRight: '8px',
          overscrollBehavior: 'contain'
        }}>
          {groupedRigs.map(([algoName, rigsInGroup]) => {
            const isExpanded = expandedAlgos[algoName];
            return (
              <div key={algoName} className="algo-group-container" style={{ marginBottom: '10px' }}>
                <div 
                  className="algo-group-header" 
                  onClick={() => toggleAlgoGroup(algoName)}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    padding: '10px 15px', 
                    background: isExpanded ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.03)', 
                    borderRadius: '6px', 
                    cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,0.05)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '14px', color: isExpanded ? '#60a5fa' : '#94a3b8', fontWeight: 'bold' }}>{algoName}</span>
                    <span style={{ fontSize: '10px', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: '10px', opacity: 0.7 }}>{rigsInGroup.length} Rigs</span>
                  </div>
                  <span style={{ fontSize: '12px', opacity: 0.5 }}>{isExpanded ? '▲' : '▼'}</span>
                </div>

                {isExpanded && (
                  <div className="rig-grid" style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
                    gap: '15px',
                    padding: '15px 5px'
                  }}>
                    {rigsInGroup.map((rig) => {
            const rigId = rig.id || rig.rigid || rig.rig_id;
            const isMine = rigId && userRigIds.has(String(rigId));
            const info = enrichedInfo[rig.id];
            const statusStr = String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toLowerCase();
            const isRented = statusStr.includes('rented');
            const rentalId = rig.rentalid || rig.current_rental_id || rig.rental_id;
            const displayId = (isRented && rentalId) ? rentalId : rig.id;
            const idLabel = (isRented && rentalId) ? 'Rental' : 'Rig';

            return (
              <div key={rig.id} style={{padding: '0', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {isMine ? (
                  <div style={{ padding: '0 2px' }}>
                    <span style={{ background: '#5c005f', color: 'white', fontSize: '8px', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase', display: 'inline-block' }}>
                      {idLabel}: #{displayId} 
                      {rig.mrrClient && (
                        <span style={{ padding: '3px 3px 3px 3px', marginTop: '-10px', fontSize: '13px', opacity: 1.5, marginTop: '3px', marginLeft: '3px', color: rig.mrrClient === 'SL' ? '#3b82f6' : rig.mrrClient === 'BT' ? '#fbbf24' : rig.mrrClient === 'ALL' ? '#ef4444' : 'inherit' }}>
                          [{rig.mrrClient}]
                        </span>
                      )}
                    </span>
                  </div>
                ) : null}
                <div className="rig-card" style={{ 
                  background: isMine ? 'rgba(59, 130, 246, 0.1)' : 'rgba(30, 41, 59, 0.4)', 
                  border: isMine ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255,255,255,0.1)', 
                  borderRadius: '8px', 
                  padding: '10px',
                  position: 'relative'
                }}>
                
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', gap: '8px' }}>
                <strong style={{ fontSize: '12px', lineHeight: '1.2', flex: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{rig.name}</strong>
                <span 
                  style={{ 
                    fontSize: '9px', 
                    fontWeight: 'bold', 
                    padding: '2px 6px', 
                    borderRadius: '4px', 
                    letterSpacing: '0.5px',
                    whiteSpace: 'nowrap',
                    ...getStatusClass(rig.status)
                  }}>
                  {(() => {
                    const s = String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toUpperCase();
                    return s.includes('AVAILABLE') ? 'AVAILABLE' : s.includes('RENTED') ? 'RENTED' : s;
                  })()}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '10px', marginBottom: '8px' }}>
                <div>
                  <div style={{ opacity: 0.5, fontSize: '8px', textTransform: 'uppercase' }}>Algo</div>
                  <div style={{ color: '#60a5fa' }}>{info?.algo || rig.algo || rig.algorithm || rig.type || 'N/A'}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ opacity: 0.5, fontSize: '8px', textTransform: 'uppercase' }}>
                    Avg Hashrate
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
                      <div style={{ fontSize: '11px', opacity: 0.7 }}>
                        Advertised: <span style={{ color: '#34d399' }}>{info.advertised}</span>
                      </div>
                    )}

                  </div>
                </div>
                <div>
                  <div style={{ opacity: 0.5, fontSize: '8px', textTransform: 'uppercase' }}>Price</div>
                  <div style={{ color: '#fbbf24' }}>
                    {(() => {
                      let p = rig.price;
                      if (typeof p === 'object' && p !== null) {
                        const unit = rig.price_converted || 'BTC';
                        p = p[unit]?.price ?? p[unit] ?? '0.00';
                      }
                      if (endpoint === '/rig' && !p) { // Marketplace fallback
                        p = rig.min_price || rig.price;
                      }
                      return p || '0.00';
                    })()}
                    <small style={{ opacity: 0.5, marginLeft: '2px' }}>{rig.price_unit || 'BTC'}</small>
                  </div>
                </div>
                <div>
                  <div style={{ opacity: 0.5, fontSize: '8px', textTransform: 'uppercase' }}>Start Time</div>
                  <div style={{ fontSize: (info?.startTime || rig.start) ? '8px' : '10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={info?.startTime || rig.start || ''}>
                    {formatRentalStartTime(info?.startTime || rig.start)}
                  </div>
                </div>
              </div>

              {(info || rig.host) && (
                <div className="rig-pool-summary" style={{ background: 'rgba(0,0,0,0.25)', padding: '8px', borderRadius: '6px', marginBottom: '10px', fontSize: '10px', border: '1px solid rgba(255,255,255,0.02)', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.2)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={info?.stratumHost || rig.host}><span style={{ opacity: 0.5 }}>Host:</span> {info?.stratumHost || rig.host || 'N/A'}</div>
                    <div><span style={{ opacity: 0.5 }}>Port:</span> {info?.stratumPort || rig.port || 'N/A'}</div>
                    <div style={{ gridColumn: 'span 2', overflow: 'hidden', textOverflow: 'ellipsis' }} title={info?.username || rig.user}><span style={{ opacity: 0.5 }}>User:</span> {info?.username || rig.user || 'N/A'}</div>
                  </div>
                  {isRented && (
                    <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {/* Fix: use rig.hashrate for list-view rentals to show efficiency immediately */}
                      {(() => {
                        const eff = info?.percent || rig.hashrate?.average?.percent || rig.percent || '0.00';
                        return <div><span style={{ opacity: 0.6 }}>Eff:</span> <span style={{ color: (parseFloat(eff) || 0) < 90 ? '#f87171' : '#34d399' }}>{eff}%</span></div>;
                      })()}
                      <div style={{ fontSize: '9px', textAlign: 'right' }}>
                        <div style={{ marginBottom: '2px' }}>{formatRentalStartTime(info?.startTime || rig.start)}</div>
                        <div><span style={{ opacity: 0.6 }}>Ends:</span> <CountdownTimer endTime={info?.endTime || rig.end || (typeof rig.status === 'object' ? rig.status.end : null)} /></div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
                {(isMine || isRented) && (
                  <button 
                    className="btn-pro secondary" 
                    style={{ 
                      flex: 1, 
                      fontSize: '10px', 
                      padding: '4px',
                      background: isRented ? 'rgba(167, 139, 250, 0.15)' : undefined,
                      borderColor: isRented ? '#a78bfa' : undefined,
                      color: isRented ? '#a78bfa' : undefined,
                      fontWeight: isRented ? 'bold' : 'normal'
                    }} 
                    onClick={() => onOpenPool?.(rig, info)}
                  >
                    {isRented ? 'Details & Pools' : 'Pools'}
                  </button>
                )}

                {isRented && info && (
                  <button 
                    className="btn-pro secondary" 
                    style={{ width: '28px', fontSize: '12px', padding: '4px 0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
                    onClick={() => fetchRigDetailInfo(rig)}
                    disabled={loadingInfoIds.has(rig.id)}
                    title="Refresh Stats"
                  >
                    {loadingInfoIds.has(rig.id) ? '...' : '↻'}
                  </button>
                )}

                <button 
                  className="btn-pro" 
                  style={{ flex: 1, fontSize: '10px', padding: '4px' }} 
                  onClick={() => info ? setEnrichedInfo(prev => { const n = {...prev}; delete n[rig.id]; return n; }) : fetchRigDetailInfo(rig)}
                  disabled={loadingInfoIds.has(rig.id)}
                >
                  {loadingInfoIds.has(rig.id) ? '...' : info ? 'Hide Info' : 'More Info'}
                </button>
              </div>
            </div>
            </div>
                    )})}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
