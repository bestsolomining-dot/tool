// Unit factors relative to TH/s (1 TH = 1 TH, 1 PH = 1000 TH, 1 EH = 1,000,000 TH)
export const UNIT_FACTORS = {
  EH: 1e6, PH: 1000, TH: 1, GH: 1e-3, MH: 1e-6, KH: 1e-9, H: 1e-12,
  EHS: 1e6, PHS: 1000, THS: 1, GHS: 1e-3, MHS: 1e-6,
  E: 1e6, P: 1000, T: 1, G: 1e-3, M: 1e-6, K: 1e-9
};

/**
 * Shared algorithm mapping between MRR and NiceHash identifiers.
 */
export const algoMap = {
  // Common GPU Algorithms
  'ETHASH': 'DAGGERHASHIMOTO',
  'DAGGERHASHIMOTO': 'DAGGERHASHIMOTO',
  'HASHIMOTO': 'DAGGERHASHIMOTO',
  'HASHIMOTOS': 'DAGGERHASHIMOTO',
  'ETCHASH': 'ETCHASH',
  'ETC': 'ETCHASH',
  'ETHEREUMCLASSIC': 'ETCHASH',
  'KAWPOW': 'KAWPOW',
  'RVN': 'KAWPOW',
  'RAVEN': 'KAWPOW',
  'OCTOPUS': 'OCTOPUS',
  'CFX': 'OCTOPUS',
  'AUTOLYKOS': 'AUTOLYKOS',
  'AUTOLYKOSV2': 'AUTOLYKOS',
  'ERGO': 'AUTOLYKOS',
  'ERG': 'AUTOLYKOS',
  'FISHHASH': 'FISHHASH',

  // Common ASIC Algorithms
  'SHA256': 'SHA256',
  'SHA256ASICBOOST': 'SHA256',
  'SHA256AB': 'SHA256ASICBOOST',
  'BTC': 'SHA256',
  'SCRYPT': 'SCRYPT',
  'SCRYPTN': 'SCRYPT',
  'SCRYPT-N': 'SCRYPT',
  'LTC': 'SCRYPT',
  'LITECOIN': 'SCRYPT',
  'X11': 'X11',
  'DASH': 'X11',
  'QUARK': 'QUARK',
  'X13': 'X13',
  'KECCAK': 'KECCAK',
  'SHA3': 'KECCAK',
  'KECCAKSHA3': 'KECCAK',
  'RANDOMX': 'RANDOMX',
  'MONERO': 'RANDOMX',
  'RANDOMXMONERO': 'RANDOMX',
  'XMR': 'RANDOMX',

  // Equihash Variants
  'EQUIHASH': 'EQUIHASH',
  'ZHASH': 'ZHASH',
  'EQUIHASH1445': 'ZHASH',
  'EQUIHASH1927': 'ZHASH',
  'BEAMV3': 'BEAMV3',
  'EQUIHASH1254': 'BEAMV3',
  'BEAM': 'BEAMV3',

  // Modern/Newer Algorithms
  'IRONFISH': 'IRONFISH',
  'IRON': 'IRONFISH',
  'ALEPHIUM': 'ALEPHIUM',
  'ALPH': 'ALEPHIUM',
  'KARLSENHASH': 'KARLSENHASH',
  'KLS': 'KARLSENHASH',
  'PYRINHASH': 'PYRINHASH',
  'PYI': 'PYRINHASH',
  'NEXA': 'NEXA',
  'KHEAVYHASH': 'KHEAVYHASH',
  'KASPA': 'KHEAVYHASH',
  'KAS': 'KHEAVYHASH',
  'VERUSHASH': 'VERUSHASH',
  'VRSC': 'VERUSHASH',
  'NEOSCRYPT': 'NEOSCRYPT',
  'LYRA2REV3': 'LYRA2REV3',
  'X16R': 'X16R',
  'X16RV2': 'X16RV2',
  'CUCKAROO29': 'GRINCUCKAROO29',
  'GRINCUCKAROO29': 'GRINCUCKAROO29',
  'CUCKATOO31': 'GRINCUCKATOO31',
  'GRINCUCKATOO31': 'GRINCUCKATOO31',
  'CUCKATOO32': 'GRINCUCKATOO32',
  'GRINCUCKATOO32': 'GRINCUCKATOO32',
  'HANDSHAKE': 'HANDSHAKE',
  'HNS': 'HANDSHAKE',
  'LBRY': 'LBRY'
};

