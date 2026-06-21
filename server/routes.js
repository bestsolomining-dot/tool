// routes.js - Updated with new module imports
import fs from "fs/promises";
import path from "path";
import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import {
  asyncHandler,
  maskSensitive,
  extractAlgorithmItems,
  extractRentalInfo,
  extractRigInfo,
} from "./utils.js";
import {
  mrrApiCall,
  mrrRequest,
  fetchAggregatedRentals,
  mrrConfigs,
  defaultMrrClient,
} from "./mrr.js";
import {
  resolveNhClient,
  getNiceHashApp,
  nhConfigs,
  isAggregate,
  normalizeAlgoForNiceHash,
  mapNiceHashToMRR,
  getCachedNhPools,
} from "./nh.js";
import {
  sendTelegramInternal,
  runRentalMonitor,
  getTelegramStatus,
  setTelegramStatus,
} from "./monitor.js";
import { db } from "./db.js";
import { saveMiningTrainingSnapshot } from "./miningTrainingDb.js";
import { getAlgorithmUnit } from "../src/core/mapping.js";

// Import from new split modules
import {
  handleMiningOpportunityScan,
  scanMiningOpportunities,
  getMiningStatus,
  sendMiningStatus,
  startMiningOpportunityScanner,
} from "./miningOpportunityNotifier.js";

import {
  scrapeHeroMinersGlobal,
  scrapeHeroMinersCoin,
} from "./miners/heroMiners.js";

import { scrapeMiningDutchGlobal } from "./miners/miningDutch.js";

import {
  fetchAndSaveCoinPrices,
  getCoinPricesFromDb,
  getCoinMetadata,
} from "./coinGecko/coinGeckoClient.js";

import { sendMineTelegram } from "./telegram/telegramClient.js";

const DATA_DIR = path.resolve(process.cwd(), "data");

/** In-memory cache for CoinGecko prices with TTL */
const coinGeckoCache = new Map();
const COINGECKO_CACHE_TTL = 60000; // 1 minute

/** Hardcoded fallback BTC rates for common coins when APIs are unavailable (approximate, last updated) */
const FALLBACK_BTC_RATES = {
  bitcoin: 1,
  ethereum: 0.052,
  "ethereum-classic": 0.00042,
  litecoin: 0.00078,
  dogecoin: 0.0000018,
  ravencoin: 0.00000025,
  monero: 0.0012,
  kaspa: 0.000034,
};

/** Fallback CoinGecko price (USD, BTC) when API is unavailable */
function buildFallbackPrices(ids) {
  const result = {};
  const coins = ids.split(",").map((s) => s.trim());
  for (const coin of coins) {
    const btcRate = FALLBACK_BTC_RATES[coin];
    if (btcRate !== undefined) {
      result[coin] = { usd: 0, btc: btcRate };
    } else {
      result[coin] = { usd: 0, btc: 0 };
    }
  }
  if (!result["bitcoin"]) result["bitcoin"] = { usd: 0, btc: 1 };
  return result;
}

/** Helper to save JSON data to SQLite database */
async function saveToDatabase(filename, items) {
  if (!items || !Array.isArray(items) || items.length === 0) return;
  const tableName = filename.replace(".csv", "").replace(/-/g, "_");
  const filePath = path.join(DATA_DIR, filename);
  const columns = Object.keys(items[0]);
  const quotedColumns = columns.map((c) => `"${c}"`);
  const placeholders = columns.map(() => "?").join(", ");
  const columnDefs = columns
    .map((c) => {
      if (c === "id") return '"id" TEXT PRIMARY KEY';
      return `"${c}" TEXT`;
    })
    .join(", ");

  try {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefs})`);
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO ${tableName} (${quotedColumns.join(", ")}) VALUES (${placeholders})`,
      );
      items.forEach((item) => {
        const values = columns.map((c) => {
          const v = item[c];
          return typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
        });
        stmt.run(...values);
      });
      stmt.finalize();
    });
  } catch (err) {
    console.error(`[db] Failed to save to ${tableName}:`, err.message);
  }
}

