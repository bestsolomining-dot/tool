// mapping.js - Core algorithm mapping for NiceHash and MRR
// Enhanced for external use across the application

export const ALGO_DISPLAY_NAMES = {
  SHA256: "SHA256",
  SHA256ASICBOOST: "SHA256AsicBoost",
  SHA256AB: "SHA256AsicBoost",
  SCRYPT: "Scrypt",
  ETH: "DaggerHashimoto",
  DAGGERHASHIMOTO: "DaggerHashimoto",
  ETCHASH: "Etchash",
  EQUIHASH: "Equihash",
  ZHASH: "ZHash",
  KAWPOW: "KawPow",
  AUTOLYKOSV2: "Autolykos v2",
  AUTOLYKOS: "Autolykos",
  RANDOMX: "RandomX",
  RANDOMXMONERO: "RandomXMonero",
  OCTOPUS: "Octopus",
  KHEAVYHASH: "KHeavyHash",
  EAGLESONG: "Eaglesong",
  VERUSHASH: "VerusHash",
  NEXAPOW: "NexaPow",
  FISHHASH: "FishHash",
  DYNEXSOLVE: "DynexSolve",
  BEAMHASHIII: "BeamHash III",
  BLAKE3: "Blake3",
  BLAKE3_ALPH: "Blake3 (Alephium)",
  JANUSHASH: "Janushash",
  XELISHASHV3: "XelisHash v3",
  PROGPOWZ: "ProgPow Zano",
  PEARLHASH: "PearlHash",
  X11: "X11",
  LYRA2REV2: "Lyra2REv2",
  LYRA2Z: "Lyra2Z",
  NEOSCRYPT: "NeoScrypt",
  YESPOWER: "Yespower",
  ARGON2: "Argon2",
  CN_R: "CryptoNight R",
  CN_HEAVY: "CryptoNight Heavy",
  IRONFISH: "IronFish",
  ALEPHIUM: "Alephium",
  BEAMV3: "BeamV3",
};

// NiceHash algorithm normalization
export const NICEHASH_ALGO_MAP = {
  SHA256: "SHA256",
  SHA256AB: "SHA256ASICBOOST",
  SHA256ASICBOOST: "SHA256ASICBOOST",
  SHA256ASICSBOOST: "SHA256ASICBOOST",
  SCRYPT: "SCRYPT",
  ETH: "DAGGERHASHIMOTO",
  DAGGERHASHIMOTO: "DAGGERHASHIMOTO",
  EQUIHASH: "EQUIHASH",
  ZHASH: "ZHASH",
  ETCHASH: "ETCHASH",
  KAWPOW: "KAWPOW",
  AUTOLYKOSV2: "AUTOLYKOS",
  AUTOLYKOS: "AUTOLYKOS",
  RANDOMX: "RANDOMXMONERO",
  RANDOMXMONERO: "RANDOMXMONERO",
  OCTOPUS: "OCTOPUS",
  KHEAVYHASH: "KHEAVYHASH",
  EAGLESONG: "EAGLESONG",
  VERUSHASH: "VERUSHASH",
  NEXAPOW: "NEXAPOW",
  FISHHASH: "FISHHASH",
  DYNEXSOLVE: "DYNEXSOLVE",
  BEAMHASHIII: "BEAMV3",
  BEAMV3: "BEAMV3",
  BLAKE3_ALPH: "ALEPHIUM",
  BLAKE3: "ALEPHIUM",
  JANUSHASH: "JANUSHASH",
  XELISHASHV3: "XELISHASHV3",
  X11: "X11",
  PROGPOWZ: "PROGPOWZ",
  PEARLHASH: "PEARLHASH",
  IRONFISH: "IRONFISH",
  ALEPHIUM: "ALEPHIUM",
};

// MRR algorithm mapping
export const MRR_ALGO_MAP = {
  SHA256: "sha256",
  SHA256AB: "sha256ab",
  SHA256ASICBOOST: "sha256ab",
  SCRYPT: "scrypt",
  ETH: "daggerhashimoto",
  DAGGERHASHIMOTO: "ethash",
  EQUIHASH: "equihash",
  ZHASH: "zhash",
  ETCHASH: "etchash",
  KAWPOW: "kawpow",
  AUTOLYKOSV2: "autolykos_v2",
  AUTOLYKOS: "autolykos_v2",
  RANDOMX: "randomx",
  RANDOMXMONERO: "randomx",
  OCTOPUS: "octopus",
  KHEAVYHASH: "kheavyhash",
  EAGLESONG: "eaglesong",
  VERUSHASH: "verushash",
  NEXAPOW: "nexapow",
  FISHHASH: "fishhash",
  DYNEXSOLVE: "dynexsolve",
  BEAMHASHIII: "beamhash_iii",
  BLAKE3_ALPH: "blake3_alph",
  BLAKE3: "blake3_alph",
  JANUSHASH: "janushash",
  XELISHASHV3: "xelishash_v3",
  X11: "x11",
  PROGPOWZ: "progpowz",
  PEARLHASH: "pearlhash",
};

