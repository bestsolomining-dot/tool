import { useState } from 'react';

export default function MiningRig({ onCall }) {
  const [rigId, setRigId] = useState('');
  const [actionRigId, setActionRigId] = useState('');
  const [rigAction, setRigAction] = useState('START');

  const fetchRigDetails = () => {
    const id = rigId.trim();
    if (!id) return;
    onCall(`/api/v2/mining/rig2/${encodeURIComponent(id)}`);
  };

  const submitRigAction = () => {
    const id = actionRigId.trim();
    if (!id) return;
    onCall('/api/v2/mining/rigs/status2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rigId: id, action: rigAction }),
    });
  };

  return (
    <>
      <div className="button-group">
        <button className="btn-pro" onClick={() => onCall('/api/v2/mining/rigs2')}>
          List Rigs (v2)
        </button>
        <button className="btn-pro" onClick={() => onCall('/api/v2/mining/address')}>
          Mining Address
        </button>
      </div>

      <div className="market-inputs" style={{ marginTop: '10px' }}>
        <input
          className="input-pro"
          placeholder="Rig ID for details"
          value={rigId}
          onChange={(e) => setRigId(e.target.value)}
        />
        <button className="btn-pro" onClick={fetchRigDetails}>
          Get Rig Details
        </button>
      </div>

      <div className="market-inputs" style={{ marginTop: '10px' }}>
        <input
          className="input-pro"
          placeholder="Rig ID for action"
          value={actionRigId}
          onChange={(e) => setActionRigId(e.target.value)}
        />
        <select className="select-pro" value={rigAction} onChange={(e) => setRigAction(e.target.value)}>
          <option value="START">START</option>
          <option value="STOP">STOP</option>
          <option value="RESTART">RESTART</option>
        </select>
        <button className="btn-pro secondary" onClick={submitRigAction}>
          Apply Action
        </button>
      </div>
    </>
  );
}
