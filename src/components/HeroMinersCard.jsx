import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { fetchMiningStats } from "./miningStatsFetcher";
import { useRentedRigs } from "./RentedRigContext.jsx";
import MiningDutch from "./MiningDutch";
import { 
  normalizeAlgoForNiceHash, 
  getAlgorithmDisplayName,
  getAlgorithmCategory,
  formatHashrate
} from "../core/mapping.js";

function formatNumber(value, digits = 0) {
  const num = Number(value);
  return Number.isFinite(num)
    ? num.toLocaleString(undefined, { maximumFractionDigits: digits })
    : "0";
}

function HeroMinersTable({
  stats,
  filterMiningOnly,
  activeAlgos,
  sortConfig,
  onSort,
}) {
  const rows = useMemo(() => {
    const list = Array.isArray(stats) ? [...stats] : [];
    
    // Normalize and enhance data with mapping
    const enhanced = list.map(coin => ({
      ...coin,
      normalizedAlgo: normalizeAlgoForNiceHash(coin.algorithm || ''),
      displayName: getAlgorithmDisplayName(coin.algorithm || ''),
      category: getAlgorithmCategory(coin.algorithm || ''),
      // Ensure numeric values
      miners: Number(coin.miners) || 0,
      usdPerDay: Number(coin.usdPerDay) || 0,
      btcPerDay: Number(coin.btcPerDay) || 0
    }));
    
    const filtered = filterMiningOnly
      ? enhanced.filter((coin) =>
          activeAlgos.has(coin.normalizedAlgo) || 
          activeAlgos.has(String(coin.algorithm || "").toUpperCase())
        )
      : enhanced;

    return filtered.sort((a, b) => {
      let aVal;
      let bVal;

      if (sortConfig.key === "usdPerDay") {
        aVal = a.usdPerDay || 0;
        bVal = b.usdPerDay || 0;
      } else if (sortConfig.key === "miners") {
        aVal = a.miners || 0;
        bVal = b.miners || 0;
      } else if (sortConfig.key === "btcPerDay") {
        aVal = a.btcPerDay || 0;
        bVal = b.btcPerDay || 0;
      } else if (sortConfig.key === "algorithm") {
        aVal = a.displayName || a.algorithm || '';
        bVal = b.displayName || b.algorithm || '';
      } else {
        aVal = String(a[sortConfig.key] || "").toLowerCase();
        bVal = String(b[sortConfig.key] || "").toLowerCase();
      }

      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [stats, filterMiningOnly, activeAlgos, sortConfig]);

  if (!rows.length) {
    return (
      <div style={{ opacity: 0.6, padding: "10px" }}>
        {stats?.length > 0 && filterMiningOnly 
          ? "No active mining algorithms match your rented rigs"
          : "No data available"}
      </div>
    );
  }

  // Calculate summary stats
  const totalMiners = rows.reduce((sum, row) => sum + row.miners, 0);
  const totalUsdPerDay = rows.reduce((sum, row) => sum + row.usdPerDay, 0);
  const totalBtcPerDay = rows.reduce((sum, row) => sum + row.btcPerDay, 0);

  return (
    <div>
      {/* Summary stats */}
      <div style={{ 
        display: 'flex', 
        gap: '16px', 
        padding: '8px 4px', 
        marginBottom: '8px',
        fontSize: '10px',
        color: '#94a3b8',
        borderBottom: '1px solid #1e293b'
      }}>
        <span>Total Miners: <strong style={{ color: '#e2e8f0' }}>{formatNumber(totalMiners, 0)}</strong></span>
        <span>Total USD/Day: <strong style={{ color: '#34d399' }}>${totalUsdPerDay.toFixed(2)}</strong></span>
        <span>Total BTC/Day: <strong style={{ color: '#fbbf24' }}>{totalBtcPerDay.toFixed(8)}</strong></span>
        <span>Rows: <strong style={{ color: '#60a5fa' }}>{rows.length}</strong></span>
      </div>
      
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}
      >
        <thead>
          <tr style={{ color: "#64748b", borderBottom: "1px solid #334155" }}>
            <th
              style={{ padding: "6px 4px", textAlign: "left", cursor: "pointer" }}
              onClick={() => onSort("algorithm")}
            >
              Algorithm
            </th>
            <th
              style={{
                padding: "6px 4px",
                textAlign: "left",
                cursor: "pointer",
              }}
              onClick={() => onSort("category")}
            >
              Category
            </th>
            <th
              style={{
                padding: "6px 4px",
                textAlign: "right",
                cursor: "pointer",
              }}
              onClick={() => onSort("miners")}
            >
              Miners
            </th>
            <th
              style={{
                padding: "6px 4px",
                textAlign: "right",
                cursor: "pointer",
              }}
              onClick={() => onSort("usdPerDay")}
            >
              USD/Day
            </th>
            <th
              style={{
                padding: "6px 4px",
                textAlign: "right",
                cursor: "pointer",
              }}
              onClick={() => onSort("btcPerDay")}
            >
              BTC/Day
            </th>
            <th
              style={{
                padding: "6px 4px",
                textAlign: "left",
                cursor: "pointer",
              }}
              onClick={() => onSort("hashrate")}
            >
              Hashrate
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((coin, idx) => {
            const categoryColors = {
              ASIC: '#f87171',
              GPU: '#34d399',
              CPU: '#60a5fa',
              HYBRID: '#fbbf24',
              UNKNOWN: '#94a3b8'
            };
            
            return (
              <tr
                key={`${coin.algorithm || "coin"}-${idx}`}
                style={{ borderBottom: "1px solid #1e293b" }}
              >
                <td style={{ padding: "6px 4px", color: "#e2e8f0" }}>
                  <div>{coin.displayName || coin.algorithm || "N/A"}</div>
                  {coin.algorithm && coin.displayName !== coin.algorithm && (
                    <div style={{ fontSize: "9px", color: "#64748b" }}>
                      {coin.algorithm}
                    </div>
                  )}
                </td>
                <td style={{ padding: "6px 4px" }}>
                  <span style={{
                    color: categoryColors[coin.category] || '#94a3b8',
                    fontSize: '9px',
                    background: 'rgba(255,255,255,0.05)',
                    padding: '2px 6px',
                    borderRadius: '4px'
                  }}>
                    {coin.category || 'UNKNOWN'}
                  </span>
                </td>
                <td style={{ padding: "6px 4px", textAlign: "right" }}>
                  {formatNumber(coin.miners, 0)}
                  {coin.miners > 0 && coin.miners < 100 && (
                    <span style={{ color: '#fbbf24', fontSize: '9px', marginLeft: '4px' }}>
                      ⚠️
                    </span>
                  )}
                </td>
                <td style={{ padding: "6px 4px", textAlign: "right", color: "#34d399" }}>
                  ${coin.usdPerDay.toFixed(2)}
                </td>
                <td style={{ padding: "6px 4px", textAlign: "right", color: "#fbbf24" }}>
                  {coin.btcPerDay.toFixed(8)}
                </td>
                <td style={{ padding: "6px 4px", color: "#94a3b8", fontSize: "10px" }}>
                  {coin.hashrate || 'N/A'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function HeroMinersCard({ onCall, pollInterval = 30000 }) {
  const [heroGlobalStats, setHeroGlobalStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortConfig, setSortConfig] = useState({
    key: "usdPerDay",
    direction: "desc",
  });
  const [filterMiningOnly, setFilterMiningOnly] = useState(false);
  const [showAllAlgos, setShowAllAlgos] = useState(true);
  const pollTimerRef = useRef(null);
  const { rentedRigs } = useRentedRigs();

  const activeAlgos = useMemo(
    () =>
      new Set(
        rentedRigs
          .map((r) => {
            const algo = String(r.algo || r.algorithm || r.type || "").toUpperCase();
            return normalizeAlgoForNiceHash(algo);
          })
          .filter(Boolean),
      ),
    [rentedRigs],
  );

  // Get all unique algorithms from the data for filtering
  const allAlgos = useMemo(() => {
    if (!heroGlobalStats?.coinStats) return [];
    const algoSet = new Set();
    heroGlobalStats.coinStats.forEach(coin => {
      if (coin.algorithm) {
        algoSet.add(normalizeAlgoForNiceHash(coin.algorithm));
      }
    });
    return Array.from(algoSet);
  }, [heroGlobalStats]);

  const requestSort = useCallback((key) => {
    setSortConfig((current) => ({
      key,
      direction:
        current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  }, []);

  const fetchHeroMiners = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const stats = await fetchMiningStats(
        "herominers_global",
        "BT",
        null,
        null,
        20000,
        force,
      );
      if (stats?.success) {
        setHeroGlobalStats(stats);
        setError(null);
      } else {
        setHeroGlobalStats(null);
        setError(stats?.error || "Failed to fetch HeroMiners stats.");
      }
    } catch (err) {
      setHeroGlobalStats(null);
      setError(err.message || "Failed to fetch HeroMiners stats.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchHeroMiners();
    });
    if (pollInterval > 0) {
      pollTimerRef.current = setInterval(() => {
        void fetchHeroMiners();
      }, pollInterval);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [fetchHeroMiners, pollInterval]);

  const refreshData = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(() => {
        void fetchHeroMiners();
      }, pollInterval);
    }
    void fetchHeroMiners(true);
  }, [fetchHeroMiners, pollInterval]);

  const heroStats = heroGlobalStats?.coinStats || [];

  // Get algorithm counts for display
  const algoCounts = useMemo(() => {
    const counts = {};
    heroStats.forEach(coin => {
      const algo = normalizeAlgoForNiceHash(coin.algorithm || '');
      if (algo && algo !== 'UNKNOWN') {
        counts[algo] = (counts[algo] || 0) + 1;
      }
    });
    return counts;
  }, [heroStats]);

  return (
    <div
      className="hero-miners-live-card"
      style={{
        padding: "15px",
        background: "rgba(255,255,255,0.02)",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.05)",
        display: "grid",
        gap: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: "#e2e8f0" }}>HeroMiners</h3>
          <div style={{ fontSize: "11px", opacity: 0.6 }}>
            {heroGlobalStats?.miners
              ? `${formatNumber(heroGlobalStats.miners)} miners across ${Object.keys(algoCounts).length} algorithms`
              : "Global pool snapshot"}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              cursor: "pointer",
              color: "#94a3b8",
            }}
          >
            <input
              type="checkbox"
              checked={filterMiningOnly}
              onChange={(e) => setFilterMiningOnly(e.target.checked)}
            />
            Mining Only
          </label>

          {filterMiningOnly && activeAlgos.size > 0 && (
            <span style={{ fontSize: "10px", color: "#60a5fa" }}>
              {activeAlgos.size} active algorithm{activeAlgos.size > 1 ? 's' : ''}
            </span>
          )}

          <button
            className="btn-pro secondary"
            onClick={refreshData}
            disabled={loading}
            style={{
              fontSize: "11px",
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      <div
        className="code-block-content"
        style={{
          maxHeight: "380px",
          overflowY: "auto",
          fontSize: "11px",
          color: "#94a3b8",
          background: "rgba(0,0,0,0.2)",
          padding: "12px",
          borderRadius: "8px",
        }}
      >
        {loading && !error && (
          <div style={{ textAlign: "center", padding: "20px", opacity: 0.7 }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ color: "#f87171", padding: "10px" }}>
            <div>{error}</div>
            <button
              onClick={refreshData}
              style={{
                marginTop: "8px",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid #475569",
                color: "#e2e8f0",
                padding: "4px 12px",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        )}
        {!error && !loading && (
          <HeroMinersTable
            stats={heroStats}
            filterMiningOnly={filterMiningOnly}
            activeAlgos={activeAlgos}
            sortConfig={sortConfig}
            onSort={requestSort}
          />
        )}
      </div>

      <MiningDutch onCall={onCall} />
    </div>
  );
}