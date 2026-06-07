import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import PoolEditorPopup from './PoolEditorPopup';

/**
 * MrrPoolManager Component
 * 
 * A popup modal used to manage stratum pools for Mining Rig Rentals (MRR).
 * Handles both external data passed from App.jsx or fetching by rentalIds.
 */
export default function MrrPoolManager({ onCall, mrrClient, externalPoolData, externalRigId, externalRentalId, rentalIds, onClose }) {
  const [rigs, setRigs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editorState, setEditorState] = useState(null);
  const [activeRigId, setActiveRigId] = useState(null);
  const [draggedItemIndex, setDraggedItemIndex] = useState(null);

  /** Helper to merge new rig data into existing state to preserve metadata */
  const updateRigsState = (newData) => {
    setRigs(prev => {
      const incoming = Array.isArray(newData) ? newData : [newData];
      const existingMap = new Map(prev.map(r => [String(r.rigid || r.id), r]));
      
      incoming.forEach(item => {
        if (!item) return;
        const id = String(item.rigid || item.id);
        if (existingMap.has(id)) {
          // Merge: new data overwrites, existing data is preserved if not in update
          existingMap.set(id, { ...existingMap.get(id), ...item });
        } else {
          existingMap.set(id, item);
        }
      });
      
      return Array.from(existingMap.values());
    });
  };

  // Synchronize activeRigId with external selection or pick the first available
  useEffect(() => {
    if (externalRigId) {
      setActiveRigId(externalRigId);
    } else if (rigs.length > 0 && (!activeRigId || !rigs.some(r => String(r.rigid || r.id) === String(activeRigId)))) {
      setActiveRigId(rigs[0].rigid || rigs[0].id);
    }
  }, [rigs, activeRigId, externalRigId]);

  const fetchPools = async (ids = null) => {
    const targetIds = ids || externalRigId || (Array.isArray(rentalIds) ? rentalIds.join(';') : rentalIds);
    setLoading(true);
    setError(null);
    try {
      // If we are fetching for a specific rig, use the rig endpoint. 
      // Otherwise, use the account-level pool profile endpoint.
      const isSingleRig = targetIds && !Array.isArray(rentalIds) && !targetIds.includes(';');
      const path = isSingleRig 
        ? `/api/v2/mrr/rig/${encodeURIComponent(targetIds)}/pool`
        : `/api/v2/mrr/account/pool/${targetIds ? encodeURIComponent(targetIds) : ''}`;

      const query = { client: mrrClient };

      const response = await onCall(path, { method: 'GET', query, silent: true });
      if (response?.success) {
        const rawData = Array.isArray(response.data) ? response.data : [response.data];
        // Normalize flat pool configurations (profiles) to the rig/pools structure used by the UI
        const normalized = rawData.map(item => {
          // A Profile specifically has host/port info and lacks rig-specific 'status'
          const isActualProfile = item && !item.pools && item.host && item.port;
          if (isActualProfile) {
            return { ...item, rigid: item.rigid || item.id, pools: [item], isProfile: true };
          }
          return item;
        });
        updateRigsState(normalized);
      } else {
        setError(response?.message || 'API responded with failure');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchRigs = async () => {
    setLoading(true);
    setError(null);
    try {
      // Refactored to use the new general rig listing endpoint
      const response = await onCall('/api/v2/mrr/rig', { method: 'GET', query: { client: mrrClient }, silent: true });
      if (response?.success) {
        updateRigsState(Array.isArray(response.data) ? response.data : []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Clear current rigs when switching client context to ensure clean state
    setRigs([]);
    setActiveRigId(null);
  }, [mrrClient]);

  useEffect(() => {
    if (externalPoolData) {
      const rawData = Array.isArray(externalPoolData.data) ? externalPoolData.data : [externalPoolData.data || externalPoolData];
      // Normalize external data if it's a flat pool list
      const normalized = rawData.map(item => {
        if (item && !item.pools && (item.host || item.name)) {
          return { ...item, rigid: item.rigid || item.id, pools: [item], isProfile: true };
        }
        return item;
      });
      const validData = normalized.filter(r => r && (r.rigid || r.pools));
      if (validData.length > 0) updateRigsState(validData);
    } else {
      (externalRigId || rentalIds) ? fetchPools() : fetchRigs();
    }
  }, [rentalIds, externalPoolData, externalRigId, onCall, mrrClient]);

  const updateRigConfig = async (rigId, config) => {
    setLoading(true);
    try {
      const rig = rigs.find(r => String(r.rigid || r.id) === String(rigId));
      const response = await onCall(`/api/v2/mrr/rig/${rigId}`, {
        method: 'PUT',
        body: { ...config, name: rig?.name },
        query: { client: mrrClient },
        showModal: true
      });
      if (response?.success) {
        externalRigId || rentalIds ? fetchPools() : fetchRigs();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updatePools = async (rig, pools) => {
    setLoading(true);
    try {
      const rigId = rig.rigid || rig.id;
      const endpoint = rig.isProfile ? `/api/v2/mrr/account/pool/${rigId}` : `/api/v2/mrr/rig/${rigId}/pool`;
      // For account profiles, send the pool object directly. For rigs, send the wrapped pools array.
      const body = rig.isProfile ? (pools[0] || {}) : { pools };

      const response = await onCall(endpoint, {
        method: 'PUT',
        body,
        query: { client: mrrClient },
        showModal: true
      });
      if (response?.success) {
        fetchPools();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedItemIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e) => { e.preventDefault(); };

  const handleDrop = async (e, index, rig) => {
    e.preventDefault();
    if (draggedItemIndex === null || draggedItemIndex === index) return;
    const updatedPools = [...rig.pools];
    const [movedItem] = updatedPools.splice(draggedItemIndex, 1);
    updatedPools.splice(index, 0, movedItem);
    const prioritized = updatedPools.map((p, i) => ({ ...p, priority: i }));
    await updatePools(rig, prioritized);
    setDraggedItemIndex(null);
  };

  const handlePriorityChange = async (rig, poolIndex, newPriority) => {
    const updatedPools = [...rig.pools];
    updatedPools[poolIndex] = {
      ...updatedPools[poolIndex],
      priority: parseInt(newPriority) || 0
    };
    await updatePools(rig, updatedPools);
  };

  const handleEditPool = (pool, rig) => {
    setEditorState({
      initialData: pool, // Pass raw MRR pool data without metadata pollution
      label: pool.name || rig.name || (rig.isProfile ? 'Pool Profile' : 'Rig Pool'),
      rig,
      isNew: false
    });
  };

  const content = (
    <div className="mrr-pool-manager-inner">
      <div className="panel-header" style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <h3 style={{ margin: 0, fontSize: '1.25rem', whiteSpace: 'nowrap', padding: '10px' }}>Pool Configuration</h3>
          {rigs.length > 1 && (
            <select 
              className="select-pro" 
              style={{ minWidth: '150px', fontSize: '12px', padding: '2px 8px', height: '32px' }}
              value={activeRigId || ''}
              onChange={(e) => setActiveRigId(e.target.value)}
            >
              {rigs.map(r => (
                <option key={r.rigid || r.id} value={r.rigid || r.id}>{r.name || (r.isProfile ? 'Pool' : 'Rig')} (ID: {r.rigid || r.id})</option>
              ))}
            </select>
          )}
        </div>
        {onClose && <button className="close-button" onClick={onClose}>&times;</button>}
      </div>
      <div className="panel-body" style={{ padding: '5px 0' }}>
        {loading && <div style={{ textAlign: 'center', opacity: 0.6, padding: '1rem' }}>Loading rig pool data...</div>}
        {!loading && !error && rigs.length === 0 && <div style={{ opacity: 0.4, fontSize: '12px', textAlign: 'center', padding: '20px' }}>No rig selected. Click "Pools" on a rig to manage.</div>}
        {error && <div style={{ color: '#f87171', padding: '0.5rem', textAlign: 'center', fontSize: '12px' }}>{error}</div>}

        {!loading && !error && rigs.filter(r => !activeRigId || String(r.rigid || r.id) === String(activeRigId)).map((rig) => (
          <div key={rig.rigid} style={{ marginBottom: '2rem', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px' }}>
            <div style={{ marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#60a5fa' }}>{rig.name || (rig.isProfile ? 'Pool Profile' : 'Rig')} (ID: {rig.rigid || rig.id})</h3>
              {!rig.isProfile && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <label style={{ fontSize: '10px', opacity: 0.6 }}>Price:</label>
                    <input 
                      type="number" 
                      className="input-pro" 
                      style={{ width: '100px', height: '24px', fontSize: '11px' }}
                      defaultValue={rig.price || rig.min_price}
                      onBlur={(e) => updateRigConfig(rig.rigid || rig.id, { price: e.target.value })}
                    />
                  </div>
                  <button 
                    className="text-button" 
                    style={{ color: rig.status === 'disabled' ? '#10b981' : '#f87171', fontSize: '11px' }}
                    onClick={() => updateRigConfig(rig.rigid || rig.id, { status: rig.status === 'disabled' ? 'available' : 'disabled' })}
                  >
                    {rig.status === 'disabled' ? 'Enable Rig' : 'Disable Rig'}
                  </button>
                </div>
              )}
            </div>

            <div className="pool-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {rig.pools?.map((pool, idx) => (
                <div 
                  key={idx} 
                  className="pool-item" 
                  draggable 
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, idx, rig)}
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '24px 45px 1.2fr 1.5fr 1fr 60px', 
                    gap: '12px', 
                    alignItems: 'center', 
                    fontSize: '11px', 
                    background: 'rgba(255,255,255,0.02)', 
                    padding: '10px 12px', 
                    borderRadius: '6px', 
                    cursor: 'grab',
                    border: '1px solid rgba(255,255,255,0.03)',
                    marginBottom: '2px'
                  }}
                >
                  <div style={{ opacity: 0.2, cursor: 'grab', fontSize: '14px' }}>⋮⋮</div>
                  <input 
                    type="number" 
                    className="input-pro" 
                    style={{ width: '100%', height: '26px', padding: '2px', fontSize: '10px', textAlign: 'center', background: 'rgba(0,0,0,0.2)' }}
                    value={pool.priority}
                    onChange={(e) => handlePriorityChange(rig, idx, e.target.value)}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                    <div style={{ fontWeight: '600', color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pool.name || 'Unnamed Pool'}
                      {pool.nhPoolName && <span style={{ color: '#10b981', marginLeft: '6px', fontSize: '9px', fontWeight: 'normal' }}>({pool.nhPoolName})</span>}
                    </div>
                    <div style={{ fontSize: '9px', textTransform: 'uppercase', color: '#60a5fa', opacity: 0.8, letterSpacing: '0.02em' }}>
                      {pool.type || 'N/A'}
                    </div>
                  </div>

                  <div style={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '10px' }}>
                    <span style={{ opacity: 0.4 }}>host:</span> {pool.host}:{pool.port}
                  </div>
                  <div style={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '10px' }}>
                    <span style={{ opacity: 0.4 }}>user:</span> {pool.user}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <button className="text-button" style={{ color: '#60a5fa', fontWeight: '600' }} onClick={() => handleEditPool(pool, rig)}>Edit</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {editorState && (
          <PoolEditorPopup
            editor={editorState}
            onClose={() => setEditorState(null)}
            onSave={async (updatedData) => {
              const rig = editorState.rig;
              const updatedPools = [...(rig.pools || [])];
              // Find and replace the edited pool in the local array
              const idx = updatedPools.findIndex(p => 
                (p.id && p.id === updatedData.id) || (p.priority === updatedData.priority)
              );
              if (idx > -1) updatedPools[idx] = updatedData;
              else updatedPools[0] = updatedData;

              await updatePools(rig, updatedPools);
              setEditorState(null);
              fetchPools();
            }}
          />
        )}
      </div>
    </div>
  );

  if (rentalIds && !externalPoolData) {
    return (
      <Modal isOpen={true} onClose={onClose} title="Pool Manager" maxWidth="1000px">
        {content}
      </Modal>
    );
  }

  return content;
}