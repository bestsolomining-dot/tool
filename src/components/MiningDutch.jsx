import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMiningStats } from "./miningStatsFetcher";

function parseMiningDutchHtml(html) {
  if (!html) return [];

  const doc = new DOMParser().parseFromString(html, "text/html");
  const candidates = [];

  doc.querySelectorAll("div[class]").forEach((node) => {
    const className = (node.getAttribute("class") || "").trim();
    const title = node.querySelector("strong")?.textContent?.trim();
    const buttons = node.querySelectorAll("button.btn.btn-info.btn-sm");
    const metrics = Array.from(node.querySelectorAll("h5"))
      .map((h) => (h.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);

    if (!className || !title || buttons.length === 0 || metrics.length === 0)
      return;

    const currentMetric = metrics[0] || "0";
    const spreadMetric = metrics.find((text) => /%$/.test(text)) || "";
    const hashrateMetric =
      [...metrics]
        .reverse()
        .find((text) => /(?:EH|PH|TH|GH|MH|KH|H|SOL|hs)/i.test(text)) ||
      metrics[metrics.length - 1] ||
      "N/A";
    const coin = node.querySelector("img[alt]")?.getAttribute("alt") || title;

    candidates.push({
      algorithm: title,
      coin,
      miners: "0",
      btcPerDay: currentMetric,
      usdPerDay: 0,
      hashrate: hashrateMetric,
      spread: spreadMetric,
      slug: className.split(/\s+/)[0] || title,
    });
  });

  if (candidates.length > 0) {
    const unique = new Map();
    candidates.forEach((item) => {
      const key = String(item.slug || item.algorithm).toLowerCase();
      if (!unique.has(key)) unique.set(key, item);
    });
    return Array.from(unique.values());
  }

  const table = doc.querySelector("#table_list, #poolloader table, table");
  if (!table) return [];

  return Array.from(table.querySelectorAll("tbody tr"))
    .map((row) => {
      const cells = row.querySelectorAll("td");
      return {
        algorithm: cells[0]?.textContent?.trim() || "N/A",
        miners: cells[1]?.textContent?.trim() || "0",
        btcPerDay: cells[2]?.textContent?.trim() || "0",
        usdPerDay: 0,
        hashrate: cells[4]?.textContent?.trim() || "N/A",
      };
    })
    .filter((item) => item.algorithm !== "N/A");
}

function normalizeMiningDutchRows(payload) {
  if (payload?.html) return parseMiningDutchHtml(payload.html);

  const rows = Array.isArray(payload?.coinStats) ? payload.coinStats : [];
  return rows
    .map((row) => ({
      algorithm: row.algorithm || row.algo || "N/A",
      miners: row.miners || 0,
      btcPerDay: row.btcPerDay || 0,
      usdPerDay: row.usdPerDay || 0,
      hashrate: row.hashrate || "N/A",
    }))
    .filter((item) => item.algorithm !== "N/A");
}

function StatsTable({ rows }) {
  if (!rows.length) {
    return (
      <div style={{ opacity: 0.6, padding: "10px" }}>
        No Mining-Dutch data available
      </div>
    );
  }

  return (
    <table
      style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}
    >
      <thead>
        <tr style={{ color: "#64748b", borderBottom: "1px solid #334155" }}>
          <th style={{ padding: "6px 4px", textAlign: "left" }}>Algorithm</th>
          <th style={{ padding: "6px 4px", textAlign: "right" }}>Miners</th>
          <th style={{ padding: "6px 4px", textAlign: "right" }}>USD/Day</th>
          <th style={{ padding: "6px 4px", textAlign: "right" }}>BTC/Day</th>
          <th style={{ padding: "6px 4px", textAlign: "left" }}>Hashrate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr
            key={`${row.algorithm || "dutch"}-${idx}`}
            style={{ borderBottom: "1px solid #1e293b" }}
          >
            <td style={{ padding: "6px 4px", color: "#e2e8f0" }}>
              {row.algorithm}
            </td>
            <td style={{ padding: "6px 4px", textAlign: "right" }}>
              {row.miners}
            </td>
            <td style={{ padding: "6px 4px", textAlign: "right" }}>
              ${Number(row.usdPerDay || 0).toFixed(2)}
            </td>
            <td style={{ padding: "6px 4px", textAlign: "right" }}>
              {Number(row.btcPerDay || 0).toFixed(8)}
            </td>
            <td style={{ padding: "6px 4px", color: "#94a3b8" }}>
              {row.hashrate}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function MiningDutch({ onCall }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState("");

  const loadData = useCallback(
    async (force = false) => {
      setLoading(true);
      setError("");
      try {
        let response = await fetchMiningStats(
          "miningpooldutch",
          "BT",
          null,
          null,
          20000,
          force,
        );

        if (!response?.success && typeof onCall === "function") {
          response = await onCall("/api/v2/mining-dutch/html", {
            query: force ? { force: 1 } : undefined,
            silent: true,
          });
        }

        if (response?.success) {
          setStats(response);
          setLastFetchedAt(response.fetchedAt || new Date().toISOString());
        } else {
          throw new Error(
            response?.error || "Failed to fetch Mining-Dutch stats",
          );
        }
      } catch (err) {
        setError(err.message || "Failed to fetch Mining-Dutch stats");
        setStats(null);
      } finally {
        setLoading(false);
      }
    },
    [onCall],
  );

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const rows = useMemo(() => normalizeMiningDutchRows(stats), [stats]);

  return (
    <section
      style={{
        padding: "14px",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(255,255,255,0.015)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          marginBottom: "10px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h4 style={{ margin: 0, color: "#fbbf24" }}>Mining-Dutch</h4>
          <div style={{ fontSize: "11px", opacity: 0.6 }}>
            Global pool profitability snapshot
          </div>
        </div>
        <button
          className="btn-pro secondary"
          onClick={() => void loadData(true)}
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

      {lastFetchedAt && !error && (
        <div style={{ fontSize: "10px", opacity: 0.45, marginBottom: "8px" }}>
          Fetched at {new Date(lastFetchedAt).toLocaleTimeString()}
        </div>
      )}

      <div
        style={{
          maxHeight: "300px",
          overflowY: "auto",
          background: "rgba(0,0,0,0.18)",
          borderRadius: "8px",
          padding: "10px",
        }}
      >
        {loading && !error && <div style={{ opacity: 0.7 }}>Loading…</div>}
        {error && (
          <div style={{ color: "#f87171" }}>
            <div>{error}</div>
            <button
              onClick={() => void loadData(true)}
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
        {!error && !loading && <StatsTable rows={rows} />}
      </div>
    </section>
  );
}
