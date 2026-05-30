import React, { useState, useEffect, useCallback } from 'react';

/**
 * MrrPoolsManager - Unified component for viewing and managing MRR Rig Pools.
 * Merges rig listing with individual pool editing logic.
 */
const MrrPoolsManager = ({ defaultClient = 'ALL' }) => {
  const [rigs, setRigs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedClient, setSelectedClient] = useState(defaultClient);
  const [editingRig, setEditingRig] = useState(null);
  const [updateStatus, setUpdateStatus] = useState(null);

  // Fetch rigs and their merged pool info
  const fetchRigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // endpoint=/rig/mine in index.js automatically merges pool info into the rig object
      const resp = await fetch(`/api/v2/mrr/rigs?client=${selectedClient}&endpoint=/rig/mine`);
      const result = await resp.json();

      if (result.success) {
        setRigs(result.rigs || []);
      } else {
        setError(result.message || 'Failed to fetch rigs');
      }
    } catch (err) {
      setError('Network error while fetching rigs');
    } finally {
      setLoading(false);
    }
  }, [selectedClient]);

  useEffect(() => {
    fetchRigs();
  }, [fetchRigs]);

  const handleEditPool = (rig) => {
    setEditingRig({
      id: rig.id,
      name: rig.name,
      host: rig.host || '',
      port: rig.port || '',
      user: rig.user || '',
      pass: rig.pass || 'x',
      client: rig.mrrClient || selectedClient
    });
    setUpdateStatus(null);
  };

  const handleUpdatePool = async (e) => {
    e.preventDefault();
    setUpdateStatus({ type: 'info', message: 'Updating pool...' });

    try {
      const resp = await fetch(`/api/v2/mrr/rig/${editingRig.id}/pool?client=${editingRig.client}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pools: [{
            host: editingRig.host,
            port: Number(editingRig.port),
            user: editingRig.user,
            pass: editingRig.pass,
            priority: 0
          }]
        })
      });

      const result = await resp.json();
      if (result.success) {
        setUpdateStatus({ type: 'success', message: 'Pool updated successfully!' });
        setTimeout(() => {
          setEditingRig(null);
          fetchRigs();
        }, 1500);
      } else {
        setUpdateStatus({ type: 'error', message: result.message || 'Update failed' });
      }
    } catch (err) {
      setUpdateStatus({ type: 'error', message: 'Network error during update' });
    }
  };

  return (
    <div className="mrr-pools-container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>MRR Pool Manager</h2>
        <div className="controls">
          <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
            <option value="ALL">All Clients</option>
            <option value="BT">BT (Primary)</option>
            <option value="SL">SL (Secondary)</option>
            <option value="VN">VN (Vietnam)</option>
          </select>
          <button onClick={fetchRigs} disabled={loading}>Refresh</button>
        </div>
      </header>

      {error && <div className="error-banner" style={{ color: 'red' }}>{error}</div>}

      {loading ? (
        <p>Loading rigs and pool configurations...</p>
      ) : (
        <table width="100%" border="1" style={{ borderCollapse: 'collapse', marginTop: '1rem' }}>
          <thead>
            <tr style={{ background: '#f4f4f4' }}>
              <th>ID</th>
              <th>Name</th>
              <th>Algorithm</th>
              <th>Current Pool (Stratum)</th>
              <th>User</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rigs.map((rig) => (
              <tr key={`${rig.mrrClient}-${rig.id}`}>
                <td>{rig.id}</td>
                <td>{rig.name} <br/><small>({rig.mrrClient})</small></td>
                <td>{rig.type}</td>
                <td>{rig.host ? `${rig.host}:${rig.port}` : 'No Pool Configured'}</td>
                <td>{rig.user || '-'}</td>
                <td>
                  <button onClick={() => handleEditPool(rig)}>Edit Pool</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Modal / Inline Editor for Single Rig Pool */}
      {editingRig && (
        <div className="modal-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
          <div className="modal-content" style={{ background: 'white', padding: '2rem', borderRadius: '8px', minWidth: '400px' }}>
            <h3>Edit Pool for: {editingRig.name}</h3>
            <form onSubmit={handleUpdatePool} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label>
                Stratum Host:
                <input type="text" fullWidth value={editingRig.host} 
                  onChange={e => setEditingRig({...editingRig, host: e.target.value})} required />
              </label>
              <label>
                Port:
                <input type="number" value={editingRig.port} 
                  onChange={e => setEditingRig({...editingRig, port: e.target.value})} required />
              </label>
              <label>
                Worker/User:
                <input type="text" value={editingRig.user} 
                  onChange={e => setEditingRig({...editingRig, user: e.target.value})} required />
              </label>
              <label>
                Password:
                <input type="text" value={editingRig.pass} 
                  onChange={e => setEditingRig({...editingRig, pass: e.target.value})} />
              </label>

              {updateStatus && (
                <div style={{ color: updateStatus.type === 'error' ? 'red' : 'green', margin: '10px 0' }}>
                  {updateStatus.message}
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="submit" style={{ background: '#4CAF50', color: 'white', padding: '10px' }}>Save Changes</button>
                <button type="button" onClick={() => setEditingRig(null)} style={{ padding: '10px' }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MrrPoolsManager;