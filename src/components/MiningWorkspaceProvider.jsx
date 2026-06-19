import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchMiningStats } from './miningStatsFetcher';
import {
  mergeMiningRoutes,
  normalizeHeroRows,
  normalizeMiningDutchRows,
} from './miningWorkspaceData';

const MiningWorkspaceContext = createContext(null);

export function MiningWorkspaceProvider({ children, onCall, nhClient = 'BT' }) {
  const [heroStats, setHeroStats] = useState(null);
  const [dutchStats, setDutchStats] = useState(null);
  const [niceHashPrices, setNiceHashPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setError('');

    try {
      const [heroResult, dutchResult] = await Promise.allSettled([
        fetchMiningStats('herominers_global', 'BT', null, null, 20000, force),
        fetchMiningStats('miningpooldutch', 'BT', null, null, 20000, force),
      ]);

      const hero = heroResult.status === 'fulfilled' ? heroResult.value : null;
      const dutch = dutchResult.status === 'fulfilled' ? dutchResult.value : null;

      if (hero) setHeroStats(hero);
      if (dutch) setDutchStats(dutch);

      if (!hero && !dutch) {
        throw new Error(heroResult.reason?.message || dutchResult.reason?.message || 'Failed to load mining workspace data');
      }

      const nextHero = hero || heroStats;
      const nextDutch = dutch || dutchStats;
      const algos = Array.from(new Set([
        ...normalizeHeroRows(nextHero).map((row) => row.nicehashAlgo),
        ...normalizeMiningDutchRows(nextDutch).map((row) => row.nicehashAlgo),
      ])).filter((algo) => algo && algo !== 'UNKNOWN');

      if (typeof onCall === 'function' && algos.length > 0) {
        const pricePairs = await Promise.all(algos.map(async (algo) => {
          try {
            const data = await onCall('/api/v2/hashpower/order/price', {
              query: { algorithm: algo, market: 'USA', client: nhClient },
              silent: true,
            });
            const price = Number.parseFloat(data?.price ?? data?.fixedPrice ?? data?.marketPrice ?? 0);
            return [algo, Number.isFinite(price) ? price : 0];
          } catch {
            return [algo, 0];
          }
        }));

        setNiceHashPrices(Object.fromEntries(pricePairs));
      }

      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(err.message || 'Failed to load mining workspace data');
    } finally {
      setLoading(false);
    }
  }, [dutchStats, heroStats, nhClient, onCall]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh(false);
    });
  }, [refresh]);

  const heroRows = useMemo(() => normalizeHeroRows(heroStats), [heroStats]);
  const miningDutchRows = useMemo(() => normalizeMiningDutchRows(dutchStats), [dutchStats]);
  const routes = useMemo(
    () => mergeMiningRoutes(miningDutchRows, heroRows, niceHashPrices),
    [heroRows, miningDutchRows, niceHashPrices],
  );

  const value = useMemo(() => ({
    heroStats,
    dutchStats,
    heroRows,
    miningDutchRows,
    routes,
    niceHashPrices,
    loading,
    error,
    lastUpdated,
    refresh,
  }), [dutchStats, error, heroRows, heroStats, lastUpdated, loading, miningDutchRows, niceHashPrices, refresh, routes]);

  return (
    <MiningWorkspaceContext.Provider value={value}>
      {children}
    </MiningWorkspaceContext.Provider>
  );
}

export function useMiningWorkspace() {
  const context = useContext(MiningWorkspaceContext);
  if (!context) {
    throw new Error('useMiningWorkspace must be used within a MiningWorkspaceProvider');
  }
  return context;
}
