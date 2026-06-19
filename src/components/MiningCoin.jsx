import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMiningStats } from "./miningStatsFetcher";
import {
  getAlgoDisplayName,
  getAlgorithmUnit,
  mapNiceHashToMRR,
  normalizeAlgoForNiceHash,
} from "../core/mapping";
import { getNiceHashPriceValue } from "../core/mrrUtils";

const numberValue = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(
          String(value)
            .replace(/,/g, "")
            .replace(/[^\d.-]/g, ""),
        );
  return Number.isFinite(parsed) ? parsed : 0;
};

const compactNumber = (value, digits = 2) => {
  const num = numberValue(value);
  if (!num) return "0";
  return num.toLocaleString(undefined, { maximumFractionDigits: digits });
};

const btcValue = (value) => {
  const num = numberValue(value);
  return num > 0 ? num.toFixed(8) : "0.00000000";
};

const percentValue = (value) => {
  const num = numberValue(value);
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
};

const normalizeKey = (algo) =>
  normalizeAlgoForNiceHash(algo || "").toUpperCase();

function normalizeMiningDutchRows(payload) {
  const source = payload?.miningpooldutch || payload || {};
  const rows = Array.isArray(source?.coinStats) ? source.coinStats : [];
  return rows
    .map((row) => {
      const nicehashAlgo = normalizeKey(row.algorithm || row.algo);
      return {
        provider: "Mining-Dutch",
        coin: row.coin || row.symbol || row.algorithm || "Pool",
        algorithm: row.algorithm || row.algo || "N/A",
        nicehashAlgo,
        mrrAlgo: mapNiceHashToMRR(nicehashAlgo),
        btcPerDay: numberValue(row.btcPerDay),
        usdPerDay: numberValue(row.usdPerDay),
        miners: numberValue(row.miners),
        hashrate: row.hashrate || "N/A",
      };
    })
    .filter((row) => row.nicehashAlgo && row.nicehashAlgo !== "UNKNOWN");
}

function normalizeHeroRows(payload) {
  const source =
    payload?.herominers_global || payload?.herominers || payload || {};
  const rows = Array.isArray(source?.coinStats) ? source.coinStats : [];
  return rows
    .map((row) => {
      const nicehashAlgo = normalizeKey(row.algorithm || row.algo);
      return {
        provider: "HeroMiners",
        coin: row.coin || row.symbol || "Coin",
        algorithm: row.algorithm || row.algo || "N/A",
        nicehashAlgo,
        mrrAlgo: mapNiceHashToMRR(nicehashAlgo),
        miners: numberValue(row.miners),
        workers: numberValue(row.workers),
        poolHashrate: row.poolHashrate || row.pool_hashrate || "N/A",
        networkHashrate: row.networkHashrate || row.network_hashrate || "N/A",
      };
    })
    .filter((row) => row.nicehashAlgo && row.nicehashAlgo !== "UNKNOWN");
}

function mergeRows(miningDutchRows, heroRows, niceHashPrices) {
  const heroByAlgo = new Map();
  for (const row of heroRows) {
    const current = heroByAlgo.get(row.nicehashAlgo) || {
      coins: [],
      miners: 0,
      workers: 0,
      poolHashrates: [],
    };

    current.coins.push(row.coin);
    current.miners += row.miners;
    current.workers += row.workers;
    if (row.poolHashrate && row.poolHashrate !== "N/A")
      current.poolHashrates.push(row.poolHashrate);
    heroByAlgo.set(row.nicehashAlgo, current);
  }

  const dutchByAlgo = new Map();
  for (const row of miningDutchRows) {
    const current = dutchByAlgo.get(row.nicehashAlgo) || {
      rows: [],
      btcPerDay: 0,
      usdPerDay: 0,
      miners: 0,
      hashrate: row.hashrate,
    };

    current.rows.push(row);
    current.btcPerDay += row.btcPerDay;
    current.usdPerDay += row.usdPerDay;
    current.miners += row.miners;
    current.hashrate = current.hashrate || row.hashrate;
    dutchByAlgo.set(row.nicehashAlgo, current);
  }

  const algos = new Set([...heroByAlgo.keys(), ...dutchByAlgo.keys()]);
  return Array.from(algos)
    .map((nicehashAlgo) => {
      const dutch = dutchByAlgo.get(nicehashAlgo);
      const hero = heroByAlgo.get(nicehashAlgo);
      const nhPrice = niceHashPrices[nicehashAlgo] || 0;
      const poolBtc = dutch?.btcPerDay || 0;
      const spread =
        poolBtc > 0 && nhPrice > 0
          ? ((poolBtc - nhPrice) / nhPrice) * 100
          : null;
      const activityScore = (hero?.miners || 0) + (hero?.workers || 0) * 0.25;
      const profitScore = poolBtc * 100000000;

      return {
        nicehashAlgo,
        mrrAlgo: mapNiceHashToMRR(nicehashAlgo),
        label: getAlgoDisplayName(nicehashAlgo),
        unit: getAlgorithmUnit(nicehashAlgo),
        miningDutchBtcPerDay: poolBtc,
        miningDutchUsdPerDay: dutch?.usdPerDay || 0,
        miningDutchMiners: dutch?.miners || 0,
        miningDutchHashrate: dutch?.hashrate || "N/A",
        heroCoins: Array.from(new Set(hero?.coins || [])).sort(),
        heroMiners: hero?.miners || 0,
        heroWorkers: hero?.workers || 0,
        heroPoolHashrates: hero?.poolHashrates || [],
        niceHashPrice: nhPrice,
        spread,
        rankScore: profitScore + activityScore,
        bestSource: poolBtc > 0 ? "Mining-Dutch" : "HeroMiners",
        dutchRows: dutch?.rows || [],
      };
    })
    .sort((a, b) => {
      const spreadA = a.spread ?? -Infinity;
      const spreadB = b.spread ?? -Infinity;
      if (spreadB !== spreadA) return spreadB - spreadA;
      return b.rankScore - a.rankScore;
    });
}

