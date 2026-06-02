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
      minWidth: '280px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.5rem', color: '#60a5fa', fontWeight: 'bold' }}>{order.algo}</span>
        {/* <span className="badge-status active">ACTIVE</span> */}
      </div>
      <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: '-8px' }}>{order.poolName}</div>
      
      <div style={{ margin: '4px 0' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Paid Amount</div>
        <div style={{ fontSize: '0.6rem', fontWeight: '600', color: '#f3ba2f' }}>{order.paid} <small>BTC</small></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>My Order Price</span>
          <span style={{ fontWeight: 'bold' }}>{parseFloat(order.price).toFixed(8)}</span>
          {order.priceDiff && (
            <span style={{ 
              color: parseFloat(order.priceDiff) <= 0 ? '#10b981' : '#f87171',
              fontSize: '0.7rem'
            }}>
              ({parseFloat(order.priceDiff) > 0 ? '+' : ''}{order.priceDiff}%)
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>NH Market Price</span>
          <span style={{ fontWeight: 'bold', color: '#94a3b8' }}>{parseFloat(order.marketPrice || 0).toFixed(8)}</span>
          <span style={{ opacity: 0.5, fontSize: '0.7rem' }}>{order.account}</span>
        </div>
      </div>
    </div>
  );
}