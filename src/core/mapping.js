// mapping.js - Core algorithm mapping for NiceHash and MRR

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

export function mapNiceHashToMRR(nicehashAlgo) {
  if (!nicehashAlgo) return "unknown";
  const normalized = String(nicehashAlgo).toUpperCase().trim();
  return MRR_ALGO_MAP[normalized] || normalized.toLowerCase();
}

export function getAlgorithmUnit(algo) {
  if (!algo) return "H/s";
  const normalized = String(algo).toUpperCase().trim();
  return ALGO_UNITS[normalized] || "H/s";
}

export function getMrrAlgorithmUnit(algo) {
  if (!algo) return "TH";
  const normalized = String(algo).toUpperCase().trim();
  const niceHashAlgo = normalizeAlgoForNiceHash(normalized);
  return MRR_ALGO_UNITS[normalized] || MRR_ALGO_UNITS[niceHashAlgo] || "TH";
}

export const getAlgoDisplayName = (algo) => getAlgorithmDisplayName(algo);

export function getAlgorithmDisplayName(algo) {
  if (!algo) return "Unknown";
  const normalized = String(algo).toUpperCase().trim();
  return ALGO_DISPLAY_NAMES[normalized] || algo;
}

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

function getUnitMultiplier(unit) {
  const normalized = String(unit || "")
    .toUpperCase()
    .replace(/\/S$/i, "")
    .trim();
  return HASHRATE_SUFFIXES[normalized] || 1;
}