export default function MiningCoin({ onCall, nhClient = "BT" }) {
  const [heroStats, setHeroStats] = useState(null);
  const [dutchStats, setDutchStats] = useState(null);
  const [niceHashPrices, setNiceHashPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyProfitable, setOnlyProfitable] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");

  const miningDutchRows = useMemo(
    () => normalizeMiningDutchRows(dutchStats),
    [dutchStats],
  );
  const heroRows = useMemo(() => normalizeHeroRows(heroStats), [heroStats]);
  const combinedRows = useMemo(
    () => mergeRows(miningDutchRows, heroRows, niceHashPrices),
    [miningDutchRows, heroRows, niceHashPrices],
  );

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return combinedRows.filter((row) => {
      if (
        onlyProfitable &&
        !(
          row.spread > 0 ||
          (row.miningDutchBtcPerDay > 0 && !row.niceHashPrice)
        )
      ) {
        return false;
      }

      if (!needle) return true;
      return [
        row.label,
        row.nicehashAlgo,
        row.mrrAlgo,
        row.bestSource,
        ...row.heroCoins,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(needle),
      );
    });
  }, [combinedRows, onlyProfitable, query]);

  const bestRow = visibleRows[0] || null;
  const profitableCount = combinedRows.filter((row) => row.spread > 0).length;

  const loadData = useCallback(
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
        const nextHero = hero || heroStats;
        const nextDutch = dutch || dutchStats;

        if (hero) setHeroStats(hero);
        if (dutch) setDutchStats(dutch);

        if (!hero && !dutch) {
          throw new Error(
            heroResult.reason?.message ||
              dutchResult.reason?.message ||
              "Failed to load mining coin profitability",
          );
        }

        setLastUpdated(new Date().toISOString());

        const algos = Array.from(
          new Set([
            ...normalizeHeroRows(nextHero).map((row) => row.nicehashAlgo),
            ...normalizeMiningDutchRows(nextDutch).map(
              (row) => row.nicehashAlgo,
            ),
          ]),
        ).filter((algo) => algo && algo !== "UNKNOWN");

        if (typeof onCall === "function") {
          const pricePairs = await Promise.all(
            algos.map(async (algo) => {
              try {
                const data = await onCall("/api/v2/hashpower/order/price", {
                  query: { algorithm: algo, market: "USA", client: nhClient },
                  silent: true,
                });
                return [algo, getNiceHashPriceValue(data)];
              } catch {
                return [algo, 0];
              }
            }),
          );

          setNiceHashPrices(Object.fromEntries(pricePairs));
        }
      } catch (err) {
        setError(err.message || "Failed to load mining coin profitability");
      } finally {
        setLoading(false);
      }
    },
    [heroStats, dutchStats, nhClient, onCall],
  );

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  return (
    <section
      className="mining-coin-page"
      style={{ display: "grid", gap: "14px" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "14px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: "#e2e8f0" }}>Mining Coin Router</h3>
          <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: "12px" }}>
            Match pool profitability to NiceHash and MRR algorithm names.
          </p>
        </div>
        <div
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "flex",
              gap: "6px",
              alignItems: "center",
              color: "#94a3b8",
              fontSize: "11px",
            }}
          >
            <input
              type="checkbox"
              checked={onlyProfitable}
              onChange={(event) => setOnlyProfitable(event.target.checked)}
            />
            Profitable only
          </label>
          <button
            className="btn-pro secondary"
            onClick={() => void loadData(true)}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: "10px",
        }}
      >
        <SummaryTile
          label="Best algorithm"
          value={bestRow?.label || "N/A"}
          tone="#22d3ee"
        />
        <SummaryTile
          label="Positive spread"
          value={profitableCount}
          tone="#34d399"
        />
        <SummaryTile
          label="Algorithms tracked"
          value={combinedRows.length}
          tone="#fbbf24"
        />
        <SummaryTile
          label="Updated"
          value={
            lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "--"
          }
          tone="#a78bfa"
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: "10px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search algorithm, MRR slug, or coin..."
          style={{
            flex: "1 1 280px",
            minWidth: 0,
            background: "rgba(15,23,42,0.72)",
            border: "1px solid rgba(148,163,184,0.18)",
            borderRadius: "8px",
            color: "#e2e8f0",
            padding: "10px 12px",
            fontSize: "12px",
          }}
        />
        {error && (
          <span style={{ color: "#f87171", fontSize: "12px" }}>{error}</span>
        )}
      </div>

      <div
        style={{
          overflowX: "auto",
          border: "1px solid rgba(148,163,184,0.12)",
          borderRadius: "8px",
          background: "rgba(2,6,23,0.35)",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "11px",
            minWidth: "980px",
          }}
        >
          <thead>
            <tr
              style={{
                color: "#94a3b8",
                borderBottom: "1px solid rgba(148,163,184,0.12)",
              }}
            >
              <HeaderCell align="left">Algorithm</HeaderCell>
              <HeaderCell>NiceHash</HeaderCell>
              <HeaderCell>MRR</HeaderCell>
              <HeaderCell>Pool BTC/day</HeaderCell>
              <HeaderCell>NiceHash price</HeaderCell>
              <HeaderCell>Spread</HeaderCell>
              <HeaderCell>HeroMiners</HeaderCell>
              <HeaderCell align="left">Coins</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {loading && !visibleRows.length ? (
              <tr>
                <td
                  colSpan="8"
                  style={{
                    padding: "24px",
                    textAlign: "center",
                    color: "#94a3b8",
                  }}
                >
                  Loading mining routes...
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan="8"
                  style={{
                    padding: "24px",
                    textAlign: "center",
                    color: "#94a3b8",
                  }}
                >
                  No matching algorithm routes found.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr
                  key={row.nicehashAlgo}
                  style={{ borderBottom: "1px solid rgba(148,163,184,0.08)" }}
                >
                  <BodyCell align="left">
                    <strong style={{ color: "#e2e8f0" }}>{row.label}</strong>
                    <div style={{ color: "#64748b", marginTop: "2px" }}>
                      {row.unit}/day comparison
                    </div>
                  </BodyCell>
                  <BodyCell>{row.nicehashAlgo}</BodyCell>
                  <BodyCell>{row.mrrAlgo}</BodyCell>
                  <BodyCell>
                    <strong
                      style={{
                        color:
                          row.miningDutchBtcPerDay > 0 ? "#34d399" : "#64748b",
                      }}
                    >
                      {btcValue(row.miningDutchBtcPerDay)}
                    </strong>
                    <div style={{ color: "#64748b", marginTop: "2px" }}>
                      {row.miningDutchMiners
                        ? `${compactNumber(row.miningDutchMiners, 0)} MD miners`
                        : row.miningDutchHashrate}
                    </div>
                  </BodyCell>
                  <BodyCell>{btcValue(row.niceHashPrice)}</BodyCell>
                  <BodyCell>
                    <span
                      style={{
                        color:
                          row.spread > 0
                            ? "#34d399"
                            : row.spread < 0
                              ? "#f87171"
                              : "#94a3b8",
                        fontWeight: 700,
                      }}
                    >
                      {row.spread === null ? "N/A" : percentValue(row.spread)}
                    </span>
                  </BodyCell>
                  <BodyCell>
                    <strong style={{ color: "#60a5fa" }}>
                      {compactNumber(row.heroMiners, 0)}
                    </strong>
                    <div style={{ color: "#64748b", marginTop: "2px" }}>
                      {compactNumber(row.heroWorkers, 0)} workers
                    </div>
                  </BodyCell>
                  <BodyCell align="left">
                    <div
                      style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}
                    >
                      {row.heroCoins.slice(0, 8).map((coin) => (
                        <span
                          key={coin}
                          style={{
                            border: "1px solid rgba(96,165,250,0.22)",
                            color: "#bfdbfe",
                            background: "rgba(37,99,235,0.12)",
                            borderRadius: "999px",
                            padding: "2px 6px",
                            fontSize: "10px",
                          }}
                        >
                          {coin}
                        </span>
                      ))}
                      {row.heroCoins.length > 8 && (
                        <span style={{ color: "#64748b" }}>
                          +{row.heroCoins.length - 8}
                        </span>
                      )}
                    </div>
                  </BodyCell>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryTile({ label, value, tone }) {
  return (
    <div
      style={{
        border: "1px solid rgba(148,163,184,0.12)",
        borderRadius: "8px",
        background: "rgba(15,23,42,0.48)",
        padding: "12px",
      }}
    >
      <div
        style={{
          color: "#64748b",
          fontSize: "10px",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: tone,
          fontSize: "18px",
          fontWeight: 800,
          marginTop: "6px",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function HeaderCell({ children, align = "right" }) {
  return (
    <th
      style={{
        padding: "9px 10px",
        textAlign: align,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      }}
    >
      {children}
    </th>
  );
}

export function BodyCell({ children, align = "right" }) {
  return (
    <td
      style={{
        padding: "10px",
        textAlign: align,
        verticalAlign: "top",
        color: "#cbd5e1",
      }}
    >
      {children}
    </td>
  );
}
