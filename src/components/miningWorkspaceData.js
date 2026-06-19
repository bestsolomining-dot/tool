import {
  getAlgoDisplayName,
  getAlgorithmUnit,
  mapNiceHashToMRR,
  normalizeAlgoForNiceHash,
} from "../core/mapping";
import { getBtcPriceData, parsePriceValue } from "../core/priceUtils";

export const numberValue = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(
          String(value)
            .replace(/,/g, "")
            .replace(/[^\d.-]/g, ""),
        );
  return Number.isFinite(parsed) ? parsed : 0;
};

export const compactNumber = (value, digits = 2) => {
  const num = numberValue(value);
  if (!num) return "0";
  return num.toLocaleString(undefined, { maximumFractionDigits: digits });
};

export const btcValue = (value) => {
  const num = numberValue(value);
  return num > 0 ? num.toFixed(8) : "0.00000000";
};

export const percentValue = (value) => {
  const num = numberValue(value);
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
};

const normalizeKey = (algo) =>
  normalizeAlgoForNiceHash(algo || "").toUpperCase();

export function normalizeMiningDutchRows(payload) {
  const source = payload?.miningpooldutch || payload || {};
  const rows = Array.isArray(source?.coinStats) ? source.coinStats : [];

  return rows
    .map((row) => {
      const nicehashAlgo = normalizeKey(row.algorithm || row.algo);
      return {
        provider: "Mining-Dutch",
        coin: row.coin || row.symbol || row.algorithm || "Pool",
        algorithm: row.algorithm || row.algo || "N/A",
        nicehashAlgo,
        mrrAlgo: mapNiceHashToMRR(nicehashAlgo),
        btcPerDay: numberValue(row.btcPerDay),
        usdPerDay: numberValue(row.usdPerDay),
        miners: numberValue(row.miners),
        hashrate: row.hashrate || "N/A",
        raw: row,
      };
    })
    .filter((row) => row.nicehashAlgo && row.nicehashAlgo !== "UNKNOWN");
}

export function normalizeHeroRows(payload) {
  const source =
    payload?.herominers_global || payload?.herominers || payload || {};
  const rows = Array.isArray(source?.coinStats) ? source.coinStats : [];

  return rows
    .map((row) => {
      const nicehashAlgo = normalizeKey(row.algorithm || row.algo);
      return {
        provider: "HeroMiners",
        coin: row.coin || row.symbol || "Coin",
        algorithm: row.algorithm || row.algo || "N/A",
        nicehashAlgo,
        mrrAlgo: mapNiceHashToMRR(nicehashAlgo),
        miners: numberValue(row.miners),
        workers: numberValue(row.workers),
        poolHashrate: row.poolHashrate || row.pool_hashrate || "N/A",
        networkHashrate: row.networkHashrate || row.network_hashrate || "N/A",
        usdPerDay: numberValue(row.usdPerDay),
        btcPerDay: numberValue(row.btcPerDay),
        raw: row,
      };
    })
    .filter((row) => row.nicehashAlgo && row.nicehashAlgo !== "UNKNOWN");
}

export function mergeMiningRoutes(
  miningDutchRows,
  heroRows,
  niceHashPrices = {},
) {
  const heroByAlgo = new Map();
  for (const row of heroRows) {
    const current = heroByAlgo.get(row.nicehashAlgo) || {
      coins: [],
      miners: 0,
      workers: 0,
      poolHashrates: [],
    };

    current.coins.push(row.coin);
    current.miners += row.miners;
    current.workers += row.workers;
    if (row.poolHashrate && row.poolHashrate !== "N/A")
      current.poolHashrates.push(row.poolHashrate);
    heroByAlgo.set(row.nicehashAlgo, current);
  }

  const dutchByAlgo = new Map();
  for (const row of miningDutchRows) {
    const current = dutchByAlgo.get(row.nicehashAlgo) || {
      rows: [],
      btcPerDay: 0,
      usdPerDay: 0,
      miners: 0,
      hashrate: row.hashrate,
    };

    current.rows.push(row);
    current.btcPerDay += row.btcPerDay;
    current.usdPerDay += row.usdPerDay;
    current.miners += row.miners;
    current.hashrate = current.hashrate || row.hashrate;
    dutchByAlgo.set(row.nicehashAlgo, current);
  }

  const algos = new Set([...heroByAlgo.keys(), ...dutchByAlgo.keys()]);
  return Array.from(algos)
    .map((nicehashAlgo) => {
      const dutch = dutchByAlgo.get(nicehashAlgo);
      const hero = heroByAlgo.get(nicehashAlgo);
      const nhPrice = numberValue(niceHashPrices[nicehashAlgo] || 0);
      const poolBtc = dutch?.btcPerDay || 0;
      const spread =
        poolBtc > 0 && nhPrice > 0
          ? ((poolBtc - nhPrice) / nhPrice) * 100
          : null;
      const activityScore = (hero?.miners || 0) + (hero?.workers || 0) * 0.25;
      const profitScore = poolBtc * 100000000;

      return {
        nicehashAlgo,
        mrrAlgo: mapNiceHashToMRR(nicehashAlgo),
        label: getAlgoDisplayName(nicehashAlgo),
        unit: getAlgorithmUnit(nicehashAlgo),
        miningDutchBtcPerDay: poolBtc,
        miningDutchUsdPerDay: dutch?.usdPerDay || 0,
        miningDutchMiners: dutch?.miners || 0,
        miningDutchHashrate: dutch?.hashrate || "N/A",
        heroCoins: Array.from(new Set(hero?.coins || [])).sort(),
        heroMiners: hero?.miners || 0,
        heroWorkers: hero?.workers || 0,
        heroPoolHashrates: hero?.poolHashrates || [],
        niceHashPrice: nhPrice,
        spread,
        rankScore: profitScore + activityScore,
        bestSource: poolBtc > 0 ? "Mining-Dutch" : "HeroMiners",
        dutchRows: dutch?.rows || [],
      };
    })
    .sort((a, b) => {
      const spreadA = a.spread ?? -Infinity;
      const spreadB = b.spread ?? -Infinity;
      if (spreadB !== spreadA) return spreadB - spreadA;
      return b.rankScore - a.rankScore;
    });
}