// Reverse mappings for lookup
export const NICEHASH_REVERSE_MAP = Object.entries(NICEHASH_ALGO_MAP).reduce((acc, [key, value]) => {
  if (!acc[value]) acc[value] = [];
  acc[value].push(key);
  return acc;
}, {});

export const MRR_REVERSE_MAP = Object.entries(MRR_ALGO_MAP).reduce((acc, [key, value]) => {
  if (!acc[value]) acc[value] = [];
  acc[value].push(key);
  return acc;
}, {});

// Hashrate suffixes for display
export const HASHRATE_SUFFIXES = {
  EH: 1e18,
  PH: 1e15,
  TH: 1e12,
  GH: 1e9,
  MH: 1e6,
  KH: 1e3,
  H: 1,
  GSOL: 1e9,
  MSOL: 1e6,
  KSol: 1e3,
  Sol: 1,
  KSOL: 1e3,
  SOL: 1,
};

// Algorithm market units (NiceHash Market Standards)
export const ALGO_UNITS = {
  SHA256: "EH",
  SHA256AB: "EH",
  SHA256ASICBOOST: "EH",
  SCRYPT: "TH",
  X11: "PH",
  NEOSCRYPT: "TH",
  DAGGERHASHIMOTO: "TH",
  ETCHASH: "TH",
  KAWPOW: "TH",
  EQUIHASH: "GSOL",
  ZHASH: "MSOL",
  AUTOLYKOSV2: "TH",
  AUTOLYKOS: "TH",
  RANDOMX: "GH",
  RANDOMXMONERO: "GH",
  EAGLESONG: "EH",
  OCTOPUS: "TH",
  KHEAVYHASH: "EH",
  FISHHASH: "TH",
  DYNEXSOLVE: "TH",
  BEAMHASHIII: "MSOL",
  BEAMV3: "MSOL",
  VERUSHASH: "TH",
  NEXAPOW: "TH",
  BLAKE3_ALPH: "PH",
  BLAKE3: "PH",
  JANUSHASH: "TH",
  XELISHASHV3: "TH",
  PROGPOWZ: "TH",
  PEARLHASH: "TH",
  IRONFISH: "TH",
  ALEPHIUM: "PH",
};

// MiningRigRentals marketplace price units (shown as Price/<unit>/Day on MRR).
export const MRR_ALGO_UNITS = {
  SHA256: "PH",
  SHA256AB: "PH",
  SHA256ASICBOOST: "PH",
  SCRYPT: "GH",
  X11: "TH",
  DAGGERHASHIMOTO: "GH",
  HASHIMOTOS: "GH",
  ETHASH: "GH",
  ETCHASH: "GH",
  KAWPOW: "GH",
  EQUIHASH: "GH",
  ZHASH: "GH",
  RANDOMX: "MH",
  RANDOMXMONERO: "MH",
  OCTOPUS: "GH",
  KHEAVYHASH: "TH",
};

// Factors relative to TH/s (Used for pricing math in MrrRigCard)
export const UNIT_FACTORS = {
  EH: 1e6,
  PH: 1e3,
  TH: 1,
  GH: 1e-3,
  MH: 1e-6,
  KH: 1e-9,
  H: 1e-12,
  GSol: 1e-3,
  MSol: 1e-6,
  KSOL: 1e-9,
  SOL: 1e-12,
};

// Algorithm categories for filtering
export const ALGO_CATEGORIES = {
  ASIC: ["SHA256", "SHA256ASICBOOST", "SCRYPT", "X11", "EAGLESONG", "KHEAVYHASH", "BLAKE3", "BLAKE3_ALPH"],
  GPU: ["DAGGERHASHIMOTO", "ETCHASH", "KAWPOW", "AUTOLYKOS", "OCTOPUS", "FISHHASH", "DYNEXSOLVE", "NEXAPOW", "PROGPOWZ", "PEARLHASH", "IRONFISH", "ALEPHIUM"],
  CPU: ["RANDOMXMONERO", "VERUSHASH"],
  HYBRID: ["EQUIHASH", "ZHASH", "BEAMV3", "JANUSHASH", "XELISHASHV3"]
};

