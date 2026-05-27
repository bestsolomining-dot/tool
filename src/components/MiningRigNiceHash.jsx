import { useState, useEffect } from 'react';
import Accounting from './Accounting';

export default function MiningRigNiceHash({ onCall, output }) {
  const [getOrderDetail, setOrderId] = useState('');
  const [rigId, setRigId] = useState('');
  const [actionRigId, setActionRigId] = useState('');
  const [rigAction, setRigAction] = useState('START');

  useEffect(() => {
    onCall('/api/v2/mining/rigs2');
  }, []);

  const fetchRigDetails = () => {
    const id = rigId.trim();
    if (!id) return;
    // NiceHash V2 uses rig2 for detailed rig information
    onCall(`/api/v2/mining/rig2/${encodeURIComponent(id)}`);
  };

  const submitRigAction = () => {
    const id = actionRigId.trim();
    if (!id) return;
    onCall('/api/v2/mining/rigs/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rigId: id, action: rigAction }),
    });
  };

  return (
    <div className="rig-section nh-theme">
      <h3 className="section-title">NiceHash Rigs</h3>
      <div className="button-group">
        <button className="btn-pro" onClick={() => onCall('/api/v2/mining/rigs2')}>Rigs List</button>
        <button className="btn-pro" onClick={() => onCall('/api/v2/mining/address')}>Mining Address</button>
        <button className="btn-pro" onClick={() => onCall('/api/v2/algorithms')}>Algorithms</button>
        <button className="btn-pro" onClick={() => onCall('/api/v2/mining/payouts')}>Payouts</button>
        <button className="btn-pro" onClick={() => onCall('/api/v2/mining/history')}>History</button>
      </div>

      <div className="market-inputs" style={{ marginTop: '15px' }}>
        <input
          className="input-pro"
          placeholder="Rig ID"
          value={rigId}
          onChange={(e) => setRigId(e.target.value)}
        />
        <button className="btn-pro" onClick={fetchRigDetails}>Get Details</button>
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
        <button className="btn-pro" onClick={submitRigAction}>Apply</button>
      </div>

      <div className="accounting-integration" style={{ marginTop: '25px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
        <div className="panel-header" style={{ marginBottom: '15px' }}>
          <h3 className="section-title" style={{ margin: 0 }}>Accounting & Wallet</h3>
          <span className="panel-icon">💰</span>
        </div>
        <Accounting onCall={onCall} />

        {output?.total && output?.currencies && (
          <div className="balance-summary-pro" style={{ marginTop: '15px', padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '15px' }}>
              <div>
                <small style={{ opacity: 0.6, display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Available</small>
                <strong style={{ fontSize: '16px', color: '#10b981' }}>{output.total.available} {output.total.currency}</strong>
              </div>
              <div>
                <small style={{ opacity: 0.6, display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Pending</small>
                <strong style={{ fontSize: '16px', color: '#f59e0b' }}>{output.total.pending} {output.total.currency}</strong>
              </div>
              <div>
                <small style={{ opacity: 0.6, display: 'block', fontSize: '10px', textTransform: 'uppercase' }}>Total Balance</small>
                <strong style={{ fontSize: '16px' }}>{output.total.totalBalance} {output.total.currency}</strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}