// NiceHash.jsx
import { useEffect, useMemo, useState, useCallback } from 'react';
import Accounting from './Accounting';
import { normalizeAlgoForNiceHash } from '../core/mapping.js';
import { useRentedRigs } from './RentedRigContext';
import RentedRigCard from './NiceHashOrdersCard';

export default function MiningRigNiceHash({ onCall, output, algorithm, market, nhClient, setNhClient }) {
  // Get ALL data from context including price data
  const { 
    rentedRigs,           // Array of active orders with prices, market comparisons
    marketPrices,         // Map of algo:market to price data
    refresh: refreshSummary, 
    showPriceLookupModal, 
    setShowPriceLookupModal,
    getOrderPrice,        // Helper function to get price by order ID
    selectedOrder: contextSelectedOrder, // Currently selected order from context
    setSelectedOrderId: setContextSelectedOrderId // Setter for context selection
  } = useRentedRigs();

  // Local state
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [orderDetail, setOrderDetail] = useState(null);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [limitInput, setLimitInput] = useState('');
  const [refillInput, setRefillInput] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'status', direction: 'desc' });

  // Sorting function
  const requestSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  // Use processed active orders from RentedRigContext instead of local redundant fetches
  const orders = useMemo(() => {
    return rentedRigs.map(r => ({
      ...r.rawOrder,
      nhClient: r.account, // Context uses 'account' field for the client label
    }));
  }, [rentedRigs]);

  // Unified refresh
  const handleManualRefresh = useCallback(() => {
    refreshSummary();
  }, [refreshSummary]);

  // Fetch order detail
  const fetchOrderDetail = async (orderId) => {
    const id = String(orderId || '').trim();
    if (!id) return;
    setLoadingLocal(true);
    try {
      const data = await onCall(`/api/v2/hashpower/order/${encodeURIComponent(id)}`, { silent: true });
      if (data && !data.error) {
        // Enrich with client info from context if available
        const contextMatch = rentedRigs.find(r => r.id === id);
        setOrderDetail({ ...data, nhClient: contextMatch?.account || nhClient });
        setPriceInput(data.price || '');
        setLimitInput(data.limit || '');
      }
    } catch (error) {
      console.error('Error fetching order detail:', error);
    } finally {
      setLoadingLocal(false);
    }
  };

  // Handle order selection - syncs local and context
  const handleOrderSelect = (value) => {
    setSelectedOrderId(value);
    setContextSelectedOrderId(value); // Sync with context
    
    // Pre-populate from context state to avoid blank UI while fetching fresh details
    const existing = rentedRigs.find(r => r.id === String(value));
    if (existing?.rawOrder) {
      setOrderDetail({ ...existing.rawOrder, nhClient: existing.account });
      setPriceInput(existing.rawOrder.price || '');
      setLimitInput(existing.rawOrder.limit || '');
    }

    if (value) {
      fetchOrderDetail(value);
    } else {
      setOrderDetail(null);
      setPriceInput('');
      setLimitInput('');
    }
  };

  // Cancel order
  const cancelOrder = () => {
    if (!selectedOrderId || !window.confirm('Are you sure you want to cancel this order?')) return;
    onCall(`/api/v2/hashpower/order/${encodeURIComponent(selectedOrderId)}`, {
      method: 'DELETE',
      showModal: true
    }).then(res => {
      if (res && !res.error) {
        refreshSummary();
      }
    });
  };

  // Update order
  const updateOrder = () => {
    if (!selectedOrderId || priceInput === '' || limitInput === '') {
      alert('Order selection, Price, and Limit are required.');
      return;
    }
    onCall(`/api/v2/hashpower/order/${encodeURIComponent(selectedOrderId)}/update`, {
      method: 'POST',
      body: {
        price: String(priceInput),
        limit: String(limitInput)
      },
      showModal: true
    }).then(res => {
      if (res && !res.errors && !res.error) {
        refreshSummary();
      }
    });
  };

  // Refill order
  const refillOrder = () => {
    if (!selectedOrderId || !refillInput) return;
    onCall(`/api/v2/hashpower/order/${encodeURIComponent(selectedOrderId)}/refill`, {
      method: 'POST',
      body: { amount: String(refillInput) },
      showModal: true
    }).then(res => {
      if (res && !res.error) {
        refreshSummary();
      }
    });
  };

  // Sorted orders for dropdown
  const sortedOrders = useMemo(() => {
    return [...orders].sort((a, b) => {
      let aVal, bVal;
      const key = sortConfig.key;

      if (key === 'status') {
        aVal = (a.status?.code || a.status) === 'ACTIVE' ? 1 : 0;
        bVal = (b.status?.code || b.status) === 'ACTIVE' ? 1 : 0;
      } else if (key === 'speed') {
        aVal = parseFloat(a.acceptedCurrentSpeed || 0);
        bVal = parseFloat(b.acceptedCurrentSpeed || 0);
      } else if (key === 'algo') {
        aVal = (typeof a.algorithm === 'object' ? a.algorithm.algorithm : a.algorithm) || '';
        bVal = (typeof b.algorithm === 'object' ? b.algorithm.algorithm : b.algorithm) || '';
      } else if (key === 'pool') {
        aVal = a.pool?.name || a.pool?.stratumHostname || a.title || a.name || 'N/A';
        bVal = b.pool?.name || b.pool?.stratumHostname || b.title || b.name || 'N/A';
      } else if (key === 'price') {
        aVal = parseFloat(a.price || 0);
        bVal = parseFloat(b.price || 0);
      } else if (key === 'account') {
        aVal = a.nhClient || '';
        bVal = b.nhClient || '';
      }

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [orders, sortConfig]);

  // Get price from context (this is the key improvement)
  const contextOrderPrice = useMemo(() => {
    if (!selectedOrderId) return null;
    return getOrderPrice(selectedOrderId);
  }, [selectedOrderId, getOrderPrice]);

  // Get market comparison from context
  const matchingOrderInfo = useMemo(() =>
    rentedRigs.find(r => r.id === String(selectedOrderId)),
    [rentedRigs, selectedOrderId]
  );

  // Replace manual API price lookup with state-based lookup
  const marketPriceData = useMemo(() => {
    if (matchingOrderInfo) return { value: matchingOrderInfo.marketPrice, unit: matchingOrderInfo.marketUnit };
    const nhAlgo = normalizeAlgoForNiceHash(algorithm);
    const key = `${nhAlgo}:${market || 'USA'}`;
    return marketPrices[key] || null;
  }, [matchingOrderInfo, marketPrices, algorithm, market]);

  // Clear local state when client changes
  useEffect(() => {
    setOrderDetail(null);

    if (nhClient && typeof onCall === 'function') {
      refreshSummary();
    }
  }, [nhClient, onCall, refreshSummary]);

  return (
    <div className="rig-section nh-theme" style={{ marginLeft: '5px', marginRight: '5px', marginTop: '5px', paddingTop: '5px', paddingBottom: '5px' }}>
      <h2 className="section-title" style={{ paddingBottom: '10px' }}>NiceHash</h2>

      {/* Client Selection & Summary */}
      <div className="market-inputs" style={{ marginBottom: '15px' }}>
        <select className="select-pro" value={nhClient} onChange={(e) => setNhClient(e.target.value)}>
          <option value="VN">VN (All Clients)</option>
          <option value="BT">BT Account</option>
          <option value="PH">PH Account</option>
          <option value="NHATLINH">NhatLinh</option>
          <option value="KIMLOAN">KimLoan</option>
        </select>
        <RentedRigsSummarySection />
      </div>

      {/* Action Buttons */}
      <div className="button-group">
        <button className="btn-pro" onClick={handleManualRefresh}>Orders List</button>
        <button className="btn-pro" onClick={() => onCall('/api/v2/mining/address')}>Mining Address</button>
        <button className="btn-pro" onClick={() => onCall('/api/v2/algorithms')}>Algorithms</button>
        <button className="btn-pro" onClick={() => onCall('/api/v2/mining/payouts')}>Payouts</button>
        <button className="btn-pro" onClick={() => onCall('/api/v2/mining/history', { query: { algorithm } })}>History</button>
      </div>

      {/* Order Selection Dropdown */}
      <div className="market-inputs" style={{ marginTop: '15px', display: 'flex', alignItems: 'center' }}>
        <select className="select-pro" value={selectedOrderId} onChange={(e) => handleOrderSelect(e.target.value)}>
          <option value="">Select Order</option>
          {sortedOrders.some(o => (o.status?.code || o.status) !== 'ACTIVE') && <option disabled>--- Active Orders ---</option>}
          {sortedOrders.map((order, index) => {
            const id = String(order?.id ?? order?.orderId ?? order?.hashpowerOrderId ?? '');
            const algo = typeof order?.algorithm === 'object' ? order.algorithm.algorithm || order.algorithm.displayName : order?.algorithm;
            const poolName = order?.pool?.name || order?.pool?.stratumHostname;
            const label = poolName ? `${poolName} (${algo || 'N/A'})` : (algo || order?.title || order?.name || `Order ${index + 1}`);
            const statusCode = order?.status?.code || order?.status || '';
            const clientSuffix = order?.nhClient ? ` [${order.nhClient}]` : '';
            const isInactive = statusCode !== 'ACTIVE';

            // Add a separator if we are transitioning from active to inactive orders
            const prevOrder = sortedOrders[index - 1];
            const showSeparator = isInactive && prevOrder && (prevOrder.status?.code || prevOrder.status) === 'ACTIVE';

            return (
              <>
                {showSeparator && <option disabled>--- Recent Inactive ---</option>}
                <option key={id || `${label}-${index}`} value={id}>
                  {label}{statusCode ? ` [${statusCode}]` : ''}{clientSuffix}
                </option>
              </>
            );
          })}
        </select>
        {orderDetail?.status?.code && (
          <div style={{ padding: '0 10px', display: 'flex', alignItems: 'center' }}>
            <span className={orderDetail.status.code === 'ACTIVE' ? 'status-success' : 'status-ready'} style={{ fontSize: '10px', fontWeight: 'bold' }}>
              {orderDetail.status.code}
            </span>
          </div>
        )}
        {/* Display price from context */}
        {contextOrderPrice !== null && (
          <div style={{ padding: '0 10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '10px', opacity: 0.6 }}>Price:</span>
            <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#f59e0b' }}>
              {contextOrderPrice} BTC/TH
            </span>
            {matchingOrderInfo?.orderDiff && (
              <span style={{
                fontSize: '10px',
                fontWeight: 'bold',
                color: parseFloat(matchingOrderInfo.orderDiff) >= 0 ? '#10b981' : '#f87171'
              }}>
                ({parseFloat(matchingOrderInfo.orderDiff) > 0 ? '+' : ''}{matchingOrderInfo.orderDiff}%)
              </span>
            )}
              {matchingOrderInfo?.marketPrice > 0 && (
                <>
                  <span style={{ fontSize: '10px', opacity: 0.6, marginLeft: '10px' }}>Market:</span>
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#60a5fa' }}>
                    {parseFloat(matchingOrderInfo.marketPrice).toFixed(8)} BTC/{matchingOrderInfo.marketUnit}
                  </span>
                </>
              )}
          </div>
        )}
      </div>

      {/* Order Management Panel */}
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

      {/* Refresh Button */}
      <div className="market-inputs" style={{ marginTop: '10px' }}>
        <button className="btn-pro" onClick={handleManualRefresh}>Refresh Orders</button>
      </div>

      {/* Price Lookup Modal Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
        <input
          type="checkbox"
          id="showPriceLookupModalToggle"
          checked={showPriceLookupModal}
          onChange={(e) => setShowPriceLookupModal(e.target.checked)}
        />
        <label htmlFor="showPriceLookupModalToggle" style={{ fontSize: '11px', opacity: 0.8, cursor: 'pointer' }}>
          Show Price Lookup Modal
        </label>
      </div>

      {loadingLocal && <div style={{ fontSize: '11px', opacity: 0.6, margin: '10px 0' }}>Fetching order data...</div>}

      {/* Order Detail UI */}
      {orderDetail && (
        <div className="order-detail-ui" style={{ marginTop: '20px', padding: '15px', background: 'rgba(59, 130, 246, 0.05)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ margin: 0, color: '#3b82f6', fontSize: '14px' }}>Order Info</h4>
            <button className="text-button" style={{ fontSize: '11px' }} onClick={() => setOrderDetail(null)}>Close Info</button>
          </div>
          
          {/* Account Info */}
          {orderDetail?.nhClient && (
            <div style={{ marginBottom: '14px', paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ opacity: 0.5, fontSize: '10px', textTransform: 'uppercase' }}>ACCOUNT</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#60a5fa' }}>{orderDetail.nhClient}</div>
            </div>
          )}

          {/* Order Details Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '12px', fontSize: '11px' }}>
            <div>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>STATUS</span>
              <strong style={{ color: orderDetail.status?.code === 'ACTIVE' ? '#10b981' : '#f87171' }}>
                {orderDetail.status?.code}
              </strong>
            </div>
            <div>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>POOL NAME</span>
              <strong>{orderDetail.pool?.name || 'N/A'}</strong>
            </div>
            <div>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>ALGO</span>
              <strong>{typeof orderDetail.algorithm === 'object' ? orderDetail.algorithm.algorithm : orderDetail.algorithm}</strong>
            </div>
            <div>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>MARKET</span>
              <strong>{orderDetail.market}</strong>
            </div>
            <div>
              <span style={{ opacity: 0.8, display: 'block', fontSize: '9px' }}>PRICE</span>
              <strong style={{ color: '#f59e0b' }}>{orderDetail.price}</strong>
              {/* Price comparison from context */}
              {matchingOrderInfo?.orderDiff && (
                <span style={{
                  marginLeft: '6px',
                  fontSize: '9px',
                  fontWeight: 'bold',
                  color: parseFloat(matchingOrderInfo.orderDiff) >= 0 ? '#10b981' : '#f87171'
                }}>
                  ({parseFloat(matchingOrderInfo.orderDiff) > 0 ? '+' : ''}{matchingOrderInfo.orderDiff}%)
                </span>
              )}
            </div>
            <div>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>SPEED</span>
              <strong style={{ color: '#10b981' }}>{parseFloat(orderDetail.acceptedCurrentSpeed || 0).toFixed(7)}</strong>
            </div>
            <div>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>LIMIT</span>
              <strong>{orderDetail.limit}</strong>
            </div>
            <div>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>REMAINING</span>
              <strong style={{ color: '#10b981' }}>{parseFloat(orderDetail.availableAmount || 0).toFixed(8)}</strong>
            </div>
            <div>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>BUDGET PROGRESS</span>
              <strong style={{ color: '#60a5fa' }}>{(() => {
                const spent = parseFloat(orderDetail.payedAmount || 0);
                const total = spent + parseFloat(orderDetail.availableAmount || 0);
                return total > 0 ? ((spent / total) * 100).toFixed(1) : '0.0';
              })()}%</strong>
            </div>
            <div>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>CURR. SPEED</span>
              <strong>{parseFloat(orderDetail.acceptedCurrentSpeed || 0).toFixed(7)}</strong>
            </div>
            <div>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>RIGS</span>
              <strong>{orderDetail.rigsCount}</strong>
            </div>
            <div>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>ID</span>
              <code style={{ fontSize: '9px' }}>{orderDetail.id?.slice(0, 10)}</code>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>STRATUM HOST</span>
              <strong style={{ wordBreak: 'break-all' }}>{orderDetail.pool?.stratumHostname || 'N/A'}</strong>
            </div>
            <div>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>USERNAME</span>
              <strong>{orderDetail.pool?.username || 'N/A'}</strong>
            </div>
            <div>
              <span style={{ opacity: 0.6, display: 'block', fontSize: '9px' }}>PASSWORD</span>
              <strong>{orderDetail.pool?.password || 'N/A'}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Local Orders List */}
      {orders.length > 0 && !orderDetail && (
        <div className="local-orders-list" style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h4 style={{ margin: '1px', fontSize: '13px', opacity: 0.8 }}>My Orders List</h4>
            <button className="text-button" style={{ fontSize: '10px' }} onClick={refreshSummary}>Refresh All</button>
          </div>
          <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px' }}>
            <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ padding: '8px', background: 'rgba(255,255,255,0.05)', position: 'sticky', top: 0 }}>
                <tr style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <th style={{ padding: '8px' }} onClick={() => requestSort('pool')}>
                    POOL NAME {sortConfig.key === 'pool' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                  </th>
                  <th style={{ padding: '8px' }} onClick={() => requestSort('algo')}>
                    Algo {sortConfig.key === 'algo' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                  </th>
                  {nhClient === 'VN' && (
                    <th style={{ padding: '8px' }} onClick={() => requestSort('account')}>
                      Account {sortConfig.key === 'account' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                    </th>
                  )}
                  <th style={{ padding: '8px' }} onClick={() => requestSort('price')}>
                    Price {sortConfig.key === 'price' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                  </th>
                  <th style={{ padding: '8px' }} onClick={() => requestSort('speed')}>
                    Speed {sortConfig.key === 'speed' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedOrders.map((o, i) => {
                  const id = o.id || o.orderId || o.hashpowerOrderId;
                  const algo = typeof o.algorithm === 'object' ? o.algorithm.algorithm : o.algorithm;
                  const poolName = o.pool?.name || o.pool?.stratumHostname || o.title || o.name || 'N/A';
                  return (
                    <tr 
                      key={id || i} 
                      onClick={() => handleOrderSelect(id)} 
                      style={{ cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.02)' }} 
                      className="hover-row"
                    >
                      <td style={{ padding: '8px' }}>{poolName}</td>
                      <td style={{ padding: '8px' }}>{algo}</td>
                      {nhClient === 'VN' && <td style={{ padding: '8px', opacity: 0.7 }}>{o.nhClient}</td>}
                      <td style={{ padding: '8px', color: '#f59e0b' }}>{o.price}</td>
                      <td style={{ padding: '8px' }}>{parseFloat(o.acceptedCurrentSpeed || 0).toFixed(6)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Accounting Section */}
      <div className="accounting-integration" style={{ marginTop: '25px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
        <div className="panel-header" style={{ marginBottom: '15px' }}>
          <h3 className="section-title" style={{ margin: 0 }}>Accounting & Wallet</h3>
          <span className="panel-icon">💰</span>
        </div>
        <Accounting onCall={onCall} />
      </div>
    </div>
  );
}

// Helper component to display rented rigs
function RentedRigsSummarySection() {
  const { rentedRigs, summary, loading } = useRentedRigs();

  return (
    <section style={{ marginBottom: '15px', padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
        <h4 style={{ margin: 0 }}>Orders Card</h4>
        <div style={{ fontSize: '0.6rem' }}>
          Total Paid: <span style={{ color: '#f3ba2f', fontWeight: 'bold' }}>{summary.totalPaid} BTC</span>
          <span style={{ margin: '0 10px', opacity: 0.3 }}>|</span>
          Orders: <b>{summary.count}</b>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '5px' }}>
        {loading && <p>Updating orders...</p>}
        {!loading && rentedRigs.length === 0 && <p style={{ fontSize: '0.8rem', opacity: 0.5 }}>No active NiceHash orders found for the card view.</p>}
        {rentedRigs.map(rig => <RentedRigCard key={rig.id} order={rig} />)}
      </div>
    </section>
  );
}