// Profitability tiers for quick reference
export const PROFITABILITY_TIERS = {
  EXTREME: { min: 50, emoji: "🚀", color: "#ff0000" },
  HIGH: { min: 25, emoji: "🔥", color: "#ff6600" },
  GOOD: { min: 10, emoji: "💰", color: "#ffcc00" },
  MODERATE: { min: 5, emoji: "✅", color: "#00cc00" },
  LOW: { min: 0, emoji: "📊", color: "#0099ff" }
};

/**
 * Normalize algorithm name for NiceHash API
 * @param {string} algo - Raw algorithm name
 * @returns {string} Normalized algorithm name or "UNKNOWN"
 */
export function normalizeAlgoForNiceHash(algo) {
  if (!algo) return "UNKNOWN";
  const normalized = String(algo).toUpperCase().trim();

  // Direct mapping
  if (NICEHASH_ALGO_MAP[normalized]) {
    return NICEHASH_ALGO_MAP[normalized];
  }

  // Handle common variations
  if (normalized.includes("SHA256AB") || normalized.includes("ASICBOOST"))
    return "SHA256ASICBOOST";
  if (normalized.includes("SHA256")) return "SHA256";
  if (normalized.includes("SCRYPT")) return "SCRYPT";
  if (normalized.includes("ETHASH")) return "DAGGERHASHIMOTO";
  if (normalized.includes("ETCHASH")) return "ETCHASH";
  if (normalized.includes("KAWPOW")) return "KAWPOW";
  if (normalized.includes("RANDOMX")) return "RANDOMXMONERO";
  if (normalized.includes("OCTOPUS")) return "OCTOPUS";
  if (normalized.includes("KHEAVYHASH")) return "KHEAVYHASH";
  if (normalized.includes("ZHASH")) return "ZHASH";
  if (normalized.includes("EAGLESONG")) return "EAGLESONG";
  if (normalized.includes("VERUSHASH")) return "VERUSHASH";
  if (normalized.includes("NEXAPOW")) return "NEXAPOW";
  if (normalized.includes("FISHHASH")) return "FISHHASH";
  if (normalized.includes("DYNEXSOLVE")) return "DYNEXSOLVE";
  if (normalized.includes("BEAMHASH")) return "BEAMHASHIII";
  if (normalized.includes("BLAKE3")) return "BLAKE3";
  if (normalized.includes("JANUSHASH")) return "JANUSHASH";
  if (normalized.includes("XELISHASH")) return "XELISHASHV3";
  if (normalized.includes("PROGPOW")) return "PROGPOWZ";
  if (normalized.includes("PEARLHASH")) return "PEARLHASH";

  return "UNKNOWN";
}

/**
 * Map NiceHash algorithm to MRR format
 * @param {string} nicehashAlgo - NiceHash algorithm name
 * @returns {string} MRR algorithm name
 */
export function mapNiceHashToMRR(nicehashAlgo) {
  if (!nicehashAlgo) return "unknown";
  const normalized = String(nicehashAlgo).toUpperCase().trim();
  return MRR_ALGO_MAP[normalized] || normalized.toLowerCase();
}

/**
 * Map MRR algorithm back to NiceHash format
 * @param {string} mrrAlgo - MRR algorithm name
 * @returns {string} NiceHash algorithm name or original if not found
 */
export function mapMRRToNiceHash(mrrAlgo) {
  if (!mrrAlgo) return "unknown";
  const normalized = String(mrrAlgo).toLowerCase().trim();
  for (const [niceHash, mrr] of Object.entries(MRR_ALGO_MAP)) {
    if (mrr === normalized) return niceHash;
  }
  return mrrAlgo;
}

/**
 * Get the standard unit for an algorithm
 * @param {string} algo - Algorithm name
 * @returns {string} Unit string (e.g., "TH", "MH", "SOL")
 */
export function getAlgorithmUnit(algo) {
  if (!algo) return "H/s";
  const normalized = String(algo).toUpperCase().trim();
  return ALGO_UNITS[normalized] || "H/s";
}

/**
 * Get MRR-specific unit for an algorithm
 * @param {string} algo - Algorithm name
 * @returns {string} MRR unit string
 */
export function getMrrAlgorithmUnit(algo) {
  if (!algo) return "TH";
  const normalized = String(algo).toUpperCase().trim();
  const niceHashAlgo = normalizeAlgoForNiceHash(normalized);
  return MRR_ALGO_UNITS[normalized] || MRR_ALGO_UNITS[niceHashAlgo] || "TH";
}

/**
 * Get display name for algorithm
 * @param {string} algo - Algorithm name
 * @returns {string} Human-readable algorithm name
 */
