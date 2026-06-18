// RentedRigContext.jsx
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { normalizeAlgoForNiceHash, calculatePriceComparison, getAlgorithmUnit } from '../core/mapping.js';
import { fetchMarketPrice } from '../core/marketApi.js';

const RentedRigContext = createContext();

export function RentedRigProvider({ children, nhClient, callApi }) {
  // Core state
  const [rentedRigs, setRentedRigs] = useState([]);
  const [summary, setSummary] = useState({ totalPaid: "0.00000000", count: 0 });
  const [marketPrices, setMarketPrices] = useState({}); // algo:market -> { value, unit }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [showPriceLookupModal, setShowPriceLookupModal] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState(null);

  // Derived: selected order from the list
  const selectedOrder = useMemo(() => 
    rentedRigs.find(rig => rig.id === String(selectedOrderId)) || null,
    [rentedRigs, selectedOrderId]
  );

  // Helper: Get price by order ID
  const getOrderPrice = useCallback((orderId) => {
    const order = rentedRigs.find(rig => rig.id === String(orderId));
    return order?.price ?? null;
  }, [rentedRigs]);

  // Helper: Get market price by order ID
  const getMarketPrice = useCallback((orderId) => {
    const order = rentedRigs.find(rig => rig.id === String(orderId));
    return order?.marketPrice ?? null;
  }, [rentedRigs]);

  // Helper: Get price difference by order ID
  const getOrderDiff = useCallback((orderId) => {
    const order = rentedRigs.find(rig => rig.id === String(orderId));
    return order?.orderDiff ?? null;
  }, [rentedRigs]);

  // Helper: Get complete order info by ID
  const getOrderById = useCallback((orderId) => {
    return rentedRigs.find(rig => rig.id === String(orderId)) || null;
  }, [rentedRigs]);

  // Main fetch function
  const fetchRentedRigs = useCallback(async () => {
    if (!nhClient || !callApi) {
      console.warn('[RentedRigContext] Missing nhClient or callApi');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      // Fetch orders from NiceHash
      const data = await callApi('/api/v2/hashpower/myOrders', {
        query: { op: 'LE', limit: 1000, client: nhClient },
        silent: true
      });

      if (data?.error) {
        throw new Error(data.error);
      }

      const list = data?.list || data?.myOrders || (Array.isArray(data) ? data : []);
      console.log(`[RentedRigContext] Fetched ${list.length} orders for client ${nhClient}`);

      // Filter for ACTIVE orders
      const activeOrders = list.filter(o => (o.status?.code || o.status) === 'ACTIVE');
      console.log(`[RentedRigContext] Found ${activeOrders.length} active orders`);

      if (activeOrders.length === 0) {
        setRentedRigs([]);
        setSummary({ totalPaid: "0.00000000", count: 0 });
        setLoading(false);
        return;
      }

      // Process basic order info
      const tempProcessed = activeOrders.map(o => {
        const rawAlgo = typeof o.algorithm === 'object' 
          ? o.algorithm.algorithm || o.algorithm.displayName 
          : o.algorithm;
        const algoCode = (rawAlgo || '').toUpperCase();
        const rawMarket = String(
          typeof o.market === 'object' 
            ? o.market.id 
            : o.market || ''
        ).toUpperCase();
        const marketCode = ['USA', 'EU'].includes(rawMarket) ? rawMarket : 'USA';
        
        return {
          id: String(o.id || o.orderId || ''),
          paid: o.payedAmount || "0.00000000",
          price: o.price || 0,
          account: o.nhClient || nhClient,
          algo: algoCode,
          market: marketCode,
          speed: o.acceptedCurrentSpeed || 0,
          poolName: o.pool?.name || o.pool?.stratumHostname || o.title || o.name || 'N/A',
          // Raw data for debugging
          rawOrder: o
        };
      });

      // Get unique algorithm+market combinations
      const priceKeys = [...new Set(tempProcessed.map(p => `${p.algo}:${p.market}`))];
      const priceLookupClient = (nhClient === 'VN' || !nhClient) ? 'BT' : nhClient;

      // Fetch market prices for all unique combos
      const newMarketPrices = {};
      await Promise.all(priceKeys.map(async (key) => {
        const [algoName, marketName] = key.split(':');
        if (!algoName) return;
        try {
          newMarketPrices[key] = await fetchMarketPrice(callApi, algoName, marketName, priceLookupClient);
        } catch (e) {
          newMarketPrices[key] = { value: 0, unit: 'TH' };
        }
      }));
      setMarketPrices(newMarketPrices);

      // Process with market data
      const processed = tempProcessed.map(p => {
        const nhAlgo = normalizeAlgoForNiceHash(p.algo);
        const mktData = newMarketPrices[`${p.algo}:${p.market}`] || { value: 0, unit: getAlgorithmUnit(nhAlgo) };
        
        const cur = parseFloat(p.price) || 0;
        const curUnit = getAlgorithmUnit(nhAlgo); // Use the centralized mapping for algorithm units
        const mkt = mktData.value;

        // Calculate price difference
        let diff = null;
        if (mkt > 0 && cur > 0) {
          try {
            diff = calculatePriceComparison(
              cur,       // Your order price
              curUnit,   // Your order price unit
              mkt,       // Market benchmark price
              mktData.unit, // Market benchmark unit
              false      // isMrrVsNh = false
            );
          } catch (e) {
            console.warn('Error calculating price comparison:', e);
          }
        }

        return { 
          ...p, 
          marketPrice: mkt, 
          marketUnit: mktData.unit, 
          orderDiff: diff 
        };
      }).sort((a, b) => parseFloat(b.speed || 0) - parseFloat(a.speed || 0));

      // Calculate total paid
      const totalPaid = activeOrders.reduce(
        (sum, o) => sum + parseFloat(o.payedAmount || 0), 
        0
      ).toFixed(8);

      setRentedRigs(processed);
      setSummary({ totalPaid, count: processed.length });
      setLastRefreshTime(new Date().toISOString());
      
      console.log(`[RentedRigContext] Updated ${processed.length} orders`);

    } catch (err) {
      console.error('[RentedRigContext] Error fetching orders:', err);
      setError(err.message || 'Failed to fetch NiceHash orders');
      setRentedRigs([]);
      setSummary({ totalPaid: "0.00000000", count: 0 });
    } finally {
      setLoading(false);
    }
  }, [nhClient, callApi]);

  // Auto-refresh when client changes
  useEffect(() => {
    fetchRentedRigs();
  }, [fetchRentedRigs]);

  // Optional: Auto-refresh every 60 seconds
  useEffect(() => {
    if (!nhClient) return;
    
    const intervalId = setInterval(() => {
      console.log('[RentedRigContext] Auto-refreshing orders...');
      fetchRentedRigs();
    }, 60000); // 1 minute

    return () => clearInterval(intervalId);
  }, [nhClient, fetchRentedRigs]);

  // Context value
  const value = {
    // Core data
    rentedRigs,
    marketPrices,
    summary,
    loading,
    error,
    lastRefreshTime,
    
    // Selected order
    selectedOrder,
    selectedOrderId,
    setSelectedOrderId,
    
    // Helper functions
    getOrderPrice,
    getMarketPrice,
    getOrderDiff,
    getOrderById,
    
    // Refresh
    refresh: fetchRentedRigs,
    
    // Modal control
    showPriceLookupModal,
    setShowPriceLookupModal,
    
    // Utility
    isReady: !loading && !error && rentedRigs.length > 0
  };

  return (
    <RentedRigContext.Provider value={value}>
      {children}
    </RentedRigContext.Provider>
  );
}

// Custom hook with error handling
export const useRentedRigs = () => {
  const context = useContext(RentedRigContext);
  if (!context) {
    throw new Error('useRentedRigs must be used within a RentedRigProvider');
  }
  return context;
};

// // Optional: Hook for getting a single order's price
// export const useOrderPrice = (orderId) => {
//   const { getOrderPrice, loading, error } = useRentedRigs();
//   const price = useMemo(() => getOrderPrice(orderId), [getOrderPrice, orderId]);
//   return { price, loading, error };
// };

// // Optional: Hook for getting a single order's full data
// export const useOrder = (orderId) => {
//   const { getOrderById, loading, error } = useRentedRigs();
//   const order = useMemo(() => getOrderById(orderId), [getOrderById, orderId]);
//   return { order, loading, error };
// };