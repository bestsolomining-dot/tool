import { useEffect, useMemo, useState } from 'react';
import Accounting from './Accounting';

export default function MiningRigNiceHash({ onCall, output, algorithm, market, nhClient, setNhClient }) {
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [localOrders, setLocalOrders] = useState([]);
  const [orderDetail, setOrderDetail] = useState(null);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [limitInput, setLimitInput] = useState('');
  const [refillInput, setRefillInput] = useState('');

  const orders = useMemo(() => {
    if (localOrders.length > 0) return localOrders; // localOrders is already processed
    const raw = output; // output should now be the direct API response
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.orders)) return raw.orders;
    if (Array.isArray(raw?.myOrders)) return raw.myOrders;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.list)) return raw.list;
    if (Array.isArray(raw?.result)) return raw.result;
    return [];
  }, [output, localOrders]);

  const fetchOrders = async () => {
    setLoadingLocal(true);
    const data = await onCall('/api/v2/hashpower/myOrders', {
      query: { op: 'PH', limit: 1000 }, // callApi in App.jsx handles ts and client
      silent: true
    });
    const list = data?.list || data?.myOrders || (Array.isArray(data) ? data : []);

    setLocalOrders(list);
    setOrderDetail(null);
    setLoadingLocal(false);
  };

  const fetchOrderDetail = async (orderId) => {
    const id = String(orderId || '').trim();
    if (!id) return;
    setLoadingLocal(true);
    const data = await onCall(`/api/v2/hashpower/order/${encodeURIComponent(id)}`, { silent: true });
    if (data && !data.error) {
      setOrderDetail(data);
      setPriceInput(data.price || '');
      setLimitInput(data.limit || '');
    }
    setLoadingLocal(false);
  };

  const handleOrderSelect = (value) => {
    setSelectedOrderId(value);
    if (value) fetchOrderDetail(value);
  };

  const cancelOrder = () => {
    if (!selectedOrderId || !window.confirm('Are you sure you want to cancel this order?')) return;
    onCall(`/api/v2/hashpower/order/${encodeURIComponent(selectedOrderId)}`, { method: 'DELETE' });
  };

  const updateOrder = () => {
    if (!priceInput || !limitInput) return;
    onCall(`/api/v2/hashpower/order/${encodeURIComponent(selectedOrderId)}/update`, {
      method: 'POST',
      body: { price: priceInput, limit: limitInput }
    });
  };

  const refillOrder = () => {
    if (!refillInput) return;
    onCall(`/api/v2/hashpower/order/${encodeURIComponent(selectedOrderId)}/refill`, {
      method: 'POST',
      body: { amount: refillInput }
    });
  };

  // Sort localOrders so ACTIVE status appears on top
  const sortedLocalOrders = useMemo(() => {
    return [...localOrders].sort((a, b) => {
      const aActive = a.status?.code === 'ACTIVE';
      const bActive = b.status?.code === 'ACTIVE';
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      return 0;
    });
  }, [localOrders]);

  // Clear local state when client changes to avoid showing data from the wrong account
  useEffect(() => {
    setLocalOrders([]);
    setOrderDetail(null);
    
    // We check if we are currently mounted and have a client before fetching
    if (nhClient && typeof onCall === 'function') {
      fetchOrders();
    }
  }, [nhClient]); // No need to add fetchOrders here as it's not wrapped in useCallback, but it's safe.

  return (
    <div className="rig-section nh-theme" style={{ marginLeft: '5px', marginRight: '5px', marginTop: '5px', paddingTop: '5px', paddingBottom: '5px' }}>
      <h2 className="section-title" style={{paddingBottom: '10px' }}>NiceHash</h2>

      <div className="market-inputs" style={{ marginBottom: '15px' }}>
        <select className="select-pro" value={nhClient} onChange={(e) => setNhClient(e.target.value)}>
          <option value="BT">BT Account</option>
          <option value="PH">PH Account</option>
        </select>
        <small style={{ opacity: 0.5, fontSize: '10px', marginLeft: '10px' }}>ACTIVE CLIENT</small>
      </div>

      <div className="button-group">
        <button className="btn-pro" onClick={fetchOrders}>Orders List</button>
        <button className="btn-pro" onClick={() => onCall('/api/v2/mining/address')}>Mining Address</button>
        <button className="btn-pro" onClick={() => onCall('/api/v2/algorithms')}>Algorithms</button>
        <button className="btn-pro" onClick={() => onCall('/api/v2/mining/payouts')}>Payouts</button>
        <button className="btn-pro" onClick={() => onCall('/api/v2/mining/history', { query: { algorithm } })}>History</button>
      </div>

      <div className="market-inputs" style={{ marginTop: '15px' }}>
        <select className="select-pro" value={selectedOrderId} onChange={(e) => handleOrderSelect(e.target.value)}>
          <option value="">Select Hashpower Order...</option>
          {orders.map((order, index) => {
            const id = String(order?.id ?? order?.orderId ?? order?.hashpowerOrderId ?? '');
            const label = order?.title || order?.name || (typeof order?.algorithm === 'object' ? order.algorithm.algorithm || order.algorithm.displayName : order?.algorithm) || `Order ${index + 1}`;
            return (
              <option key={id || `${label}-${index}`} value={id}>
                {label}{id ? ` (${id})` : ''}
              </option>
            );
          })}
        </select>
        <button className="btn-pro" onClick={() => fetchOrderDetail(selectedOrderId)} disabled={!selectedOrderId}>
          Get Order Detail
        </button>
      </div>
      
      {selectedOrderId && (
        <div className="order-management-panel" style={{ marginTop: '15px', padding: '15px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '10px', alignItems: 'flex-end', marginBottom: '15px' }}>
            <div>
              <label className="label" style={{ fontSize: '10px', marginBottom: '4px', display: 'block' }}>NEW PRICE</label>
              <input 
                type="number" 
                className="input-pro" 
                value={priceInput} 
                onChange={e => setPriceInput(e.target.value)} 
                placeholder="0.0000"
                step="0.0001"
              />
            </div>
            <div>
              <label className="label" style={{ fontSize: '10px', marginBottom: '4px', display: 'block' }}>NEW LIMIT</label>
              <input 
                type="number" 
                className="input-pro" 
                value={limitInput} 
                onChange={e => setLimitInput(e.target.value)} 
                placeholder="0.00"
                step="0.01"
              />
            </div>
            <button className="btn-pro primary" onClick={updateOrder}>Update</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'flex-end', marginBottom: '15px' }}>
            <div>
              <label className="label" style={{ fontSize: '10px', marginBottom: '4px', display: 'block' }}>REFILL AMOUNT</label>
              <input 
                type="number" 
                className="input-pro" 
                value={refillInput} 
                onChange={e => setRefillInput(e.target.value)} 
                placeholder="0.0000"
                step="0.0001"
              />
            </div>
            <button className="btn-pro" style={{ background: '#10b981' }} onClick={refillOrder}>Refill</button>
          </div>
          <button className="btn-pro status-error" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.2)', width: '100%' }} onClick={cancelOrder}>
            Cancel Order
          </button>
        </div>
      )}

      <div className="market-inputs" style={{ marginTop: '10px' }}>
        <button className="btn-pro" onClick={fetchOrders}>Refresh Orders</button>
      </div>

      {loadingLocal && <div style={{ fontSize: '11px', opacity: 0.6, margin: '10px 0' }}>Fetching order data...</div>}

      {/* Order Detail UI */}
      {orderDetail && (
        <div className="order-detail-ui" style={{ marginTop: '20px', padding: '15px', background: 'rgba(59, 130, 246, 0.05)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ margin: 0, color: '#3b82f6', fontSize: '14px' }}>Order Info</h4>
            <button className="text-button" style={{ fontSize: '11px' }} onClick={() => setOrderDetail(null)}>Close Info</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '12px', fontSize: '11px' }}>
            <div><span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>STATUS</span> <strong style={{ color: orderDetail.status?.code === 'ACTIVE' ? '#10b981' : '#f87171' }}>{orderDetail.status?.code}</strong></div>
            <div><span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>POOL NAME</span> <strong>{orderDetail.pool?.name || 'N/A'}</strong></div>
            <div><span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>ALGO</span> <strong>{typeof orderDetail.algorithm === 'object' ? orderDetail.algorithm.algorithm : orderDetail.algorithm}</strong></div>
            <div><span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>MARKET</span> <strong>{orderDetail.market}</strong></div>
            <div><span style={{ opacity: 0.8, display: 'block', fontSize: '9px' }}>PRICE</span> <strong style={{ color: '#f59e0b' }}>{orderDetail.price}</strong></div>
            <div><span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>LIMIT</span> <strong>{orderDetail.limit}</strong></div>
            <div><span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>REMAINING</span> <strong style={{ color: '#10b981' }}>{parseFloat(orderDetail.availableAmount || 0).toFixed(8)}</strong></div>
            <div><span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>BUDGET PROGRESS</span> <strong style={{ color: '#60a5fa' }}>{(() => {
              const spent = parseFloat(orderDetail.payedAmount || 0);
              const total = spent + parseFloat(orderDetail.availableAmount || 0);
              return total > 0 ? ((spent / total) * 100).toFixed(1) : '0.0';
            })()}%</strong></div>
            <div><span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>CURR. SPEED</span> <strong>{parseFloat(orderDetail.acceptedCurrentSpeed || 0).toFixed(7)}</strong></div>
            <div><span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>RIGS</span> <strong>{orderDetail.rigsCount}</strong></div>
            <div><span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>ID</span> <code style={{ fontSize: '9px' }}>{orderDetail.id?.slice(0, 10)}</code></div>
            <div style={{ gridColumn: 'span 2' }}><span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>STRATUM HOST</span> <strong style={{ wordBreak: 'break-all' }}>{orderDetail.pool?.stratumHostname || 'N/A'}</strong></div>
            <div><span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>USERNAME</span> <strong>{orderDetail.pool?.username || 'N/A'}</strong></div>
            <div><span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>PASSWORD</span> <strong>{orderDetail.pool?.password || 'N/A'}</strong></div>
          </div>
        </div>
      )}

      {/* Local Orders List UI */}
      {localOrders.length > 0 && !orderDetail && (
        <div className="local-orders-list" style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h4 style={{ margin: 0, fontSize: '13px', opacity: 0.8 }}>My Orders List</h4>
            <button className="text-button" style={{ fontSize: '10px' }} onClick={() => setLocalOrders([])}>Clear List</button>
          </div>
          <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px' }}>
            <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ background: 'rgba(255,255,255,0.05)', position: 'sticky', top: 0 }}>
                <tr>
                  <th style={{ padding: '8px' }}>Pool</th>
                  <th style={{ padding: '8px' }}>Algo</th>
                  <th style={{ padding: '8px' }}>Price</th>
                  <th style={{ padding: '8px' }}>Speed</th>
                  <th style={{ padding: '8px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedLocalOrders.map((o, i) => {
                  const id = o.id || o.orderId || o.hashpowerOrderId;
                  const algo = typeof o.algorithm === 'object' ? o.algorithm.algorithm : o.algorithm;
                  return (
                    <tr key={id || i} onClick={() => handleOrderSelect(id)} style={{ cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.02)' }} className="hover-row">
                      <td style={{ padding: '8px' }}>{o.pool?.name || o.pool?.stratumHostname || 'N/A'}</td>
                      <td style={{ padding: '8px' }}>{algo}</td>
                      <td style={{ padding: '8px', color: '#f59e0b' }}>{o.price}</td>
                      <td style={{ padding: '8px' }}>{parseFloat(o.acceptedCurrentSpeed || 0).toFixed(6)}</td>
                      <td style={{ padding: '8px', color: o.status?.code === 'ACTIVE' ? '#10b981' : 'inherit' }}>{o.status?.code}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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