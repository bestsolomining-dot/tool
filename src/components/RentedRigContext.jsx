import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { normalizeAlgoForNiceHash, calculatePriceComparison } from '../core/algoMapping';

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
          const rawMarket = String(typeof o.market === 'object' ? o.market.id : o.market || '').toUpperCase();
          const marketCode = ['USA', 'EU'].includes(rawMarket) ? rawMarket : 'USA';
          return {
            id: String(o.id || o.orderId || ''),
            paid: o.payedAmount || "0.00000000", // NiceHash API uses 'payedAmount'
            price: o.price,
            account: o.nhClient || nhClient,
            algo: algoCode,
            market: marketCode,
            speed: o.acceptedCurrentSpeed || 0,
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
          const rawPrice = priceData?.price || priceData;
          const priceValue = parseFloat(rawPrice?.fixedPrice || rawPrice?.standardPrice?.fast || rawPrice?.standardPrice || rawPrice?.price || 0);
          const priceUnit = rawPrice?.speedUnit || rawPrice?.unit || (algoName.toUpperCase().includes('SHA256') ? 'EH' : 'TH');
          marketPrices[key] = { value: priceValue, unit: priceUnit };
        } catch (e) { marketPrices[key] = { value: 0, unit: 'TH' }; }
        }));

        const processed = tempProcessed.map(p => {
        const isSha2 = p.algo.includes('SHA256');
        const isRx = p.algo.includes('RANDOMX');
        const mktData = marketPrices[`${p.algo}:${p.market}`] || { value: 0, unit: isSha2 ? 'EH' : isRx ? 'MH' : 'TH' };
        const mkt = mktData.value;
        const cur = parseFloat(p.price);
        // ROI = (Market Benchmark - My Price) / Market Benchmark
        const diff = mkt > 0 ? calculatePriceComparison(cur, mktData.unit, mkt, mktData.unit) : null;
        return { ...p, marketPrice: mkt, marketUnit: mktData.unit, priceDiff: diff };
        }).sort((a, b) => parseFloat(b.speed || 0) - parseFloat(a.speed || 0));

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