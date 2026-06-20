// HeroMinersCard.jsx
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { fetchMiningStats } from "./miningStatsFetcher";
import { useRentedRigs } from "./RentedRigContext.jsx";
import MiningDutch from "./MiningDutch";

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
    const filtered = filterMiningOnly
      ? list.filter((coin) =>
          activeAlgos.has(String(coin.algorithm || "").toUpperCase()),
        )
      : list;

    return filtered.sort((a, b) => {
      let aVal;
      let bVal;

      if (sortConfig.key === "usdPerDay") {
        aVal =
          parseFloat(String(a.usdPerDay || "0").replace(/[^0-9.-]/g, "")) || 0;
        bVal =
          parseFloat(String(b.usdPerDay || "0").replace(/[^0-9.-]/g, "")) || 0;
      } else if (sortConfig.key === "miners") {
        aVal = Number(a.miners) || 0;
        bVal = Number(b.miners) || 0;
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
      <div style={{ opacity: 0.6, padding: "10px" }}>No data available</div>
    );
  }

  return (
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
        </tr>
      </thead>
      <tbody>
        {rows.map((coin, idx) => (
          <tr
            key={`${coin.algorithm || "coin"}-${idx}`}
            style={{ borderBottom: "1px solid #1e293b" }}
          >
            <td style={{ padding: "6px 4px", color: "#e2e8f0" }}>
              {coin.algorithm || "N/A"}
            </td>
            <td style={{ padding: "6px 4px", textAlign: "right" }}>
              {formatNumber(coin.miners, 0)}
            </td>
            <td style={{ padding: "6px 4px", textAlign: "right" }}>
              ${parseFloat(coin.usdPerDay || 0).toFixed(2)}
            </td>
            <td style={{ padding: "6px 4px", textAlign: "right" }}>
              {parseFloat(coin.btcPerDay || 0).toFixed(8)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
  const [filterMiningOnly, setFilterMiningOnly] = useState(false); // false = show all algorithms
  const pollTimerRef = useRef(null);
  const { rentedRigs } = useRentedRigs();

  const activeAlgos = useMemo(
    () =>
      new Set(
        rentedRigs
          .map((r) =>
            String(r.algo || r.algorithm || r.type || "").toUpperCase(),
          )
          .filter(Boolean),
      ),
    [rentedRigs],
  );

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
              ? `${formatNumber(heroGlobalStats.miners)} miners`
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
