// ws.js - WebSocket server for mining stats
// Handles WebSocket connections from miningStatsFetcher.js
// Legacy support - all new requests should use REST API

import { WebSocketServer } from "ws";
import { scrapeHeroMinersGlobal } from "./miningOpportunityNotifier.js";

const ACTION_HANDLERS = {
  herominers: handleHeroMiners,
  herominers_global: handleHeroMiners,
  miningpooldutch: handleMiningDutch,
  miningDutch: handleMiningDutch,
  all: handleAll,
};

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: "/api/v2/mrr/fetch/ws" });

  wss.on("connection", (ws, req) => {
    console.log("[WS] Client connected");

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const { requestId, action, client, rigid, coin, force } = msg;

        const handler = ACTION_HANDLERS[action];
        if (!handler) {
          ws.send(
            JSON.stringify({
              requestId,
              success: false,
              error: `Unknown action: ${action}`,
            })
          );
          return;
        }

        const data = await handler({ client, rigid, coin, force });
        ws.send(JSON.stringify({ requestId, success: true, action, data }));
      } catch (err) {
        try {
          const msg = JSON.parse(raw.toString());
          ws.send(
            JSON.stringify({
              requestId: msg.requestId,
              success: false,
              action: msg.action,
              error: err.message,
            })
          );
        } catch {}
      }
    });

    ws.on("close", () => {
      console.log("[WS] Client disconnected");
    });

    ws.on("error", (err) => {
      console.error("[WS] Client error:", err.message);
    });
  });

  console.log("[WS] WebSocket server initialized at /api/v2/mrr/fetch/ws");
  return wss;
}

async function handleHeroMiners(options) {
  const result = await scrapeHeroMinersGlobal(options?.force || false);
  return result;
}

async function handleMiningDutch(options) {
  try {
    const res = await fetch(
      "https://www.mining-dutch.nl/api/v1/public/multiport/?method=avgprofitability",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) throw new Error(`Mining-Dutch API: ${res.status}`);

    const json = await res.json();
    if (!json?.success || !json?.result) {
      throw new Error("Mining-Dutch API returned invalid data");
    }

    // Map avgprofitability results to coinStats format
    const coinStats = Object.entries(json.result).map(([algorithm, data]) => {
      const expected = parseFloat(data.expected || data.average || 0);
      return {
        algorithm,
        coin: algorithm.toUpperCase(),
        btcPerDay: Number.isFinite(expected) ? expected : 0,
        usdPerDay: 0,
        miners: 0,
        hashrate: "N/A",
      };
    });

    return {
      miningpooldutch: {
        coinStats,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.error("[WS:dutch] Fetch error:", err.message);
    throw err;
  }
}

async function handleAll(options) {
  const [hero, dutch] = await Promise.allSettled([
    handleHeroMiners(options),
    handleMiningDutch(options),
  ]);

  return {
    herominers: hero.status === "fulfilled" ? hero.value : null,
    miningDutch: dutch.status === "fulfilled" ? dutch.value : null,
  };
}
