import React from 'react';

export default function RentedRigCard({ order }) {
  return (
    <div className="rented-rig-card" style={{
      background: 'rgba(255, 255, 255, 0.03)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '12px',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      minWidth: '240px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 'bold' }}>#{order.id.slice(0, 8)}</span>
        <span className="badge-status active">ACTIVE</span>
      </div>
      
      <div style={{ margin: '4px 0' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Paid Amount</div>
        <div style={{ fontSize: '1.2rem', fontWeight: '600', color: '#f3ba2f' }}>{order.paid} <small>BTC</small></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
        <span>Price: <b>{order.price}</b></span>
        <span style={{ opacity: 0.7 }}>Account: {order.account}</span>
      </div>
    </div>
  );
}