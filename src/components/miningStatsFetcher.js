// miningStatsFetcher.js
// Uses REST API as primary transport, WebSocket as fallback.

const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT = 20000;
const BASE_DELAY = 1000;

export const herominer = "";
export const miningDutch = null;
export const nowmining = null;
export const avgprofitability = null;

/** Parses the HeroMiners home page HTML to extract global metadata */
export function parseHeroMinerHtml(html) {
  if (!html) return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const description = doc
    .querySelector('meta[name="description"]')
    ?.getAttribute("content");
  const title = doc.title;
  return { title, description, length: html.length };
}

const ACTION_ALIASES = {
  herominers: ["herominers"],
  miningpooldutch: ["miningDutch"],
  all: ["herominers", "miningDutch"],
};

let sharedSocket = null;
const pendingRequests = new Map();

function getWsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const token = localStorage.getItem("token");
  return `${protocol}//${host}/api/v2/mrr/fetch/ws${token ? `?token=${token}` : ""}`;
}

function generateRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function initSocket() {
  if (
    sharedSocket &&
    (sharedSocket.readyState === WebSocket.OPEN ||
      sharedSocket.readyState === WebSocket.CONNECTING)
  ) {
    return sharedSocket;
  }
  sharedSocket = new WebSocket(getWsUrl());
  sharedSocket.onmessage = (event) => {
    try {
      const response = JSON.parse(event.data);
      const { requestId, success, data, error, action } = response;
      const pending = pendingRequests.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timeoutId);
      pendingRequests.delete(requestId);
      if (success) {
        const aliases = ACTION_ALIASES[action] || [action];
        const actionData = aliases.map((key) => data?.[key]).find(Boolean);
        pending.resolve(actionData || data);
      } else {
        pending.reject(new Error(error || `Request "${action}" failed`));
      }
    } catch (err) {
      console.error("[MiningStats:WS] Parse error:", err);
    }
  };
  sharedSocket.onerror = (err) =>
    console.error("[MiningStats:WS] Socket error:", err);
  sharedSocket.onclose = () => {
    pendingRequests.forEach((req) => {
      clearTimeout(req.timeoutId);
      req.reject(new Error("WebSocket connection closed"));
    });
    pendingRequests.clear();
    sharedSocket = null;
  };
  return sharedSocket;
}

async function waitForSocket(socket) {
  if (socket.readyState === WebSocket.OPEN) return;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Socket connection timeout")),
      10000,
    );
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      (e) => {
        clearTimeout(timeout);
        reject(e);
      },
      { once: true },
    );
  });
}

/**
 * Fetches mining stats via REST first, WebSocket fallback.
 *
 * Supported types:
 *   "herominers_global" - fetch all HeroMiners algorithms
 *   "miningpooldutch"   - fetch Mining-Dutch avgprofitability
 *   "all"               - fetch both
 */
export async function fetchMiningStats(
  type,
  client,
  rigId = null,
  coin = null,
  customTimeout = REQUEST_TIMEOUT,
  force = false,
) {
  // Map legacy type names to REST endpoint path
  const restPathMap = {
    herominers_global: "herominers_global",
    herominers: "herominers_global",
    miningpooldutch: "miningpooldutch",
    miningDutch: "miningpooldutch",
    all: "all",
  };

  const path = restPathMap[type] || type;

  // Attempt REST API first
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      if (i > 0) {
        const jitter = Math.random() * 500;
        const delay = BASE_DELAY * Math.pow(2, i) + jitter;
        await new Promise((r) => setTimeout(r, delay));
      }
      const url = `/api/v2/mining-stats/${path}${force ? "?force=true" : ""}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(customTimeout) });
      if (!res.ok) {
        if (res.status === 404) break; // Route not found, fall through to WS
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data?.success || data?.herominers_global || data?.miningpooldutch) {
        return data;
      }
      throw new Error(data?.error || "REST API returned no data");
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error(
          `Failed to fetch ${type} after ${MAX_ATTEMPTS} attempts. Last error: Request timeout`,
        );
      }
      if (i === MAX_ATTEMPTS - 1) {
        // Fallback to WebSocket
        try {
          return await fetchMiningStatsViaWS(
            type, client, rigId, coin, customTimeout, force,
          );
        } catch (wsErr) {
          throw new Error(
            `Failed to fetch ${type} after ${MAX_ATTEMPTS} attempts. Last error: ${wsErr.message}`,
          );
        }
      }
    }
  }

  // Fallback to WebSocket
  try {
    return await fetchMiningStatsViaWS(
      type, client, rigId, coin, customTimeout, force,
    );
  } catch (wsErr) {
    throw new Error(
      `Failed to fetch ${type} after ${MAX_ATTEMPTS} attempts. Last error: ${wsErr.message}`,
    );
  }
}

async function fetchMiningStatsViaWS(
  type, client, rigId, coin, customTimeout, force
) {
  let targetClient = client;
  const globalActions = ["miningDutch", "herominers", "all"];
  if (targetClient === "VN" && globalActions.includes(type)) {
    targetClient = "VN";
  }

  const attempt = async () => {
    const socket = initSocket();
    await waitForSocket(socket);
    return new Promise((resolve, reject) => {
      const requestId = generateRequestId();
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(`[${type}] Timeout after ${customTimeout}ms`));
      }, customTimeout);
      pendingRequests.set(requestId, { resolve, reject, timeoutId });
      socket.send(
        JSON.stringify({
          requestId,
          action: type,
          client: targetClient,
          rigid: rigId,
          coin,
          force,
        }),
      );
    });
  };

  let lastError;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      if (i > 0)
        console.debug(`[MiningStats:WS] Retry ${i}/${MAX_ATTEMPTS} for ${type}`);
      return await attempt(i);
    } catch (err) {
      lastError = err;
      if (
        err.message.includes("not found") ||
        err.message.includes("Unauthorized")
      )
        throw err;
      const jitter = Math.random() * 500;
      const delay = BASE_DELAY * Math.pow(2, i) + jitter;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(
    `Failed to fetch ${type} after ${MAX_ATTEMPTS} attempts. Last error: ${lastError.message}`,
  );
}
