// routes.js - Complete and fixed
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

// ✅ FIX: Only import what's actually exported
import { scrapeHeroMinersGlobal } from "./miners/heroMiners.js";
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

/** Hardcoded fallback BTC rates for common coins when APIs are unavailable */
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
  // =========================
  // MIDDLEWARE
  // =========================
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

  // =========================
  // NICEHASH ROUTES
  // =========================

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

  // =========================
  // HASH POWER ROUTES
  // =========================

  app.get(
    "/api/v2/hashpower/myOrders",
    asyncHandler(async (req, res) => {
      const clientParam = String(req.query.client || "BT").toUpperCase();
      const query = { ...req.query };
      if (!query.ts) query.ts = Date.now().toString();

      let data;
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
              const result =
                await getNiceHashApp(client).hashpower.getMyOrders(query);
              return (result?.list || []).map((o) => ({
                ...o,
                nhClient: clientName,
              }));
            } catch (e) {
              return [];
            }
          }),
        );

        data = { list: results.flat() };
      } else {
        data = await req.nhApp.hashpower.getMyOrders(query);
      }

      const rawList =
        data?.list || data?.myOrders || (Array.isArray(data) ? data : []);

      const processedList = rawList.map((o) => ({
        id: o.id || "",
        acceptedCurrentSpeed: o.acceptedCurrentSpeed || 0,
        algorithmSpeed: o.acceptedCurrentSpeed || 0,
        niceAdvertisedHashrate: o.limit || 0,
        poolName: o.pool?.name || "",
        poolHost: o.pool?.stratumHostname || "",
        poolPort: o.pool?.port || "",
        algorithm:
          typeof o.algorithm === "object" ? o.algorithm.algorithm : o.algorithm,
        market: typeof o.market === "object" ? o.market.id : o.market,
        price: o.price,
        limit: o.limit,
        payedAmount: o.payedAmount || 0,
        availableAmount: o.availableAmount || 0,
        rigsCount: o.rigsCount || 0,
        poolUser: o.pool?.username || "",
        poolPass: o.pool?.password || "",
        status: typeof o.status === "object" ? o.status.code : o.status,
        isDead:
          (o.status?.code || o.status) === "ACTIVE" &&
          parseFloat(o.acceptedCurrentSpeed || 0) === 0 &&
          parseInt(o.rigsCount || 0) === 0,
        pool: o.pool,
        nhClient: o.nhClient,
        ts: new Date().toISOString(),
      }));

      await saveToDatabase(
        "nh_order.csv",
        processedList.filter((o) => o.status === "ACTIVE"),
      );

      res.json(
        typeof data === "object" && !Array.isArray(data)
          ? { ...data, list: processedList }
          : processedList,
      );
    }),
  );

  app.get(
    "/api/v2/hashpower/order/price",
    asyncHandler(async (req, res) => {
      const clientParam = String(req.query.client || "BT").toUpperCase();
      const query = { ...req.query };
      if (!query.ts) query.ts = Date.now().toString();

      const algorithm = normalizeAlgoForNiceHash(query.algorithm);
      const matchActiveOrder = async (clientName, client) => {
        try {
          const data = await getNiceHashApp(client).hashpower.getMyOrders({
            op: "LE",
            limit: 100,
          });
          const rawList =
            data?.list || data?.myOrders || (Array.isArray(data) ? data : []);
          const activeOrders = rawList.filter(
            (o) =>
              String(o?.status?.code || o?.status || "").toUpperCase() ===
              "ACTIVE",
          );
          const found = activeOrders.find(
            (o) =>
              normalizeAlgoForNiceHash(o?.algorithm || o?.algo || o?.type) ===
              algorithm,
          );
          if (!found) return null;
          const price = Number.parseFloat(
            found.price ?? found.marketPrice ?? found.fixedPrice ?? 0,
          );
          if (!Number.isFinite(price) || price <= 0) return null;
          return {
            fixedPrice: price.toFixed(8),
            speedUnit: getAlgorithmUnit(algorithm),
            price,
            marketPrice: price,
            marketUnit: getAlgorithmUnit(algorithm),
            source: "active-order",
            nhClient: clientName,
            orderId: found.id,
          };
        } catch {
          return null;
        }
      };

      if (isAggregate(clientParam)) {
        const nhAccounts = Object.keys(nhConfigs).filter(
          (k) =>
            nhConfigs[k].apiKey &&
            nhConfigs[k].apiSecret &&
            nhConfigs[k].orgId &&
            !isAggregate(k),
        );
        for (const acct of nhAccounts) {
          const { client, clientName } = resolveNhClient(acct);
          if (!client || (acct !== "BT" && clientName === "BT")) continue;
          try {
            const orderPrice = await matchActiveOrder(clientName, client);
            if (orderPrice) {
              res.set("X-NH-Client", clientName);
              return res.json(orderPrice);
            }
          } catch (e) {}
        }
      }

      if (clientParam !== "ALL" && clientParam !== "VN") {
        const { client, clientName } = resolveNhClient(clientParam);
        if (client) {
          const orderPrice = await matchActiveOrder(clientName, client);
          if (orderPrice) {
            res.set("X-NH-Client", clientName);
            return res.json(orderPrice);
          }
        }
      }

      return res.json({
        success: false,
        error: `No active NiceHash order price found for ${algorithm || "unknown"}.`,
        algorithm: query.algorithm,
        market: query.market || "USA",
        source: "active-order",
      });
    }),
  );

  app.get(
    "/api/v2/hashpower/order/:orderId",
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
        const processedClients = new Set();
        for (const acct of nhAccounts) {
          const { client, clientName } = resolveNhClient(acct);
          if (
            !client ||
            (acct !== "BT" && clientName === "BT") ||
            processedClients.has(clientName)
          )
            continue;
          processedClients.add(clientName);
          try {
            const data = await getNiceHashApp(client).hashpower.getOrderDetail(
              req.params.orderId,
            );
            if (data && !data.error) {
              res.set("X-NH-Client", clientName);
              return res.json(data);
            }
          } catch (e) {}
        }
      }
      res.json(await req.nhApp.hashpower.getOrderDetail(req.params.orderId));
    }),
  );

  app.post(
    "/api/v2/hashpower/order",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.hashpower.createOrder(req.body)),
    ),
  );

  app.get(
    "/api/v2/hashpower/order-book",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.hashpower.getOrderBook(req.query)),
    ),
  );

  app.delete(
    "/api/v2/hashpower/order/:orderId",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.hashpower.cancelOrder(req.params.orderId)),
    ),
  );

  app.post(
    "/api/v2/hashpower/order/:orderId/refill",
    asyncHandler(async (req, res) =>
      res.json(
        await req.nhApp.hashpower.refillOrder(req.params.orderId, req.body),
      ),
    ),
  );

  app.post(
    "/api/v2/hashpower/order/:orderId/update",
    asyncHandler(async (req, res) =>
      res.json(
        await req.nhApp.hashpower.updatePriceLimit(
          req.params.orderId,
          req.body,
        ),
      ),
    ),
  );

  // =========================
  // POOL ROUTES
  // =========================

  app.get(
    "/api/v2/pools",
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
              const data = await getNiceHashApp(client).pools.getPools();
              const pools = (data?.list || []).map((p) => ({
                ...p,
                nhClient: clientName,
              }));
              if (pools.length > 0) {
                db.serialize(() => {
                  db.run(
                    `CREATE TABLE IF NOT EXISTS nh_pools (id TEXT, name TEXT, algorithm TEXT, stratumHostname TEXT, port TEXT, username TEXT, password TEXT, nhClient TEXT, last_updated DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, nhClient))`,
                  );
                  const stmt = db.prepare(
                    `INSERT OR REPLACE INTO nh_pools (id, name, algorithm, stratumHostname, port, username, password, nhClient, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                  );
                  pools.forEach((p) =>
                    stmt.run(
                      p.id,
                      p.name,
                      p.algorithm,
                      p.stratumHostname,
                      p.port,
                      p.username,
                      p.password,
                      clientName,
                    ),
                  );
                  stmt.finalize();
                });
              }
              return pools;
            } catch (e) {
              return [];
            }
          }),
        );

        return res.json({
          list: results.flat(),
          totalCount: results.flat().length,
        });
      }
      const data = await req.nhApp.pools.getPools();
      const pools = data?.list || [];
      const clientName = res.get("X-NH-Client") || "BT";
      if (pools.length > 0) {
        db.serialize(() => {
          db.run(
            `CREATE TABLE IF NOT EXISTS nh_pools (id TEXT, name TEXT, algorithm TEXT, stratumHostname TEXT, port TEXT, username TEXT, password TEXT, nhClient TEXT, last_updated DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, nhClient))`,
          );
          const stmt = db.prepare(
            `INSERT OR REPLACE INTO nh_pools (id, name, algorithm, stratumHostname, port, username, password, nhClient, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          );
          pools.forEach((p) =>
            stmt.run(
              p.id,
              p.name,
              p.algorithm,
              p.stratumHostname,
              p.port,
              p.username,
              p.password,
              clientName,
            ),
          );
          stmt.finalize();
        });
      }
      res.json(data);
    }),
  );

  app.get(
    "/api/v2/pool/:poolId",
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
        const processedClients = new Set();
        for (const acct of nhAccounts) {
          const { client, clientName } = resolveNhClient(acct);
          if (
            !client ||
            (acct !== "BT" && clientName === "BT") ||
            processedClients.has(clientName)
          )
            continue;
          processedClients.add(clientName);
          try {
            const data = await getNiceHashApp(client).pools.getPoolDetails(
              req.params.poolId,
            );
            if (data && !data.error) {
              res.set("X-NH-Client", clientName);
              return res.json(data);
            }
          } catch (e) {}
        }
      }
      res.json(await req.nhApp.pools.getPoolDetails(req.params.poolId));
    }),
  );

  app.post(
    "/api/v2/pool",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.pools.createPool(req.body)),
    ),
  );

  app.post(
    "/api/v2/pools/verify",
    asyncHandler(async (req, res) =>
      res.json(await req.nhApp.pools.verifyPool(req.body)),
    ),
  );

  // =========================
  // MRR ROUTES
  // =========================

  app.get(
    "/api/v2/mrr/rentals",
    asyncHandler(async (req, res) => {
      const { client: clientQuery, ...forwardQuery } = req.query || {};
      const result = await fetchAggregatedRentals(
        forwardQuery,
        String(clientQuery || defaultMrrClient).toUpperCase(),
      );

      await saveToDatabase("mrr_rentals.csv", result.data?.data?.rentals || []);

      res.set("X-MRR-Client", result.clientName);
      res.status(result.statusCode).json(result.data);
    }),
  );

  app.get(
    "/api/v2/mrr/rigs",
    asyncHandler(async (req, res) => {
      const clientParam = String(
        req.query.client || defaultMrrClient,
      ).toUpperCase();
      const targetEndpoint = req.query.endpoint || "/rig/mine";

      if (isAggregate(clientParam)) {
        const allClientNames = Object.keys(mrrConfigs).filter(
          (c) =>
            mrrConfigs[c].apiKey && mrrConfigs[c].apiSecret && !isAggregate(c),
        );
        const allRigs = [];

        const results = await Promise.all(
          allClientNames.map(async (clientName) => {
            try {
              const { data, statusCode } = await mrrApiCall({
                endpoint: targetEndpoint,
                clientNameRaw: clientName,
              });
              const rigs = Array.isArray(data?.data)
                ? data.data
                : Array.isArray(data?.data?.rigs)
                  ? data.data.rigs
                  : [];

              if (
                targetEndpoint === "/rig/mine" &&
                statusCode === 200 &&
                data.success &&
                rigs.length > 0
              ) {
                const rigIds = rigs.map((r) => r.id).join(";");
                const { data: poolsData } = await mrrApiCall({
                  endpoint: `/rig/${rigIds}/pool`,
                  clientNameRaw: clientName,
                });
                if (poolsData && poolsData.success) {
                  const nhPools = await getCachedNhPools(clientName);

                  const poolItems = Array.isArray(poolsData.data)
                    ? poolsData.data
                    : poolsData.data?.result || [];
                  const poolMap = new Map(
                    poolItems
                      .map((item) => {
                        const id = String(
                          item.rigId ||
                            item.rigid ||
                            item.id ||
                            item.rentalid ||
                            "",
                        );

                        if (
                          Array.isArray(item.pools) &&
                          item.pools.length > 0
                        ) {
                          db.serialize(() => {
                            db.run(
                              `CREATE TABLE IF NOT EXISTS mrr_pools (id TEXT, name TEXT, algo TEXT, host TEXT, port TEXT, user TEXT, mrrClient TEXT, last_updated DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, mrrClient))`,
                            );
                            const stmt = db.prepare(
                              `INSERT OR REPLACE INTO mrr_pools (id, name, algo, host, port, user, mrrClient, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                            );
                            item.pools.forEach((p) => {
                              const algo =
                                p.algo ||
                                p.algorithm ||
                                p.type ||
                                item.algo ||
                                item.algorithm ||
                                "";
                              stmt.run(
                                id,
                                p.name || `RigPool-${id}`,
                                algo,
                                p.host || p.stratumHost,
                                p.port || p.stratumPort,
                                p.user || p.username,
                                clientName,
                              );
                            });
                            stmt.finalize();
                          });
                        }

                        if (Array.isArray(item.pools)) {
                          item.pools.forEach((p) => {
                            const mrrUser = String(p.user || p.username || "")
                              .trim()
                              .toLowerCase();
                            const nhMatch = nhPools.find(
                              (nhp) =>
                                String(nhp.username || "")
                                  .trim()
                                  .toLowerCase() === mrrUser,
                            );
                            if (nhMatch) p.nhPoolName = nhMatch.name;
                          });
                        }
                        return [id, item.pools];
                      })
                      .filter((i) => i[0]),
                  );

                  rigs.forEach((rig) => {
                    const pools = poolMap.get(String(rig.id));
                    if (pools && pools.length > 0) {
                      const p0 =
                        pools.find(
                          (p) => p.priority === 0 || p.priority === "0",
                        ) || pools[0];
                      rig.host = p0.host || p0.stratumHost;
                      rig.port = p0.port || p0.stratumPort;
                      rig.user = p0.user || p0.username;
                    }
                  });
                }
              }

              if (statusCode === 200 && data?.success && rigs.length > 0) {
                return {
                  rigs: rigs.map((rig) => ({
                    ...rig,
                    mrrClient: clientName,
                    nicehashAlgo: normalizeAlgoForNiceHash(
                      rig.algo || rig.type || rig.miningAlgorithm,
                    ),
                  })),
                };
              }
              return {
                error: {
                  client: clientName,
                  message:
                    data?.message ||
                    `Failed to fetch rigs (status: ${statusCode})`,
                },
              };
            } catch (err) {
              return { error: { client: clientName, message: err.message } };
            }
          }),
        );

        const errors = [];
        results.forEach((res) => {
          if (res.rigs) allRigs.push(...res.rigs);
          if (res.error) errors.push(res.error);
        });

        await saveToDatabase("mrr_rigs.csv", allRigs);

        res.json({
          success: true,
          rigs: allRigs,
          errors: errors.length > 0 ? errors : undefined,
        });
      } else {
        if (targetEndpoint === "/rig/mine") {
          const { data, statusCode, clientName } = await mrrApiCall({
            endpoint: "/rig/mine",
            clientNameRaw: clientParam,
          });
          if (statusCode === 200 && data.success) {
            const rigs = Array.isArray(data.data)
              ? data.data
              : data.data?.rigs || [];
            rigs.forEach((rig) => {
              rig.nicehashAlgo = normalizeAlgoForNiceHash(
                rig.algo || rig.type || rig.miningAlgorithm,
              );
            });
            if (rigs.length > 0) {
              const rigIds = rigs.map((r) => r.id).join(";");
              const { data: poolsData } = await mrrApiCall({
                endpoint: `/rig/${rigIds}/pool`,
                clientNameRaw: clientParam,
              });
              if (poolsData && poolsData.success) {
                const poolItems = Array.isArray(poolsData.data)
                  ? poolsData.data
                  : poolsData.data?.result || [];
                const poolMap = new Map(
                  poolItems.map((item) => [
                    String(item.rigId || item.rigid || item.id),
                    item.pools,
                  ]),
                );
                rigs.forEach((rig) => {
                  const pools = poolMap.get(String(rig.id));
                  if (pools && pools.length > 0) {
                    const p0 =
                      pools.find(
                        (p) => p.priority === 0 || p.priority === "0",
                      ) || pools[0];
                    rig.host = p0.host || p0.stratumHost;
                    rig.port = p0.port || p0.stratumPort;
                    rig.user = p0.user || p0.username;
                  }
                });
              }
            }
          }
          res.set("X-MRR-Client", clientName);
          return res.status(statusCode).json(data);
        }
        await mrrRequest(targetEndpoint, req, res);
      }
    }),
  );

  // =========================
  // MINING STATUS ENDPOINTS
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
  // COINGECKO PRICE ENDPOINTS
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

  app.get(
    "/api/v2/prices/coingecko/fetch",
    asyncHandler(async (req, res) => {
      const force = req.query?.force === "true";
      const result = await fetchAndSaveCoinPrices(force);
      res.json(result);
    }),
  );

  app.get(
    "/api/v2/prices/coingecko/latest",
    asyncHandler(async (req, res) => {
      const ids = req.query.ids ? req.query.ids.split(",") : null;
      const limit = parseInt(req.query.limit) || 100;
      const prices = await getCoinPricesFromDb(ids, limit);
      res.json({ success: true, data: prices });
    }),
  );

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

  app.get(
    "/api/v2/mining-stats/herominers_global",
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
  // ADDITIONAL ROUTES
  // =========================

  app.post(
    "/api/v2/notify/telegram",
    asyncHandler(async (req, res) => {
      const { message } = req.body;
      try {
        const data = await sendTelegramInternal(message);
        res.json(data);
      } catch (err) {
        console.warn(`[telegram] ${err.message}`);
        res.status(400).json({ success: false, error: err.message });
      }
    }),
  );

  app.get(
    "/api/v2/notify/telegram/status",
    asyncHandler(async (req, res) => {
      res.json(await getTelegramStatus());
    }),
  );

  app.post(
    "/api/v2/notify/telegram/status",
    asyncHandler(async (req, res) => {
      const { enabled } = req.body;
      res.json(await setTelegramStatus(enabled));
    }),
  );

  app.get(
    "/api/v2/notify/telegram/health",
    asyncHandler(async (req, res) => {
      const hasToken = !!process.env.TELEGRAM_BOT_TOKEN;
      const hasChatId = !!process.env.TELEGRAM_CHAT_ID;
      res.json({
        success: hasToken && hasChatId,
        configured: hasToken && hasChatId,
        tokenPresent: hasToken,
        chatIdPresent: hasChatId,
      });
    }),
  );

  app.post(
    "/api/v2/mining/training-snapshot",
    asyncHandler(async (req, res) => {
      try {
        const result = await saveMiningTrainingSnapshot(req.body || {});
        res.json({ success: true, data: result });
      } catch (err) {
        console.error(
          "[mining-training] Failed to save snapshot:",
          err.message,
        );
        res.status(500).json({ success: false, error: err.message });
      }
    }),
  );

  app.get(
    "/api/v2/extracted-pools",
    asyncHandler(async (req, res) => {
      const filePath = path.resolve(process.cwd(), "extracted_pools.json");
      try {
        await fs.access(filePath);
        const content = await fs.readFile(filePath, "utf-8");
        const data = JSON.parse(content || "[]");
        res.json(Array.isArray(data) ? data : []);
      } catch (err) {
        if (err.code === "ENOENT") {
          return res.json([]);
        }
        res.status(500).json({
          success: false,
          error: `Error reading extracted pools: ${err.message}`,
        });
      }
    }),
  );

  console.log("[Routes] All routes registered successfully");
}

// Export the start function for external use
export { startMiningOpportunityScanner };