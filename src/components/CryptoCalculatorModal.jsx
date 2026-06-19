import React, { useState, useEffect, useMemo, useCallback } from "react";

/**
 * A multi-currency calculator modal for BTC, ETH, LTC, DOGE, and BCH.
 * Fetches live market data directly from CoinGecko.
 */

const COINS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "litecoin", symbol: "LTC", name: "Litecoin" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "bitcoin-cash", symbol: "BCH", name: "Bitcoin Cash" },
];

export function CryptoCalculatorModal({ isOpen, onClose, onCall }) {
  const [prices, setPrices] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [wsEnabled, setWsEnabled] = useState(true);
  const [amounts, setAmounts] = useState({ bitcoin: "0.001" });
  const [baseCoin, setBaseCoin] = useState("bitcoin");

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

      // Check if the data contains any of our tracked coins
      const hasValidPriceData =
        data &&
        COINS.some(
          (coin) =>
            data[coin.id] ||
            data[coin.symbol] ||
            data[coin.symbol.toLowerCase()],
        );

      if (data && hasValidPriceData) {
        setPrices(data);
      } else {
        const isSystemConfig = data && data.environments && data.default_client;

        const detail = isSystemConfig
          ? "Backend Routing Error: System Config Leak"
          : typeof res === "string"
            ? res.includes("<!DOCTYPE html>")
              ? "Cloudflare Block"
              : `API Error: ${res.slice(0, 50)}`
            : res?.error || res?.message || "Invalid Data Shape";

        if (isSystemConfig) setWsEnabled(false);
        setError(detail);
      }
    } catch (err) {
      console.error(`[CryptoCalculator] REST fetch failed: ${err.message}`);
      // Don't block the modal; the WebSocket will fill in prices if it connects.
    } finally {
      setLoading(false);
    }
  }, [onCall]);

  useEffect(() => {
    if (!isOpen) return;

    fetchPrices();

    let socket = null;
    let reconnectTimeout = null;
    let retryCount = 0;

    const connectWs = () => {
      if (!wsEnabled) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const token = localStorage.getItem("token");
      const wsUrl = `${protocol}//${window.location.host}/api/v2/prices/ws${token ? `?token=${token}` : ""}`;

      socket = new WebSocket(wsUrl);
      setWsStatus("connecting");

      socket.onopen = () => setWsStatus("connected");
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "price_update" && message.data) {
            setPrices((prev) => ({ ...prev, ...message.data }));
          }
        } catch (err) {}
      };

      socket.onclose = () => {
        if (retryCount >= 3) return;
        setWsStatus("disconnected");
        if (retryCount < 3) {
          reconnectTimeout = setTimeout(connectWs, 15000);
          retryCount++;
        }
      };
      socket.onerror = () => setWsStatus("error");
    };

    connectWs();

    return () => {
      if (socket) socket.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [isOpen, fetchPrices]);

  // Polling fallback for Modal
  useEffect(() => {
    if (!isOpen || wsStatus === "connected") return;
    const pollTimer = setInterval(() => fetchPrices(), 60000);
    return () => clearInterval(pollTimer);
  }, [isOpen, fetchPrices, wsStatus]);

  const results = useMemo(() => {
    // Return empty results but keep symbols if prices aren't loaded yet
    const currentInput = parseFloat(amounts[baseCoin]) || 0;

    // Helper to find coin data by ID or Symbol (handles various proxy formats)
    const getCoinData = (id) => {
      const coin = COINS.find((c) => c.id === id);
      return (
        prices?.[id] ||
        prices?.[coin?.symbol] ||
        prices?.[coin?.symbol?.toLowerCase()]
      );
    };

    const getPrice = (data) =>
      data?.usd || (typeof data === "number" ? data : 0);

    // Calculate the pivot USD value based on current base input
    const baseData = baseCoin === "usd" ? null : getCoinData(baseCoin);
    const usdValue =
      baseCoin === "usd" ? currentInput : currentInput * getPrice(baseData);

    return COINS.map((coin) => ({
      ...coin,
      calculated:
        getPrice(getCoinData(coin.id)) > 0
          ? usdValue / getPrice(getCoinData(coin.id))
          : 0,
      usdPrice: getPrice(getCoinData(coin.id)),
      change24h: getCoinData(coin.id)?.usd_24h_change || 0,
    }));
  }, [prices, amounts, baseCoin]);

  const onValueChange = (id, val) => {
    setBaseCoin(id);
    setAmounts({ [id]: val });
  };

  const getDisplayUsdValue = () => {
    if (baseCoin === "usd") return amounts.usd;
    const coin = COINS.find((c) => c.id === baseCoin);
    const data =
      prices?.[baseCoin] ||
      prices?.[coin?.symbol] ||
      prices?.[coin?.symbol?.toLowerCase()];
    const price = data?.usd || (typeof data === "number" ? data : 0);
    if (!price) return "0.00";
    const val = (parseFloat(amounts[baseCoin]) || 0) * price;
    return val.toFixed(2);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-2">
      <div className="bg-[#1e293b] border border-slate-200 rounded-xl shadow-lg w-full max-w-[280px] overflow-hidden">
        {/* Header */}
        <div className="px-3 py-2 border-b border-slate-200 flex justify-between items-center bg-slate-800/30">
          <h3 className="font-black text-white tracking-tight">
            💰 CRYPTO CALC
          </h3>
          <button
            onClick={onClose}
            className="p-0.5 hover:bg-slate-100 rounded"
          >
            <svg
              className="w-2 h-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="p-3 space-y-2">
          {/* USD input */}
          <div className="bg-slate-100/30 p-1 rounded-lg border border-slate-200">
            <label className="font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
              USD
            </label>
            <div className="relative">
              <span className="absolute left-0 text-slate-200">$</span>
              <input
                type="number"
                className="w-full bg-transparent pl-4 font-mono text-white outline-none focus:text-blue-400"
                style={{ fontSize: "1rem" }}
                value={getDisplayUsdValue()}
                onChange={(e) => onValueChange("usd", e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {/* Coin rows */}
          <div className="space-y-1.5 max-h-[100px] overflow-y-auto">
            {loading && !prices ? (
              <div className="py-6 text-center">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin inline-block"></div>
                <p className="text-slate-200 mt-1">Loading</p>
              </div>
            ) : (
              results.map((coin) => (
                <div
                  key={coin.id}
                  className="flex items-center justify-between bg-slate-800/30 px-2 py-1.5 rounded-lg hover:bg-slate-100/50"
                >
                  <div className="flex items-baseline gap-1">
                    <span className="font-bold text-white">{coin.symbol}</span>
                    <span
                      className={`font-bold ${coin.change24h >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {coin.change24h >= 0 ? "▲" : "▼"}
                      {Math.abs(coin.change24h).toFixed(1)}%
                    </span>
                  </div>
                  <input
                    type="number"
                    className="bg-transparent text-right font-mono text-white outline-none w-32 focus:text-blue-400"
                    style={{ fontSize: "1rem" }}
                    value={
                      baseCoin === coin.id
                        ? amounts[coin.id]
                        : coin.calculated > 0
                          ? coin.calculated.toFixed(6)
                          : "0"
                    }
                    onChange={(e) => onValueChange(coin.id, e.target.value)}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Refresh */}
        <button
          onClick={fetchPrices}
          className="w-full py-1.5 bg-slate-800 font-bold text-slate-400 hover:text-white border-t border-slate-200 uppercase tracking-wider"
        >
          ↻ REFRESH
        </button>
      </div>
    </div>
  );
}
