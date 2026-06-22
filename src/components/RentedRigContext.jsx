<<<<<<< Updated upstream
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { normalizeAlgoForNiceHash, calculatePriceComparison } from '../core/mapping.js';
=======
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
>>>>>>> Stashed changes

const RentedRigContext = createContext();

export function RentedRigProvider({ children, nhClient, callApi }) {
  const [rentedRigs, setRentedRigs] = useState([]);
  const [summary, setSummary] = useState({ totalPaid: "0.00000000", count: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchRentedRigs = useCallback(async () => {
    setLoading(true);
    try {
<<<<<<< Updated upstream
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
        
        // Use a real client for price lookups if the current context is aggregate (VN)
        const priceLookupClient = (nhClient === 'VN' || !nhClient) ? 'BT' : nhClient;

        for (const key of priceKeys) {
          const [algoName, marketName] = key.split(':');
          if (!algoName) continue;
          try {
            const nhAlgo = normalizeAlgoForNiceHash(algoName);
            const priceData = await callApi('/api/v2/hashpower/order/price', {
              query: { 
                algorithm: String(nhAlgo), 
                market: ['USA', 'EU'].includes(marketName) ? String(marketName) : 'USA',
                client: priceLookupClient 
              },
              silent: true
            });
            
            const rawPrice = priceData?.price || priceData;
            const priceValue = parseFloat(rawPrice?.fixedPrice || rawPrice?.standardPrice?.fast || rawPrice?.standardPrice || rawPrice?.price || 0);
            const priceUnit = rawPrice?.speedUnit || rawPrice?.unit || (algoName.toUpperCase().includes('SHA256') ? 'EH' : 'TH');
            marketPrices[key] = { value: priceValue, unit: priceUnit };

            // Sequential fetch gap
            await new Promise(r => setTimeout(r, 150));
          } catch (e) { marketPrices[key] = { value: 0, unit: 'TH' }; }
        }

        const processed = tempProcessed.map(p => {
          const isSha2 = p.algo.includes('SHA256');
          const isRx = p.algo.includes('RANDOMX');
          const mktData = marketPrices[`${p.algo}:${p.market}`] || { value: 0, unit: isSha2 ? 'EH' : (isRx ? 'MH' : 'GH') };
          const mkt = mktData.value;
          const cur = parseFloat(p.price);
          const diffRaw = (mkt > 0 && cur > 0) ? calculatePriceComparison(
            cur,
            'TH', // Your rental price unit (BTC/TH/Day)
            mkt,  // Market benchmark price
            mktData.unit // Market benchmark unit (e.g., EH for SHA256)
          ) : null;
          const diff = diffRaw !== null ? (parseFloat(diffRaw) * -1).toFixed(1) : null;
          return { ...p, marketPrice: mkt, marketUnit: mktData.unit, orderDiff: diff };
        }).sort((a, b) => parseFloat(b.speed || 0) - parseFloat(a.speed || 0));

        const totalPaid = activeOrders.reduce((sum, o) => sum + parseFloat(o.payedAmount || 0), 0).toFixed(8);
        setRentedRigs(processed);
        setSummary({ totalPaid, count: processed.length });
        setError(null);
      } else {
        setError(data?.error || 'Failed to fetch NiceHash orders');
      }
=======
      const data = await callApi('/api/v2/mrr/rentals');
      if (data?.error) throw new Error(data.error);
      const rentals =
        data?.data?.rentals ||
        data?.data ||
        data?.rentals ||
        [];
      setRentedRigs(Array.isArray(rentals) ? rentals : []);
>>>>>>> Stashed changes
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

  return <RentedRigContext.Provider value={value}>{children}</RentedRigContext.Provider>;
}

export const useRentedRigs = () => {
  const context = useContext(RentedRigContext);
  if (!context) throw new Error('useRentedRigs must be used within a RentedRigProvider');
  return context;
};