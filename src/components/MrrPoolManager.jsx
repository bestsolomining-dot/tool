import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import PoolEditorPopup from './PoolEditorPopup';

/**
 * MrrPoolManager Component
 * 
 * A popup modal used to manage stratum pools for Mining Rig Rentals (MRR).
 * Maps the MRR 'type' field to algorithm name for the pool editor.
 */
export default function MrrPoolManager({ rentalIds, onCall, onClose }) {
  const [rigs, setRigs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editorState, setEditorState] = useState(null);

  const fetchPools = async () => {
    if (!rentalIds) return;
    setLoading(true);
    setError(null);
    try {
      // IDs can be semi-colon separated string per user notes: /rental/[ID1];[ID2]/pool
      const ids = Array.isArray(rentalIds) ? rentalIds.join(';') : rentalIds;
      const response = await onCall(`/api/v1/rental/${ids}/pool`, {
        method: 'GET',
        silent: true
      });

      if (response?.success) {
        // Handle both object (single rig) and array (multiple rigs) responses
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

  useEffect(() => {
    fetchPools();
  }, [rentalIds, onCall]);

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

  return (
    <Modal isOpen={true} onClose={onClose} title="Pool Manager" maxWidth="1000px">
      <div className="panel-body" style={{ padding: '1rem' }}>
        {loading && <div style={{ textAlign: 'center', opacity: 0.6, padding: '2rem' }}>Loading rig pool data...</div>}
        {error && <div style={{ color: '#f87171', padding: '1rem', textAlign: 'center' }}>{error}</div>}
        
        {!loading && !error && rigs.map((rig) => (
          <div key={rig.rigid} style={{ marginBottom: '2rem', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px' }}>
            <div style={{ marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#60a5fa' }}>Rig ID: {rig.rigid}</h3>
            </div>
            
            <div className="pool-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {rig.pools.map((pool, idx) => (
                <div key={idx} className="pool-item" style={{ display: 'grid', gridTemplateColumns: '50px 100px 1fr 200px 80px', gap: '1rem', alignItems: 'center', fontSize: '0.85rem' }}>
                  <div style={{ opacity: 0.5 }}>PR {pool.priority}</div>
                  <div style={{ fontWeight: 'bold', color: '#34d399' }}>{pool.type}</div>
                  <div style={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pool.host}:{pool.port}</div>
                  <div style={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pool.user}</div>
                  <button className="btn-pro secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => handleEditPool(pool, rig.rigid)}>Edit</button>
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
    </Modal>
  );
}