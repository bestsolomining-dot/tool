// server/ws.js
import { WebSocketServer as WSS } from "ws";
import { scrapeHeroMinersGlobal } from "./miners/heroMiners.js";
import { scrapeMiningDutchGlobal } from "./miners/miningDutch.js";
import { getBtcPrice } from "./utils/priceUtils.js";

const ACTION_HANDLERS = {
  herominers: handleHeroMiners,
  herominers_global: handleHeroMiners,
  miningpooldutch: handleMiningDutch,
  miningDutch: handleMiningDutch,
  all: handleAll,
};

export function setupWebSocket(server) {
  const wss = new WSS({ server, path: "/api/v2/mrr/fetch/ws" });

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
        } catch {
          ws.send(
            JSON.stringify({
              success: false,
              error: "Invalid request format",
            })
          );
        }
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

/**
 * Handle HeroMiners WebSocket requests
 */
async function handleHeroMiners(options) {
  try {
    const force = options?.force || false;
    const btcPrice = await getBtcPrice();
    const result = await scrapeHeroMinersGlobal(btcPrice);
    
    return {
      herominers_global: {
        success: result.success,
        coinStats: result.coinStats || [],
        miners: result.miners || 0,
        fetchedAt: new Date().toISOString(),
        error: result.error || null,
      },
    };
  } catch (err) {
    console.error("[WS:hero] Error:", err.message);
    throw err;
  }
}

/**
 * Handle Mining-Dutch WebSocket requests
 */
async function handleMiningDutch(options) {
  try {
    const force = options?.force || false;
    const btcPrice = await getBtcPrice();
    const result = await scrapeMiningDutchGlobal(btcPrice, force);
    
    return {
      miningpooldutch: {
        success: result.success,
        coinStats: result.coinStats || [],
        fetchedAt: new Date().toISOString(),
        error: result.error || null,
      },
    };
  } catch (err) {
    console.error("[WS:dutch] Error:", err.message);
    throw err;
  }
}

/**
 * Handle "all" request
 */
async function handleAll(options) {
  try {
    const [hero, dutch] = await Promise.allSettled([
      handleHeroMiners(options),
      handleMiningDutch(options),
    ]);

    return {
      herominers: hero.status === "fulfilled" ? hero.value : null,
      miningDutch: dutch.status === "fulfilled" ? dutch.value : null,
    };
  } catch (err) {
    console.error("[WS:all] Error:", err.message);
    throw err;
  }
}

export const handlers = {
  handleHeroMiners,
  handleMiningDutch,
  handleAll,
};