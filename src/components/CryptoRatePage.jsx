import React, { useState, useEffect, useCallback, useMemo } from "react";

const COINS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "litecoin", symbol: "LTC", name: "Litecoin" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "bitcoin-cash", symbol: "BCH", name: "Bitcoin Cash" },
];

function Sparkline({ data, width = 180, height = 80, color = "#60a5fa" }) {
  if (!data || !Array.isArray(data) || data.length < 2) {
    return (
      <div
        style={{
          width,
          height,
          background: "rgba(255,255,255,0.02)",
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* <span style={{ fontSize: '8px', opacity: 0.2, fontWeight: 'bold', letterSpacing: '0.1em' }}>NO HISTORY</span> */}
      </div>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((val, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ overflow: "visible", filter: `drop-shadow(0 0 4px ${color}44)` }}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export default function CryptoRatePage({ onCall }) {
  const [prices, setPrices] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [wsEnabled, setWsEnabled] = useState(true);
  const [amounts, setAmounts] = useState({ usd: "1000" });
  const [baseCoin, setBaseCoin] = useState("usd");

  const onValueChange = (id, val) => {
    setBaseCoin(id);
    setAmounts({ [id]: val });
  };

  const fetchPrices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = COINS.map((c) => c.id).join(",");
      const res = await onCall("/api/v2/prices/coingecko", {
        query: { ids, vs_currencies: "usd", sparkline: true },
        silent: true,
      });

      const data =
        res?.data ||
        (res && typeof res === "object" && !res.error ? res : null);

      if (data && (data.bitcoin || data.BTC || data.btc)) {
        setPrices(data);
      } else {
        // Detect if the server leaked a system config object instead of price data
        const isSystemConfig = data && data.environments && data.default_client;

        const detail = isSystemConfig
          ? "Backend Routing Error: Market API obscured by System Config."
          : typeof res === "string"
            ? res.includes("<!DOCTYPE html>")
              ? "Cloudflare Intercept"
              : `API Error: ${res.slice(0, 100)}`
            : res?.error ||
              res?.message ||
              `Format Mismatch (Keys: ${res ? Object.keys(res).join(",") : "null"})`;

        if (isSystemConfig) {
          setWsEnabled(false); // Kill WS attempts if routing is clearly broken
        }

        if (!prices) setError(`Market data unavailable. ${detail}`);
        throw new Error(detail);
      }
    } catch (err) {
      console.error(`[CryptoRate] REST fetch failed: ${err.message}`);
      // We don't set a hard error here because the WebSocket might still connect and provide data
    } finally {
      setLoading(false);
    }
  }, [onCall]);

  useEffect(() => {
    // Initial fetch to populate data immediately
    fetchPrices();

    // Initialize WebSocket for real-time updates
    let socket = null;
    let reconnectTimeout = null;
    let isComponentMounted = true;
    let retryCount = 0;

    const connectWs = () => {
      if (!isComponentMounted || !wsEnabled) return;

      // Close existing socket if any
      if (socket) {
        socket.onclose = null;
        socket.close();
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/v2/prices/ws`;

      socket = new WebSocket(wsUrl);
      if (isComponentMounted) setWsStatus("connecting");

      socket.onopen = () => {
        if (isComponentMounted) setWsStatus("connected");
      };

      socket.onmessage = (event) => {
        if (!isComponentMounted) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "price_update" && message.data) {
            setPrices((prev) => ({ ...prev, ...message.data }));
          }
        } catch (err) {
          console.warn("[WS] Failed to parse price update", err);
        }
      };

      socket.onclose = () => {
        if (!isComponentMounted) return;
        setWsStatus("disconnected");

        if (retryCount < 2 && wsEnabled) {
          // Exponential backoff: 5s, 10s, 20s, 30s, 30s
          const delay = Math.min(30000, 5000 * Math.pow(2, retryCount));
          reconnectTimeout = setTimeout(connectWs, delay);
          retryCount++;
        } else {
          setWsEnabled(false);
          console.warn(
            "[WS] Maximum reconnection attempts reached or disabled. Staying in polling mode.",
          );
        }
      };

      socket.onerror = () => {
        if (isComponentMounted) setWsStatus("error");
      };
    };

    if (wsEnabled) connectWs();

    return () => {
      isComponentMounted = false;
      if (socket) socket.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [fetchPrices, wsEnabled]);

  // Polling fallback: If WebSocket is not connected, refresh prices every 60 seconds
  useEffect(() => {
    const pollTimer = setInterval(() => {
      if (wsStatus !== "connected" && !loading) {
        console.log("[CryptoRate] WS inactive, polling for updates...");
        fetchPrices();
      }
    }, 60000);
    return () => clearInterval(pollTimer);
  }, [fetchPrices, wsStatus, loading]);

  const getCoinData = (id) => {
    const coin = COINS.find((c) => c.id === id);
    return (
      prices?.[id] ||
      prices?.[coin?.symbol] ||
      prices?.[coin?.symbol?.toLowerCase()]
    );
  };

  const getPrice = (data) => data?.usd || (typeof data === "number" ? data : 0);

  const results = useMemo(() => {
    const currentInput = parseFloat(amounts[baseCoin]) || 0;
    const baseData = baseCoin === "usd" ? null : getCoinData(baseCoin);
    const usdValue =
      baseCoin === "usd" ? currentInput : currentInput * getPrice(baseData);

    return COINS.map((coin) => {
      const data = getCoinData(coin.id);
      const price = getPrice(data);
      return {
        ...coin,
        price,
        change: data?.usd_24h_change || 0,
        history: data?.sparkline_in_7d?.price || data?.sparkline || null,
        calculated: price > 0 ? usdValue / price : 0,
        usdValue: usdValue,
      };
    });
  }, [prices, amounts, baseCoin]);

  return (
    <div
      className="crypto-rate-page"
      style={{
        padding: "10px 14px",
        color: "#f8fafc",
        background: "transparent",
        fontFamily: "sans-serif",
        maxWidth: "100%",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          marginBottom: "12px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          paddingBottom: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "1.3rem", fontWeight: "900" }}>
            LIVE <span style={{ color: "#60a5fa" }}>CONVERTER</span>
          </span>
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: wsStatus === "connected" ? "#10b981" : "#f59e0b",
            }}
          ></div>
          <span
            style={{
              opacity: 0.4,
              fontSize: "0.6rem",
              fontWeight: "600",
              textTransform: "uppercase",
            }}
          >
            {wsStatus === "connected" ? "LIVE" : "LIVE"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{ fontSize: "1rem", color: "#60a5fa", fontWeight: "700" }}
          >
            $
          </span>
          <input
            type="number"
            value={
              baseCoin === "usd"
                ? amounts.usd
                : (results[0]?.usdValue || 0).toFixed(2)
            }
            onChange={(e) => onValueChange("usd", e.target.value)}
            style={{
              width: "120px",
              background: "rgba(30,41,59,0.3)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "8px",
              padding: "4px 8px",
              fontSize: "1.3rem",
              color: "#fff",
              fontFamily: "monospace",
              outline: "none",
              textAlign: "right",
            }}
            placeholder="0"
          />
          <button
            onClick={() => {}}
            style={{
              background: "rgba(96,165,250,0.08)",
              border: "1px solid rgba(96,165,250,0.1)",
              borderRadius: "4px",
              padding: "4px 10px",
              color: "#60a5fa",
              fontSize: "0.8rem",
              fontWeight: "600",
              cursor: "pointer",
              fontFamily: "sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            ⟳
          </button>
        </div>
      </div>

      {/* Square Grid - No History */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: "8px",
        }}
      >
        {results.map((coin) => (
          <div
            key={coin.id}
            style={{
              aspectRatio: "2 / 1",
              background:
                baseCoin === coin.id
                  ? "rgba(96,165,250,0.06)"
                  : "rgba(30,41,59,0.12)",
              border:
                baseCoin === coin.id
                  ? "1px solid rgba(96,165,250,0.15)"
                  : "1px solid rgba(255,255,255,0.03)",
              borderRadius: "10px",
              padding: "14px 12px 12px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              transition: "all 0.2s ease",
            }}
          >
            {/* Symbol + Change */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontWeight: "800",
                  color: "#d660fa",
                  fontSize: "0.85rem",
                }}
              >
                {coin.symbol}
              </span>
              <span
                style={{
                  color: coin.change >= 0 ? "#10b981" : "#f87171",
                  fontWeight: "600",
                  fontSize: "0.85rem",
                }}
              >
                {coin.change >= 0 ? "▲" : "▼"}{" "}
                {Math.abs(coin.change).toFixed(1)}%
              </span>
            </div>

            {/* Amount Input */}
            <div style={{ margin: "8px 0" }}>
              <input
                type="number"
                value={
                  baseCoin === coin.id
                    ? amounts[coin.id]
                    : coin.calculated > 0
                      ? coin.calculated.toFixed(6)
                      : "0.000000"
                }
                onChange={(e) => onValueChange(coin.id, e.target.value)}
                style={{
                  width: "100%",
                  background: "rgba(0,0,0,0.25)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: "6px",
                  padding: "6px 8px",
                  fontSize: "1.2rem",
                  color: "#fff",
                  fontFamily: "monospace",
                  outline: "none",
                  textAlign: "center",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Price */}
            <div
              style={{
                fontSize: "0.75rem",
                fontFamily: "monospace",
                color: "rgba(255,255,255,0.35)",
                textAlign: "center",
              }}
            >
              $ {coin.price.toFixed(2)}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div
          style={{
            fontSize: "0.75rem",
            color: "#f87171",
            textAlign: "center",
            marginTop: "10px",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