export function normalizeMrrMarketRows(payload) {
  const rentals = Array.isArray(payload?.data?.rentals)
    ? payload.data.rentals
    : Array.isArray(payload?.rentals)
      ? payload.rentals
      : Array.isArray(payload)
        ? payload
        : [];

  return rentals
    .map((rental) => {
      const rawPrice = rental?.price || rental?.rig?.price || {};
      const paidValue =
        getBtcPriceData(rawPrice).value ||
        parsePriceValue(
          rawPrice?.paid ?? rawPrice?.price ?? rawPrice?.amount ?? rawPrice,
        );
      const durationHours = numberValue(
        rental?.hours ||
          rental?.length ||
          rental?.duration ||
          rental?.rig?.hours,
      );
      const algo = String(
        rental?.algo ||
          rental?.algorithm ||
          rental?.rig?.algo ||
          rental?.rig?.algorithm ||
          rental?.rig?.type ||
          "N/A",
      );
      const nicehashAlgo = normalizeAlgoForNiceHash(algo);
      const advertised = numberValue(
        rental?.hashrate?.advertised?.hash ??
          rental?.hashrate?.advertised ??
          rental?.rig?.hashrate?.advertised?.hash ??
          rental?.rig?.hashrate?.advertised ??
          rental?.rig?.hashrate?.hash ??
          rental?.rig?.hashrate,
      );
      const unit = String(
        rental?.hashrate?.advertised?.type ||
          rental?.hashrate?.suffix ||
          rental?.rig?.hashrate?.advertised?.type ||
          rental?.rig?.hashrate?.suffix ||
          rental?.price_unit ||
          rental?.currency ||
          getAlgorithmUnit(nicehashAlgo),
      ).toUpperCase();
      const perUnitPerDay =
        paidValue > 0 && durationHours > 0 && advertised > 0
          ? paidValue / (durationHours / 24) / advertised
          : 0;

      return {
        id: String(rental?.id || rental?.rentalid || rental?.rental_id || ""),
        algo,
        nicehashAlgo,
        mrrAlgo: mapNiceHashToMRR(nicehashAlgo),
        unit,
        priceBtc: paidValue,
        pricePerUnitDayBtc: perUnitPerDay,
        durationHours,
        advertised,
        currency: String(
          rawPrice?.currency ||
            rawPrice?.price_unit ||
            rental?.currency ||
            "BTC",
        ).toUpperCase(),
        mrrClient: rental?.mrrClient || rental?.client || "",
      };
    })
    .filter(
      (row) =>
        row.nicehashAlgo &&
        row.nicehashAlgo !== "UNKNOWN" &&
        row.pricePerUnitDayBtc > 0,
    );
}

export function buildOpportunityRows(
  routeRows,
  niceHashPrices = {},
  mrrMarketRows = [],
) {
  const mrrByAlgo = new Map();
  for (const row of mrrMarketRows) {
    const current = mrrByAlgo.get(row.nicehashAlgo) || { rows: [], price: 0 };
    current.rows.push(row);
    current.price =
      current.price > 0
        ? Math.min(current.price, row.pricePerUnitDayBtc)
        : row.pricePerUnitDayBtc;
    mrrByAlgo.set(row.nicehashAlgo, current);
  }

  return routeRows
    .map((route) => {
      const nhPrice = numberValue(niceHashPrices[route.nicehashAlgo] || 0);
      const mrrMarket = mrrByAlgo.get(route.nicehashAlgo)?.price || 0;
      const pool = numberValue(route.miningDutchBtcPerDay || 0);
      const bestCost = Math.min(
        ...(nhPrice > 0 ? [nhPrice] : [Number.POSITIVE_INFINITY]),
        ...(mrrMarket > 0 ? [mrrMarket] : [Number.POSITIVE_INFINITY]),
      );
      const spreadVsNh =
        nhPrice > 0 ? ((pool - nhPrice) / nhPrice) * 100 : null;
      const spreadVsMrr =
        mrrMarket > 0 ? ((pool - mrrMarket) / mrrMarket) * 100 : null;
      const winner = [
        { key: "Mining-Dutch", value: pool },
        { key: "NiceHash", value: nhPrice },
        { key: "MRR", value: mrrMarket },
      ].sort((a, b) => b.value - a.value)[0];

      return {
        ...route,
        niceHashPrice: nhPrice,
        mrrMarketPrice: mrrMarket,
        poolRevenue: pool,
        spreadVsNh,
        spreadVsMrr,
        bestCost,
        winner: winner?.key || "N/A",
        opportunityScore:
          pool - (bestCost === Number.POSITIVE_INFINITY ? 0 : bestCost),
        mrrMarketRows: mrrByAlgo.get(route.nicehashAlgo)?.rows || [],
      };
    })
    .sort(
      (a, b) =>
        b.opportunityScore - a.opportunityScore ||
        b.poolRevenue - a.poolRevenue,
    );
}