/** Display names for algorithms (user-friendly formatting) */
export const ALGO_DISPLAY_NAMES = {
  'SHA256': 'SHA256',
  'SCRYPT': 'Scrypt',
  'DAGGERHASHIMOTO': 'DaggerHashimoto',
  'KAWPOW': 'KawPow',
  'RANDOMXMONERO': 'RandomXMonero',
  'ETCHASH': 'Etchash',
  'RANDOMX': 'RandomX',
  'FISHHASH': 'FishHash',
  'OCTOPUS': 'Octopus',
  'AUTOLYKOS': 'Autolykos',
  'KHEAVYHASH': 'KHeavyHash',
  'EQUIHASH': 'Equihash',
  'BLAKE2S': 'Blake2s',
  'LBRY': 'LBRY',
  'X11': 'X11',
  'GRIN29': 'Grin29',
  'GRIN31': 'Grin31',
  'LYRA2RE': 'Lyra2RE',
  'LYRA2REV2': 'Lyra2REv2',
  'LYRA2REV3': 'Lyra2REv3',
  'NEOSCRYPT': 'NeoScrypt',
  'PYRIN': 'Pyrin',
  'KARLSEN': 'Karlsen',
  'KARLSENHASH': 'KarlsenHash',
  'IRONFISH': 'IronFish',
  'EAGLESONG': 'EagleSong',
  'HANDSHAKE': 'Handshake',
  'SHA256ASICBOOST': 'SHA256AsicBoost'
};

/** Standardizes an algorithm name and maps it to the equivalent NiceHash identifier. */
export function normalizeAlgoForNiceHash(algo) {
  if (!algo) return '';
  let clean = String(algo).toUpperCase().trim().replace(/\s*\(.*\)/g, '');
  const firstWord = clean.split(/\s+/)[0];
  return algoMap[clean] || algoMap[firstWord] || clean.replace(/[^A-Z0-9]/g, '').toUpperCase();
}

/** Reverse mapping: NiceHash identifier to MRR slug. */
export function mapNiceHashToMRR(algo) {
  if (!algo) return '';
  const entry = Object.entries(algoMap).find(([mrr, nh]) => nh === algo.toUpperCase());
  return entry ? entry[0] : algo.toUpperCase();
}

/** Returns a friendly display name for an algorithm code. */
export function getAlgoDisplayName(code) {
  if (!code) return 'N/A';
  const uc = String(code).toUpperCase();
  return ALGO_DISPLAY_NAMES[uc] || code;
}

/** Maps market identifiers (numeric IDs, strings, or objects) to NiceHash string names (EU/USA). */
export function getMarketName(market) {
  // Handle case where market might be the full object from API
  const id = (market && typeof market === 'object') ? market.id : market;
  const m = String(id || '').trim().toUpperCase();

  if (m === '0' || m === 'EU' || m === 'EUROPE') return 'EU';
  if (m === '1' || m === 'USA' || m === 'US' || m === 'USA_EAST') return 'USA';
  return 'USA'; // Default
}

/** Standardized hashrate pricing formatter. */
export function formatHashratePrice(price, currency = 'BTC', unit = 'TH') {
  const cleanUnit = String(unit || 'TH').toUpperCase().replace('S', '');
  return `${parseFloat(price || 0).toFixed(6)} ${currency} / ${cleanUnit} / Day`;
}

/** Extracts base unit prefix (e.g., 'BTC/TH/Day' -> 'TH') */
const normalizeUnit = (u) => {
  const match = String(u || '').toUpperCase().match(/(EH|PH|TH|GH|MH|KH|H)/);
  return match ? match[0] : 'TH';
};

/** Calculates the price difference ROI percentage. */
export function calculatePriceComparison(mrrPrice, mrrUnit, nhPrice, nhUnit, isMrrVsNh = true) {
  const nhPriceNum = Number.parseFloat(nhPrice || 0);
  let mrrPriceNum = Number.parseFloat(mrrPrice || 0);
  if (nhPriceNum <= 0 || mrrPriceNum <= 0) return null;

  const mClean = normalizeUnit(mrrUnit);
  const nClean = normalizeUnit(nhUnit);

  // Magnitude Guard: If ASIC algorithm and price > 0.01, it's likely a PH price labeled as TH
  const isAsic = mrrUnit?.toUpperCase().includes('SHA256') || mrrUnit?.toUpperCase().includes('SCRYPT') || nhUnit?.toUpperCase().includes('SHA256');
  let effectiveMrrUnit = mClean;
  if (isAsic && mrrPriceNum > 0.01 && mClean === 'TH') effectiveMrrUnit = 'PH';

  // Normalize prices to BTC/TH/Day
  const mrrPricePerTh = mrrPriceNum / (UNIT_FACTORS[effectiveMrrUnit] || 1);
  const nhPricePerTh = nhPriceNum / (UNIT_FACTORS[nClean] || 1);

  const diff = isMrrVsNh
    ? ((mrrPricePerTh - nhPricePerTh) / nhPricePerTh * 100) // (MRR - NH) / NH * 100
    : ((nhPricePerTh - mrrPricePerTh) / nhPricePerTh * 100); // (NH - MRR) / NH * 100

  return diff.toFixed(1);
}