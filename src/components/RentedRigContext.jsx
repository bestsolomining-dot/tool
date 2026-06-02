import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { normalizeAlgoForNiceHash } from '../core/algoMapping';

const RentedRigContext = createContext();

export function RentedRigProvider({ children, nhClient, callApi }) {
  const [rentedRigs, setRentedRigs] = useState([]);
  const [summary, setSummary] = useState({ totalPaid: "0.00000000", count: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchRentedRigs = useCallback(async () => {
    setLoading(true);
    try {
      // Fetching from the standard NiceHash My Orders endpoint
      const data = await callApi('/api/v2/hashpower/myOrders', {
        query: { op: 'LE', limit: 1000, client: nhClient },
        silent: true
      });

      if (data && !data.error) {
        const list = data?.list || data?.myOrders || (Array.isArray(data) ? data : []);
        
        // Filter for ACTIVE orders to display in the header summary
        const activeOrders = list.filter(o => (o.status?.code || o.status) === 'ACTIVE');
        
        const tempProcessed = activeOrders.map(o => {
          const rawAlgo = typeof o.algorithm === 'object' ? o.algorithm.algorithm || o.algorithm.displayName : o.algorithm;
          const algoCode = (rawAlgo || '').toUpperCase();
          const marketCode = (typeof o.market === 'object' ? o.market.id : o.market) || 'USA';
          return {
            id: String(o.id || o.orderId || ''),
            paid: o.payedAmount || "0.00000000", // NiceHash API uses 'payedAmount'
            price: o.price,
            account: o.nhClient || nhClient,
            algo: algoCode,
            market: marketCode,
            poolName: o.pool?.name || o.pool?.stratumHostname || o.title || o.name || 'N/A'
          };
        });

        // Fetch market prices for unique algorithms to calculate comparison
        // We group by algo + market to get accurate regional pricing
        const priceKeys = [...new Set(tempProcessed.map(p => `${p.algo}:${p.market}`))];
        const marketPrices = {};
        
        await Promise.all(priceKeys.map(async (key) => {
          const [algoName, marketName] = key.split(':');
          if (!algoName) return;
          try {
            const nhAlgo = normalizeAlgoForNiceHash(algoName);
            // Try business order first for "Fast" price benchmarking
            let priceData = await callApi('/api/v2/hashpower/business/order', { 
              query: { algorithm: nhAlgo, market: marketName, client: nhClient },
              silent: true 
            });

            if (!priceData || priceData.error || !priceData.price) {
              priceData = await callApi('/api/v2/hashpower/order/price', { 
                query: { algorithm: nhAlgo, market: marketName, client: nhClient }, 
                silent: true 
              });
            }
            const priceValue = parseFloat(priceData?.price || priceData?.fixedPrice || priceData?.standardPrice?.fast || priceData?.standardPrice || 0);
            marketPrices[key] = priceValue;
          } catch (e) { marketPrices[key] = 0; }
        }));

        const processed = tempProcessed.map(p => {
          const mkt = marketPrices[`${p.algo}:${p.market}`] || 0;
          const cur = parseFloat(p.price);
          const diff = mkt > 0 ? ((cur - mkt) / mkt * 100).toFixed(1) : null;
          return { ...p, marketPrice: mkt, priceDiff: diff };
        });

        const totalPaid = activeOrders.reduce((sum, o) => sum + parseFloat(o.payedAmount || 0), 0).toFixed(8);
        setRentedRigs(processed);
        setSummary({ totalPaid, count: processed.length });
        setError(null);
      } else {
        setError(data?.error || 'Failed to fetch NiceHash orders');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [nhClient, callApi]);

  // Auto-refresh when the client changes
  useEffect(() => {
    fetchRentedRigs();
  }, [fetchRentedRigs]);

  const value = {
    rentedRigs,
    summary,
    loading,
    error,
    refresh: fetchRentedRigs
  };

  return (
    <RentedRigContext.Provider value={value}>
      {children}
    </RentedRigContext.Provider>
  );
}

export const useRentedRigs = () => {
  const context = useContext(RentedRigContext);
  if (!context) throw new Error('useRentedRigs must be used within a RentedRigProvider');
  return context;
};