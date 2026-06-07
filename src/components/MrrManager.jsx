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
      // Refactored to use the account-level pool endpoint
      const path = targetIds 
        ? `/api/v2/mrr/account/pool/${encodeURIComponent(targetIds)}`
        : '/api/v2/mrr/account/pool';
        
      const response = await onCall(path, { method: 'GET', query: { client: mrrClient }, silent: true });
      if (response?.success) {
        const data = Array.isArray(response.data) ? response.data : [response.data];
        setRigs(data);
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
        setRigs(Array.isArray(response.data) ? response.data : []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (externalPoolData) {
      // Use the data already fetched by the parent if available
      const data = Array.isArray(externalPoolData.data) ? externalPoolData.data : [externalPoolData.data || externalPoolData];
      setRigs(data.filter(r => r && (r.rigid || r.pools)));
    } else {
      (externalRigId || rentalIds) ? fetchPools() : fetchRigs();
    }
  }, [rentalIds, externalPoolData, externalRigId, onCall, mrrClient]);

  const updateRigConfig = async (rigId, config) => {
    setLoading(true);
    try {
      const response = await onCall(`/api/v2/mrr/rig/${rigId}`, {
        method: 'POST',
        body: config,
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
      const response = await onCall(`/api/v2/mrr/rig/${rig.rigid || rig.id}/pool`, {
        method: 'PUT',
        body: { pools },
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

  const handleEditPool = (pool, rigid) => {
    setEditorState({
      initialData: {
        ...pool,
        algo: pool.type, // Map 'type' from MRR API to internal 'algo' field
        rigid
      },
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
                <option key={r.rigid || r.id} value={r.rigid || r.id}>Rig ID: {r.rigid || r.id}</option>
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
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#60a5fa' }}>Rig ID: {rig.rigid}</h3>
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
                  style={{ display: 'grid', gridTemplateColumns: '30px 45px 70px 1fr 130px 50px', gap: '0.8rem', alignItems: 'center', fontSize: '0.75rem', background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '4px', cursor: 'grab' }}
                >
                  <div style={{ opacity: 0.3, cursor: 'grab' }}>☰</div>
                  <input 
                    type="number" 
                    className="input-pro" 
                    style={{ width: '40px', padding: '2px', fontSize: '10px', textAlign: 'center' }}
                    value={pool.priority}
                    onChange={(e) => handlePriorityChange(rig, idx, e.target.value)}
                  />
                  <div style={{ fontWeight: 'bold', color: '#34d399', fontSize: '10px' }}>{pool.type}</div>
                  <div style={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pool.host}:{pool.port}</div>
                  <div style={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pool.user}</div>
                  <button className="text-button" onClick={() => handleEditPool(pool, rig.rigid)}>Edit</button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {editorState && (
          <PoolEditorPopup
            editor={editorState}
            onClose={() => setEditorState(null)}
            onSaveSuccess={() => { setEditorState(null); fetchPools(); }}
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