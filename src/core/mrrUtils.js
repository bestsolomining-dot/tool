import { parsePriceValue as parsePriceValueUtils } from "./priceUtils.js";

/** Power factor mapping for normalization (EH/s base) */
export const UNIT_TO_POWER = {
  EH: 0,
  PH: -3,
  TH: -6,
  GH: -9,
  MH: -12,
  GSOL: -9,
  MSOL: -12,
  E: 0,
  P: -3,
  T: -6,
  G: -9,
  M: -12,
  EHS: 0,
  PHS: -3,
  THS: -6,
  GHS: -9,
  MHS: -12,
};

/** Robustly extract base unit (e.g., 'GH/s' or 'BTC/TH/Day' -> 'GH' or 'TH') */
export const clean = (u) => {
  const str = String(u || "")
    .toUpperCase()
    .trim();

  const m =
    str.match(/(GSOL|MSOL|KSOL|SOL|EHS|PHS|THS|GHS|MHS|EH|PH|TH|GH|MH|KH)/) ||
    str.match(/\b(E|P|T|G|M|K|H)\b/);
  if (!m) return "TH";
  let unit = m[0];
  const singleMap = { E: "EH", P: "PH", T: "TH", G: "GH", M: "MH", K: "KH" };
  return singleMap[unit] || unit;
};

export const convertPriceBetweenUnits = (price, fromUnit, toUnit) => {
  const fromPower = UNIT_TO_POWER[clean(fromUnit) || ""] ?? -6;
  const toPower = UNIT_TO_POWER[clean(toUnit) || ""] ?? -6;
  return price * Math.pow(10, fromPower - toPower);
};

export function calculatePriceComparison(mrrPrice, mrrUnit, nhPrice, nhUnit) {
  const nhPriceNum = Number.parseFloat(nhPrice || 0);
  const mrrPriceNum = Number.parseFloat(mrrPrice || 0);

  if (nhPriceNum <= 0 || mrrPriceNum <= 0) return null;
  const mrrUnitClean = clean(mrrUnit);
  const nhUnitClean = clean(nhUnit);

  const mrrP = UNIT_TO_POWER[mrrUnitClean] ?? -6;
  const nhP = UNIT_TO_POWER[nhUnitClean] ?? -6;

  const mrrPriceNorm = mrrPriceNum / Math.pow(10, mrrP);
  const nhPriceNorm = nhPriceNum / Math.pow(10, nhP);

  return (((mrrPriceNorm - nhPriceNorm) / nhPriceNorm) * 100).toFixed(2);
}

export function findRigArray(obj) {
  if (!obj || typeof obj !== "object") return [];
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.rigs)) return obj.rigs;
  if (Array.isArray(obj.data)) return obj.data;

  for (const key in obj) {
    const result = findRigArray(obj[key]);
    if (result && result.length > 0) return result;
  }
  return [];
}

export const getClientBadgeStyle = (client) => {
  const c = String(client || "").toUpperCase();
  const styles = {
    BT: { background: "#2563eb", color: "#fff" },
    SL: { background: "#d97706", color: "#fff" },
    LN: { background: "#eff308", color: "#fff" },
    VN: { background: "#10b981", color: "#fff" },
    LUCKY: { background: "#ec4899", color: "#fff" },
  };
  return styles[c] || { background: "rgba(255,255,255,0.1)", color: "#94a3b8" };
};

export function formatHashrateValue(rate) {
  if (!rate) return "0 N/A";
  if (typeof rate === "string" || typeof rate === "number") return String(rate);
  if (rate.nice) return rate.nice;
  const hash = rate.hash ?? rate.advertised ?? 0;
  const parsed = Number.parseFloat(hash);
  const displayHash = Number.isFinite(parsed)
    ? parsed.toFixed(2)
    : String(hash);
  return `${displayHash} ${String(rate.type || "").toUpperCase()}`.trim();
}

export function getRawHashrate(rate) {
  if (!rate) return 0;
  if (typeof rate === "number") return rate;
  if (typeof rate === "string") return parseFloat(rate) || 0;
  return parseFloat(rate.hash ?? rate.hashrate ?? rate.advertised ?? 0);
}

export function parsePriceValueLocal(price) {
  if (price === undefined || price === null) return 0;
  if (typeof price === "number") return price;
  if (typeof price === "string") {
    const cleaned = price.replace(/,/g, "").replace(/[^\d.-]/g, "");
    return parseFloat(cleaned) || 0;
  }
  if (typeof price === "object") {
    const candidate =
      price.price ??
      price.paid ??
      price.advertised ??
      price.amount ??
      price.total;
    if (candidate !== undefined) return parsePriceValueLocal(candidate);
    const nested = Object.values(price).find(
      (val) =>
        typeof val === "object" &&
        (val.price !== undefined || val.paid !== undefined),
    );
    if (nested) return parsePriceValueLocal(nested.price ?? nested.paid);
  }
  return 0;
}

