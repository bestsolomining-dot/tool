import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

const RentedRigContext = createContext();

export function RentedRigProvider({ children, nhClient, callApi }) {
  const [rentedRigs, setRentedRigs] = useState([]);
  const [summary, setSummary] = useState({ totalPaid: "0.00000000", count: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchRentedRigs = useCallback(async (maxPrice = 1.0) => {
    setLoading(true);
    try {
      const data = await callApi('/api/v2/hashpower/rented-summary', {
        query: { price: maxPrice, client: nhClient },
        silent: true
      });

      if (data && data.success) {
        setRentedRigs(data.orders || []);
        setSummary({ totalPaid: data.totalPaid, count: data.count });
        setError(null);
      } else {
        setError(data?.error || 'Failed to fetch rented rigs summary');
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