export const getAlgoDisplayName = (algo) => getAlgorithmDisplayName(algo);

export function getAlgorithmDisplayName(algo) {
  if (!algo) return "Unknown";
  const normalized = String(algo).toUpperCase().trim();
  return ALGO_DISPLAY_NAMES[normalized] || algo;
}

/**
 * Get algorithm category
 * @param {string} algo - Algorithm name
 * @returns {string} Category (ASIC, GPU, CPU, HYBRID, UNKNOWN)
 */
export function getAlgorithmCategory(algo) {
  if (!algo) return "UNKNOWN";
  const normalized = normalizeAlgoForNiceHash(algo);
  for (const [category, algos] of Object.entries(ALGO_CATEGORIES)) {
    if (algos.includes(normalized)) return category;
  }
  return "UNKNOWN";
}

/**
 * Get all algorithms in a specific category
 * @param {string} category - Category name
 * @returns {string[]} Array of algorithm names
 */
export function getAlgorithmsByCategory(category) {
  return ALGO_CATEGORIES[category] || [];
}

/**
 * Get profitability tier for a spread percentage
 * @param {number} spreadPct - Spread percentage
 * @returns {Object} Tier information
 */
export function getProfitabilityTier(spreadPct) {
  if (spreadPct === null || spreadPct === undefined) return null;
  const tiers = Object.entries(PROFITABILITY_TIERS).sort((a, b) => b[1].min - a[1].min);
  for (const [name, tier] of tiers) {
    if (spreadPct >= tier.min) return { name, ...tier };
  }
  return null;
}

/**
 * Calculate price comparison between two marketplaces
 * @param {number} yourPrice - Your price
 * @param {string} yourUnit - Your price unit
 * @param {number} marketPrice - Market price
 * @param {string} marketUnit - Market price unit
 * @param {boolean} isMrrVsNh - Whether comparing MRR vs NiceHash
 * @returns {number|null} Percentage difference
 */
export function calculatePriceComparison(
  yourPrice,
  yourUnit,
  marketPrice,
  marketUnit,
  isMrrVsNh = false,
) {
  if (!yourPrice || !marketPrice || yourPrice <= 0 || marketPrice <= 0)
    return null;

  const yourMultiplier = getUnitMultiplier(yourUnit);
  const marketMultiplier = getUnitMultiplier(marketUnit);
  if (yourMultiplier <= 0 || marketMultiplier <= 0) return null;

  // Prices are quoted per unit per day. Normalize both to price per H/s/day.
  const yourPerHash = parseFloat(yourPrice) / yourMultiplier;
  const marketPerHash = parseFloat(marketPrice) / marketMultiplier;

  if (yourPerHash <= 0 || marketPerHash <= 0) return null;

  if (isMrrVsNh) {
    return ((marketPerHash - yourPerHash) / yourPerHash) * 100;
  }

  return ((yourPerHash - marketPerHash) / marketPerHash) * 100;
}

/**
 * Format hashrate with appropriate unit
 * @param {number} hashrate - Hashrate in H/s
 * @param {string} algo - Algorithm name
 * @returns {string} Formatted hashrate (e.g., "1.5 TH/s")
 */
export function formatHashrate(hashrate, algo) {
  if (!hashrate || hashrate <= 0) return "0 H/s";
  
  const unit = getAlgorithmUnit(algo);
  const factor = UNIT_FACTORS[unit] || 1;
  const value = hashrate / factor;
  
  return `${value.toFixed(2)} ${unit}/s`;
}

/**
 * Get all supported algorithms
 * @returns {string[]} Array of supported algorithm names
 */
export function getAllSupportedAlgorithms() {
  return [...new Set([
    ...Object.keys(NICEHASH_ALGO_MAP),
    ...Object.values(NICEHASH_ALGO_MAP)
  ])].filter(algo => algo !== "UNKNOWN").sort();
}

/**
 * Check if algorithm is supported
 * @param {string} algo - Algorithm name
 * @returns {boolean} Whether the algorithm is supported
 */
export function isSupportedAlgorithm(algo) {
  return normalizeAlgoForNiceHash(algo) !== "UNKNOWN";
}

/**
 * Get unit multiplier
 * @param {string} unit - Unit string
 * @returns {number} Multiplier value
 */
function getUnitMultiplier(unit) {
  const normalized = String(unit || "")
    .toUpperCase()
    .replace(/\/S$/i, "")
    .trim();
  return HASHRATE_SUFFIXES[normalized] || 1;
}
export const normalizeAlgo = normalizeAlgoForNiceHash;