export function getPriceDataLocal(source) {
  if (source === undefined || source === null)
    return { value: 0, currency: "BTC" };
  if (typeof source === "number") return { value: source, currency: "BTC" };
  if (typeof source === "string")
    return { value: parsePriceValueLocal(source), currency: "BTC" };

  const obj = source;
  if (typeof obj === "object") {
    const getObjValue = (key) => {
      const normalized = obj[key];
      if (normalized === undefined) return undefined;
      if (typeof normalized === "object") {
        const nested =
          normalized.paid ??
          normalized.price ??
          normalized.amount ??
          normalized.total ??
          normalized.value ??
          normalized;
        return parsePriceValueLocal(nested);
      }
      return parsePriceValueLocal(normalized);
    };

    const currency = String(
      obj.currency || obj.price_unit || "BTC",
    ).toUpperCase();

    const preferredKeys = ["BTC", "USD", "LTC"];
    for (const key of preferredKeys) {
      const value = getObjValue(key);
      if (value !== undefined) return { value, currency: key.toUpperCase() };
    }

    const directValue =
      obj.paid ?? obj.price ?? obj.advertised ?? obj.amount ?? obj.total;
    if (directValue !== undefined)
      return { value: parsePriceValueLocal(directValue), currency };

    for (const key of Object.keys(obj)) {
      if (key === "paid" || key === "currency" || key === "price_unit")
        continue;
      const v = getObjValue(key);
      if (v !== undefined) return { value: v, currency: key.toUpperCase() };
    }
  }

  return { value: 0, currency: "BTC" };
}

export function getNiceHashPriceValue(rawNhData) {
  const nhData = rawNhData?.price || rawNhData;
  if (nhData === undefined || nhData === null) return 0;
  if (typeof nhData === "number") return nhData;
  if (typeof nhData === "string") return parsePriceValueUtils(nhData);

  const candidate =
    nhData.fixedPrice ??
    nhData.standardPrice?.fast ??
    nhData.standardPrice ??
    nhData.price ??
    nhData.amount ??
    nhData.total ??
    0;
  return parsePriceValueUtils(candidate);
}

export function formatRentalStartTime(startTime) {
  if (!startTime) return "N/A";
  const normalized = /\bUTC\b/i.test(String(startTime))
    ? String(startTime)
    : `${startTime} UTC`;
  const date = new Date(normalized);
  if (isNaN(date.getTime())) return startTime;

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return `Starts at ${date.toLocaleTimeString()}`;

  const diffSec = Math.floor(diffMs / 1000);
  const d = Math.floor(diffSec / 86400);
  const h = Math.floor((diffSec % 86400) / 3600);
  const m = Math.floor((diffSec % 3600) / 60);

  let elapsed = "";
  if (d > 0) elapsed += `${d}d `;
  if (h > 0 || d > 0) elapsed += `${h}h `;
  elapsed += `${m}m`;

  return `${elapsed}`;
}

export function getRentalAlgorithm(rental) {
  return (
    rental?.rig?.type ||
    rental?.algorithm ||
    rental?.normalized?.algorithm ||
    "N/A"
  );
}

export function getRentalAdvertisedHashrate(rental) {
  const rate =
    rental?.hashrate?.advertised || rental?.rig?.hashrate?.advertised;
  return (
    formatHashrateValue(rate) ||
    rental?.normalized?.niceAdvertisedHashrate ||
    "0 N/A"
  );
}

export function getRentalAverageHashrate(rental) {
  const rate = rental?.hashrate?.average || rental?.rig?.hashrate?.average;
  return (
    formatHashrateValue(rate) ||
    rental?.normalized?.niceAverageHashrate ||
    "0 N/A"
  );
}

export function getRentalEfficiency(rental) {
  return String(
    rental?.hashrate?.average?.percent || rental?.normalized?.percent || "0",
  );
}

export const getStatusClass = (status) => {
  const statusValue = typeof status === "object" ? status.status : status;
  const s = String(statusValue || "").toLowerCase();
  if (s.includes("available") || s.includes("online"))
    return {
      color: "#10b981",
      background: "rgba(16, 185, 129, 0.1)",
      border: "1px solid rgba(16, 185, 129, 0.2)",
    };
  if (s.includes("rented"))
    return {
      color: "#a78bfa",
      background: "rgba(167, 139, 250, 0.1)",
      border: "1px solid rgba(167, 139, 250, 0.2)",
    };
  if (s.includes("offline") || s.includes("disabled"))
    return {
      color: "#f87171",
      background: "rgba(248, 113, 113, 0.1)",
      border: "1px solid rgba(248, 113, 113, 0.2)",
    };
  return "";
};

export const getRoiColor = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "#94a3b8";

  const clamped = Math.max(-100, Math.min(100, num));
  if (clamped === 0) return "#fbbf24";

  if (clamped > 0) {
    const t = Math.min(1, clamped / 100);
    const hue = 48 + 72 * t;
    return `hsl(${hue}, 95%, 58%)`;
  }

  const t = Math.min(1, Math.abs(clamped) / 100);
  const hue = 8 + 40 * (1 - t);
  return `hsl(${hue}, 92%, 58%)`;
};
