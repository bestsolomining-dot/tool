import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";

const RentedRigContext = createContext();

export function RentedRigProvider({ children, callApi }) {
  const [rentedRigs, setRentedRigs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchRentedRigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callApi("/api/v2/mrr/rentals");
      if (data?.error) throw new Error(data.error);
      const rentals = data?.data?.rentals || data?.data || data?.rentals || [];
      setRentedRigs(Array.isArray(rentals) ? rentals : []);
    } catch (err) {
      setError(err.message);
      setRentedRigs([]);
    } finally {
      setLoading(false);
    }
  }, [callApi]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchRentedRigs();
    });
    const interval = setInterval(() => {
      void fetchRentedRigs();
    }, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [fetchRentedRigs]);

  const value = { rentedRigs, loading, error, refresh: fetchRentedRigs };

  return (
    <RentedRigContext.Provider value={value}>
      {children}
    </RentedRigContext.Provider>
  );
}

export const useRentedRigs = () => {
  const context = useContext(RentedRigContext);
  if (!context)
    throw new Error("useRentedRigs must be used within a RentedRigProvider");
  return context;
};