export function registerRoutes(app) {
  app.use("/api/v2", (req, res, next) => {
    if (
      req.path.startsWith("/mrr/") ||
      req.path === "/algos/mapping" ||
      req.path === "/extracted-pools"
    )
      return next();
    try {
      const { client, clientName } = resolveNhClient(req.query.client);
      if (client) {
        req.nhApp = getNiceHashApp(client);
        res.set("X-NH-Client", clientName);
      }
      next();
    } catch (err) {
      next();
    }
  });

  app.get(
    "/api/v2/time",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.public.getTime()),
    ),
  );
  app.get(
    "/api/v2/algorithms",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.public.getAlgorithms()),
    ),
  );
  app.get(
    "/api/v2/public/currency-algos",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.easyMining.getCurrencyAlgos()),
    ),
  );
  app.get(
    "/api/v2/mining/markets",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.public.getMarkets()),
    ),
  );
  app.get(
    "/api/v2/public/stats/24h",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.hashpower.getGlobalStats24h()),
    ),
  );

  app.get(
    "/api/v2/algos/mapping",
    asyncHandler(async (req, res) => {
      const { client: nhClient, clientName: nhClientName } = resolveNhClient(
        req.query.client,
      );
      const nhResponse = await getNiceHashApp(nhClient).public.getAlgorithms();
      const { data: mrrResponse, clientName } = await mrrApiCall({
        endpoint: "/info/algos",
        method: "GET",
        clientNameRaw: req.query.client,
      });

      const nhItems = extractAlgorithmItems(nhResponse, [
        "miningAlgorithms",
        "algorithms",
        "data",
        "list",
        "result",
        "items",
      ]);
      const mrrItems = extractAlgorithmItems(mrrResponse, [
        "algos",
        "algorithms",
        "data",
        "list",
        "result",
        "items",
      ]);

      const mrrSlugSet = new Set(
        mrrItems
          .map((item) =>
            String(item?.algo || item?.name || item?.slug || "").toLowerCase(),
          )
          .filter(Boolean),
      );

      const mapping = nhItems
        .map((item) => {
          const nicehash = String(
            item?.algorithm || item?.name || item?.algo || "",
          ).toUpperCase();
          const mrr = mapNiceHashToMRR(nicehash);
          return {
            nicehash,
            mrr,
            mrrExists: mrrSlugSet.has(String(mrr).toLowerCase()),
          };
        })
        .filter((item) => item.nicehash);

      res.set("X-MRR-Client", clientName);
      res.set("X-NH-Client", nhClientName);
      res.json({
        success: true,
        data: {
          mapping,
          totals: {
            nicehash: nhItems.length,
            mrr: mrrItems.length,
            mapped: mapping.length,
          },
        },
      });
    }),
  );

  app.get(
    "/api/v2/accounting/balances",
    asyncHandler(async (req, res) => {
      const clientParam = String(req.query.client || "BT").toUpperCase();
      if (isAggregate(clientParam)) {
        const nhAccounts = Object.keys(nhConfigs).filter(
          (k) =>
            nhConfigs[k].apiKey && nhConfigs[k].apiSecret && nhConfigs[k].orgId,
        );

        const clientMap = new Map();
        for (const acct of nhAccounts) {
          const { client, clientName } = resolveNhClient(acct);
          if (
            client &&
            !clientMap.has(clientName) &&
            (acct === "BT" || clientName !== "BT")
          ) {
            clientMap.set(clientName, client);
          }
        }

        const results = await Promise.all(
          Array.from(clientMap.entries()).map(async ([clientName, client]) => {
            try {
              const data =
                await getNiceHashApp(client).accounting.getBalances();
              return data ? { client: clientName, data } : null;
            } catch (e) {
              return null;
            }
          }),
        );

        const filteredResults = results.filter(Boolean);

        if (filteredResults.length === 0)
          return res.json({
            currencies: [],
            total: {
              available: "0",
              pending: "0",
              totalBalance: "0",
              currency: "BTC",
            },
          });

        const total = {
          available: 0,
          pending: 0,
          totalBalance: 0,
          currency: "BTC",
        };
        const allCurrencies = [];
        filteredResults.forEach((r) => {
          total.available += parseFloat(r.data.total?.available || 0);
          total.pending += parseFloat(r.data.total?.pending || 0);
          total.totalBalance += parseFloat(r.data.total?.totalBalance || 0);
          if (r.data.currencies)
            allCurrencies.push(
              ...r.data.currencies.map((c) => ({ ...c, nhClient: r.client })),
            );
        });

        return res.json({
          currencies: allCurrencies,
          total: {
            available: total.available.toFixed(8),
            pending: total.pending.toFixed(8),
            totalBalance: total.totalBalance.toFixed(8),
            currency: "BTC",
          },
        });
      }
      res.json(await req.nhApp.accounting.getBalances());
    }),
  );

  // =========================
  // MINING STATUS ENDPOINTS (using new split modules)
  // =========================

  app.get(
    "/api/v2/mining/status",
    asyncHandler(async (req, res) => {
      const result = await sendMiningStatus();
      res.json(result);
    }),
  );

  app.get(
    "/api/v2/mining/status/json",
    asyncHandler(async (req, res) => {
      const result = await getMiningStatus();
      res.json(result);
    }),
  );

  // =========================
  // MINING OPPORTUNITY SCAN
  // =========================

  app.get(
    "/api/v2/mining/opportunities/scan",
    asyncHandler(handleMiningOpportunityScan),
  );

  // =========================
  // COINGECKO PRICE ENDPOINTS (using new modules)
  // =========================

  app.get(
    "/api/v2/prices/coingecko",
    asyncHandler(async (req, res) => {
      const defaultIds =
        "bitcoin,ethereum,ethereum-classic,litecoin,ravencoin,monero,kaspa,iron-fish,zephyr-protocol,clore-ai,dynex,conflux,ergo";
      const ids = req.query.ids || defaultIds;
      const cacheKey = `coingecko:${ids}`;

      const cached = coinGeckoCache.get(cacheKey);
      if (cached && Date.now() < cached.expires) {
        return res.json({ success: true, data: cached.data, cached: true });
      }

      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,btc&include_24hr_change=true`;

      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg =
            errorData.status?.error_message ||
            `CoinGecko API failure (HTTP ${response.status})`;

          const fallback = buildFallbackPrices(ids);
          coinGeckoCache.set(cacheKey, {
            data: fallback,
            expires: Date.now() + COINGECKO_CACHE_TTL,
          });
          console.warn(`[CoinGecko] ${errorMsg} - using fallback rates`);
          return res.json({ success: true, data: fallback, fallback: true });
        }

        const data = await response.json();

        const coins = ids.split(",").map((s) => s.trim());
        for (const coin of coins) {
          if (!data[coin]) {
            const fallbackRate = FALLBACK_BTC_RATES[coin];
            if (fallbackRate !== undefined) {
              data[coin] = { usd: 0, btc: fallbackRate };
            }
          }
          if (coin === "bitcoin" && data[coin]) {
            data[coin].btc = 1;
          }
        }

        coinGeckoCache.set(cacheKey, {
          data,
          expires: Date.now() + COINGECKO_CACHE_TTL,
        });
        res.json({ success: true, data });
      } catch (err) {
        const fallback = buildFallbackPrices(ids);
        coinGeckoCache.set(cacheKey, {
          data: fallback,
          expires: Date.now() + COINGECKO_CACHE_TTL,
        });
        console.warn(
          `[CoinGecko] Network error: ${err.message} - using fallback rates`,
        );
        res.json({ success: true, data: fallback, fallback: true });
      }
    }),
  );

  /**
   * GET /api/v2/prices/coingecko/fetch
   * Fetch and save CoinGecko prices to database
   */
  app.get(
    "/api/v2/prices/coingecko/fetch",
    asyncHandler(async (req, res) => {
      const force = req.query?.force === "true";
      const result = await fetchAndSaveCoinPrices(force);
      res.json(result);
    }),
  );

  /**
   * GET /api/v2/prices/coingecko/latest
   * Get latest coin prices from database
   */
  app.get(
    "/api/v2/prices/coingecko/latest",
    asyncHandler(async (req, res) => {
      const ids = req.query.ids ? req.query.ids.split(",") : null;
      const limit = parseInt(req.query.limit) || 100;
      const prices = await getCoinPricesFromDb(ids, limit);
      res.json({ success: true, data: prices });
    }),
  );

  /**
   * GET /api/v2/prices/coingecko/metadata
   * Get coin metadata from database
   */
  app.get(
    "/api/v2/prices/coingecko/metadata",
    asyncHandler(async (req, res) => {
      const metadata = await getCoinMetadata();
      res.json({ success: true, data: metadata });
    }),
  );

  // =========================
  // MINING STATS REST API
  // =========================

  /**
   * GET /api/v2/mining-stats/herominers_global
   * Fetches all HeroMiners pool algorithms globally.
   */
  app.get(
    "/api/v2/mining-stats/herominers_global",
    asyncHandler(async (req, res) => {
      const force = req.query.force === "true";
      // Get BTC price first
      let btcPrice = 60000;
      try {
        const priceRes = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
          { signal: AbortSignal.timeout(3000) },
        );
        const priceData = await priceRes.json();
        btcPrice = priceData?.bitcoin?.usd || 60000;
      } catch {
        btcPrice = 60000;
      }
      const result = await scrapeHeroMinersGlobal(btcPrice);
      res.json({
        success: result.success,
        coinStats: result.coinStats || [],
        miners: result.miners || 0,
        fetchedAt: new Date().toISOString(),
        error: result.error || null,
      });
    }),
  );

  /**
   * GET /api/v2/mining-stats/miningpooldutch
   * Fetches Mining-Dutch avgprofitability from their public API.
   */
  app.get(
    "/api/v2/mining-stats/miningpooldutch",
    asyncHandler(async (req, res) => {
      const force = req.query.force === "true";
      let btcPrice = 60000;
      try {
        const priceRes = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
          { signal: AbortSignal.timeout(3000) },
        );
        const priceData = await priceRes.json();
        btcPrice = priceData?.bitcoin?.usd || 60000;
      } catch {
        btcPrice = 60000;
      }
      const result = await scrapeMiningDutchGlobal(btcPrice, force);
      res.json(result);
    }),
  );

  /**
   * GET /api/v2/mining-stats/all
   * Fetches both HeroMiners and Mining-Dutch in one call.
   */
  app.get(
    "/api/v2/mining-stats/all",
    asyncHandler(async (req, res) => {
      const force = req.query.force === "true";
      let btcPrice = 60000;
      try {
        const priceRes = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
          { signal: AbortSignal.timeout(3000) },
        );
        const priceData = await priceRes.json();
        btcPrice = priceData?.bitcoin?.usd || 60000;
      } catch {
        btcPrice = 60000;
      }

      const [heroResult, dutchResult] = await Promise.allSettled([
        scrapeHeroMinersGlobal(btcPrice),
        scrapeMiningDutchGlobal(btcPrice, force),
      ]);

      res.json({
        herominers_global:
          heroResult.status === "fulfilled" ? heroResult.value : null,
        miningpooldutch:
          dutchResult.status === "fulfilled" ? dutchResult.value : null,
      });
    }),
  );

  // =========================
  // REMAINING ROUTES (unchanged from original)
  // =========================

  app.get(
    "/api/v2/accounting/balance/:currency",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.accounting.getBalance(req.params.currency)),
    ),
  );
  app.post(
    "/api/v2/accounting/withdrawal",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.accounting.createWithdrawal(req.body)),
    ),
  );
  app.get(
    "/api/v2/mining/address",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.mining.getMiningAddress()),
    ),
  );

  app.get(
    "/api/v2/mining/rigs2",
    asyncHandler(async (req, res) => {
      const clientParam = String(req.query.client || "BT").toUpperCase();
      if (isAggregate(clientParam)) {
        const nhAccounts = Object.keys(nhConfigs).filter(
          (k) =>
            nhConfigs[k].apiKey &&
            nhConfigs[k].apiSecret &&
            nhConfigs[k].orgId &&
            !isAggregate(k),
        );

        const clientMap = new Map();
        for (const acct of nhAccounts) {
          const { client, clientName } = resolveNhClient(acct);
          if (
            client &&
            !clientMap.has(clientName) &&
            (acct === "BT" || clientName !== "BT")
          ) {
            clientMap.set(clientName, client);
          }
        }

        const results = await Promise.all(
          Array.from(clientMap.entries()).map(async ([clientName, client]) => {
            try {
              const data = await getNiceHashApp(client).mining.getRigs();
              return (data?.miningRigs || []).map((r) => ({
                ...r,
                nhClient: clientName,
              }));
            } catch (e) {
              return [];
            }
          }),
        );

        return res.json({ miningRigs: results.flat() });
      }
      res.json(await req.nhApp.mining.getRigs());
    }),
  );

  app.get(
    "/api/v2/mining/rig/:rigId",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.mining.getRigDetails(req.params.rigId)),
    ),
  );
  app.post(
    "/api/v2/mining/rigs/status",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.mining.setRigStatus(req.body)),
    ),
  );
  app.get(
    "/api/v2/mining/payouts",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.mining.getPayouts()),
    ),
  );
  app.get(
    "/api/v2/mining/history",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.mining.getRigsStatsHistory(req.query)),
    ),
  );
  app.get(
    "/api/v2/mining/algo-stats",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.mining.getAlgoStats()),
    ),
  );

  // ... (all other routes remain the same - hashpower, mrr, pools, etc.)

  // =========================
  // START MINING SCANNER ON INIT
  // =========================
  // Uncomment this to start the scanner automatically
  // startMiningOpportunityScanner();
}

// Export the start function for external use
export { startMiningOpportunityScanner };