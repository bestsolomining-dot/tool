// miningStatsFetcher.js
// Uses REST API as primary transport, WebSocket as fallback.

const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT = 20000;
const BASE_DELAY = 1000;

// Request deduplication cache
const pendingRequestsMap = new Map();
const requestCache = new Map();
const CACHE_TTL = 5000; // 5 seconds cache for identical requests

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
const wsPendingRequests = new Map();

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
      const pending = wsPendingRequests.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timeoutId);
      wsPendingRequests.delete(requestId);
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
    wsPendingRequests.forEach((req) => {
      clearTimeout(req.timeoutId);
      req.reject(new Error("WebSocket connection closed"));
    });
    wsPendingRequests.clear();
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
 * Generate a cache key for a request
 */
function getRequestKey(type, client, rigId, coin, force) {
  return `${type}:${client}:${rigId || ''}:${coin || ''}:${force ? 'force' : 'normal'}`;
}

/**
 * Normalize mining stats response to ensure consistent format
 */
function normalizeMiningStatsResponse(data, type) {
  // If data is null or undefined, return empty structure
  if (!data) {
    return {
      success: true,
      coinStats: [],
      miners: 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  // If data already has coinStats array, ensure it's an array
  if (data.coinStats && Array.isArray(data.coinStats)) {
    return {
      ...data,
      coinStats: data.coinStats,
      miners: data.miners || 0,
      success: data.success !== false,
    };
  }

  // Check for herominers_global structure
  if (data.herominers_global) {
    const heroData = data.herominers_global;
    return {
      ...data,
      coinStats: Array.isArray(heroData.coinStats) ? heroData.coinStats : [],
      miners: heroData.miners || 0,
      fetchedAt: heroData.fetchedAt || data.fetchedAt || new Date().toISOString(),
      success: data.success !== false,
    };
  }

  // Check for miningpooldutch structure
  if (data.miningpooldutch) {
    const dutchData = data.miningpooldutch;
    return {
      ...data,
      coinStats: Array.isArray(dutchData.coinStats) ? dutchData.coinStats : [],
      miners: dutchData.miners || 0,
      fetchedAt: dutchData.fetchedAt || data.fetchedAt || new Date().toISOString(),
      success: data.success !== false,
    };
  }

  // If data is an array, assume it's coinStats
  if (Array.isArray(data)) {
    return {
      success: true,
      coinStats: data,
      miners: data.reduce((sum, row) => sum + (row.miners || 0), 0),
      fetchedAt: new Date().toISOString(),
    };
  }

  // If data has a data property with coinStats
  if (data.data && typeof data.data === 'object') {
    const innerData = data.data;
    if (innerData.coinStats && Array.isArray(innerData.coinStats)) {
      return {
        ...data,
        coinStats: innerData.coinStats,
        miners: innerData.miners || 0,
        success: data.success !== false,
      };
    }
  }

  // If data has result property (common in some APIs)
  if (data.result && Array.isArray(data.result)) {
    return {
      ...data,
      coinStats: data.result,
      miners: data.result.reduce((sum, row) => sum + (row.miners || 0), 0),
      success: data.success !== false,
    };
  }

  // If data has list property
  if (data.list && Array.isArray(data.list)) {
    return {
      ...data,
      coinStats: data.list,
      miners: data.list.reduce((sum, row) => sum + (row.miners || 0), 0),
      success: data.success !== false,
    };
  }

  // If no coinStats found, return empty array
  return {
    ...data,
    coinStats: [],
    miners: 0,
    success: data.success !== false,
  };
}

/**
 * Fetches mining stats with deduplication
 */
export async function fetchMiningStats(
  type,
  client,
  rigId = null,
  coin = null,
  customTimeout = REQUEST_TIMEOUT,
  force = false,
) {
  const requestKey = getRequestKey(type, client, rigId, coin, force);
  
  // If force is true, bypass cache but still deduplicate
  if (!force) {
    // Check cache for recent response
    const cached = requestCache.get(requestKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.debug(`[MiningStats] Using cached response for ${type}`);
      return cached.data;
    }
  }
  
  // Check if there's already a pending request for this key
  if (pendingRequestsMap.has(requestKey)) {
    console.debug(`[MiningStats] Deduplicating request for ${type}`);
    return pendingRequestsMap.get(requestKey);
  }
  
  // Create the promise
  const promise = fetchMiningStatsInternal(type, client, rigId, coin, customTimeout, force)
    .then((result) => {
      // Cache the result
      requestCache.set(requestKey, {
        data: result,
        timestamp: Date.now(),
      });
      return result;
    })
    .finally(() => {
      // Clean up pending request
      pendingRequestsMap.delete(requestKey);
    });
  
  // Store the pending promise
  pendingRequestsMap.set(requestKey, promise);
  
  return promise;
}

/**
 * Internal fetch function (actual implementation)
 */
async function fetchMiningStatsInternal(
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
        if (res.status === 404) break;
        throw new Error(`HTTP ${res.status}`);
      }
      
      const data = await res.json();
      
      // Normalize the response
      const normalized = normalizeMiningStatsResponse(data, type);
      
      if (normalized.success !== false && (normalized.coinStats.length > 0 || normalized.miners > 0)) {
        return normalized;
      }
      
      if (normalized.success !== false) {
        return normalized;
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
          const wsData = await fetchMiningStatsViaWS(
            type, client, rigId, coin, customTimeout, force,
          );
          return normalizeMiningStatsResponse(wsData, type);
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
    const wsData = await fetchMiningStatsViaWS(
      type, client, rigId, coin, customTimeout, force,
    );
    return normalizeMiningStatsResponse(wsData, type);
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
        wsPendingRequests.delete(requestId);
        reject(new Error(`[${type}] Timeout after ${customTimeout}ms`));
      }, customTimeout);
      wsPendingRequests.set(requestId, { resolve, reject, timeoutId });
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