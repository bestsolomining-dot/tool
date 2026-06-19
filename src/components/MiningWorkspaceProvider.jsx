import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchMiningStats } from "./miningStatsFetcher";
import {
  buildOpportunityRows,
  mergeMiningRoutes,
  normalizeHeroRows,
  normalizeMrrMarketRows,
  normalizeMiningDutchRows,
} from "./miningWorkspaceData";

const MiningWorkspaceContext = createContext(null);

export function MiningWorkspaceProvider({ children, onCall, nhClient = "BT" }) {
  const [heroStats, setHeroStats] = useState(null);
  const [dutchStats, setDutchStats] = useState(null);
  const [mrrMarketStats, setMrrMarketStats] = useState(null);
  const [niceHashPrices, setNiceHashPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const heroStatsRef = useRef(null);
  const dutchStatsRef = useRef(null);
  const mrrMarketStatsRef = useRef(null);

  useEffect(() => {
    heroStatsRef.current = heroStats;
  }, [heroStats]);

  useEffect(() => {
    dutchStatsRef.current = dutchStats;
  }, [dutchStats]);

  useEffect(() => {
    mrrMarketStatsRef.current = mrrMarketStats;
  }, [mrrMarketStats]);

  const refresh = useCallback(
    async (force = false) => {
      setLoading(true);
      setError("");

      try {
        const [heroResult, dutchResult] = await Promise.allSettled([
          fetchMiningStats("herominers_global", "BT", null, null, 20000, force),
          fetchMiningStats("miningpooldutch", "BT", null, null, 20000, force),
        ]);

        const hero =
          heroResult.status === "fulfilled" ? heroResult.value : null;
        const dutch =
          dutchResult.status === "fulfilled" ? dutchResult.value : null;

        if (hero) setHeroStats(hero);
        if (dutch) setDutchStats(dutch);

        if (!hero && !dutch) {
          throw new Error(
            heroResult.reason?.message ||
              dutchResult.reason?.message ||
              "Failed to load mining workspace data",
          );
        }

        let mrrMarketPayload = mrrMarketStatsRef.current;
        if (typeof onCall === "function") {
          try {
            mrrMarketPayload = await onCall("/api/v2/mrr/rentals", {
              query: { client: nhClient, type: "sold" },
              silent: true,
            });
            if (mrrMarketPayload) setMrrMarketStats(mrrMarketPayload);
          } catch {
            // Keep the previous snapshot if the market request fails.
          }
        }

        const nextHero = hero || heroStatsRef.current;
        const nextDutch = dutch || dutchStatsRef.current;
        const nextMrrMarket = mrrMarketPayload || mrrMarketStatsRef.current;
        const nextHeroRows = normalizeHeroRows(nextHero);
        const nextDutchRows = normalizeMiningDutchRows(nextDutch);
        const nextMrrMarketRows = normalizeMrrMarketRows(nextMrrMarket);
        const algos = Array.from(
          new Set([
            ...nextHeroRows.map((row) => row.nicehashAlgo),
            ...nextDutchRows.map((row) => row.nicehashAlgo),
            ...nextMrrMarketRows.map((row) => row.nicehashAlgo),
          ]),
        ).filter((algo) => algo && algo !== "UNKNOWN");

        let nextNiceHashPrices = {};
        if (typeof onCall === "function" && algos.length > 0) {
          const pricePairs = await Promise.all(
            algos.map(async (algo) => {
              try {
                const data = await onCall("/api/v2/hashpower/order/price", {
                  query: { algorithm: algo, market: "USA", client: nhClient },
                  silent: true,
                });
                const price = Number.parseFloat(
                  data?.price ?? data?.fixedPrice ?? data?.marketPrice ?? 0,
                );
                return [algo, Number.isFinite(price) ? price : 0];
              } catch {
                return [algo, 0];
              }
            }),
          );

          nextNiceHashPrices = Object.fromEntries(pricePairs);
          setNiceHashPrices(nextNiceHashPrices);
        }

        const nextRoutes = mergeMiningRoutes(
          nextDutchRows,
          nextHeroRows,
          nextNiceHashPrices,
        );
        const nextOpportunities = buildOpportunityRows(
          nextRoutes,
          nextNiceHashPrices,
          nextMrrMarketRows,
        );

        if (typeof onCall === "function") {
          try {
            await onCall("/api/v2/mining/training-snapshot", {
              method: "POST",
              body: {
                capturedAt: new Date().toISOString(),
                nhClient,
                heroRows: nextHeroRows,
                miningDutchRows: nextDutchRows,
                mrrMarketRows: nextMrrMarketRows,
                routes: nextRoutes,
                opportunities: nextOpportunities,
                niceHashPrices: nextNiceHashPrices,
                summary: {
                  bestAlgo: nextOpportunities[0]?.nicehashAlgo || "",
                  bestWinner: nextOpportunities[0]?.winner || "",
                  bestScore: nextOpportunities[0]?.opportunityScore || 0,
                },
              },
              silent: true,
            });
          } catch {
            // Training snapshot persistence should never block refresh.
          }
        }

        setLastUpdated(new Date().toISOString());
      } catch (err) {
        setError(err.message || "Failed to load mining workspace data");
      } finally {
        setLoading(false);
      }
    },
    [nhClient, onCall],
  );

  useEffect(() => {
    queueMicrotask(() => {
      void refresh(false);
    });
  }, [refresh]);

  const heroRows = useMemo(() => normalizeHeroRows(heroStats), [heroStats]);
  const miningDutchRows = useMemo(
    () => normalizeMiningDutchRows(dutchStats),
    [dutchStats],
  );
  const mrrMarketRows = useMemo(
    () => normalizeMrrMarketRows(mrrMarketStats),
    [mrrMarketStats],
  );
  const routes = useMemo(
    () => mergeMiningRoutes(miningDutchRows, heroRows, niceHashPrices),
    [heroRows, miningDutchRows, niceHashPrices],
  );
  const opportunities = useMemo(
    () => buildOpportunityRows(routes, niceHashPrices, mrrMarketRows),
    [mrrMarketRows, niceHashPrices, routes],
  );

  const value = useMemo(
    () => ({
      heroStats,
      dutchStats,
      mrrMarketStats,
      heroRows,
      miningDutchRows,
      routes,
      opportunities,
      niceHashPrices,
      loading,
      error,
      lastUpdated,
      refresh,
    }),
    [
      dutchStats,
      error,
      heroRows,
      heroStats,
      lastUpdated,
      loading,
      miningDutchRows,
      mrrMarketStats,
      niceHashPrices,
      opportunities,
      refresh,
      routes,
    ],
  );

  return (
    <MiningWorkspaceContext.Provider value={value}>
      {children}
    </MiningWorkspaceContext.Provider>
  );
}

export function useMiningWorkspace() {
  const context = useContext(MiningWorkspaceContext);
  if (!context) {
    throw new Error(
      "useMiningWorkspace must be used within a MiningWorkspaceProvider",
    );
  }
  return context;
}
