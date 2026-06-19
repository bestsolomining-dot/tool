// miningStatsFetcher.js

export const herominer = "";
export const miningDutch = null;
export const nowmining = null;
export const avgprofitability = null;

/** Parses the HeroMiners home page HTML to extract global metadata */
export function parseHeroMinerHtml(html) {
  if (!html) return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Extract data from meta tags or scripts
  const description = doc
    .querySelector('meta[name="description"]')
    ?.getAttribute("content");
  const title = doc.title;

  return { title, description, length: html.length };
}

const ACTION_ALIASES = {
  herominers_global: ["herominers_global", "herominers"],
  herominers: ["herominers"],
  miningpooldutch: ["miningpooldutch", "miningDutch"],
  all: ["all"],
};

const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT = 20000;
const BASE_DELAY = 1000;

let sharedSocket = null;

const pendingRequests = new Map(); // requestId -> { resolve, reject, timeoutId }

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
    // Reject tất cả request đang đợi khi socket đóng bất ngờ
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

export async function fetchMiningStats(
  type,
  client,
  rigId = null,
  coin = null,
  customTimeout = REQUEST_TIMEOUT,
  force = false,
) {
  let targetClient = client;
  const globalActions = [
    "miningpooldutch",
    "herominers",
    "herominers_global",
    "all",
  ];

  if (targetClient === "VN" && globalActions.includes(type)) {
    targetClient = "BT";
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
        console.debug(`[MiningStats] Retry ${i}/${MAX_ATTEMPTS} for ${type}`);
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
