/** Power factor mapping for normalization (EH/s base) */
export const UNIT_TO_POWER = {
  'EH': 0, 'PH': -3, 'TH': -6, 'GH': -9, 'MH': -12, 'KH': -15, 'H': -18,
  'E': 0, 'P': -3, 'T': -6, 'G': -9, 'M': -12,
  'EHS': 0, 'PHS': -3, 'THS': -6, 'GHS': -9, 'MHS': -12
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
  'SHA256ASICBOOST': 'SHA256ASICBOOST',
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

/** Standardized hashrate pricing formatter. */
export function formatHashratePrice(price, currency = 'BTC', unit = 'TH') {
  const cleanUnit = String(unit || 'TH').toUpperCase().replace('S', '');
  return `${parseFloat(price || 0).toFixed(6)} ${currency} / ${cleanUnit} / Day`;
}

/** Calculates the price difference ROI percentage (Positive = Market is more expensive). */
export function calculatePriceComparison(mrrPrice, mrrUnit, nhPrice, nhUnit) {
  const nhPriceNum = Number.parseFloat(nhPrice || 0);
  const mrrPriceNum = Number.parseFloat(mrrPrice || 0);
  if (nhPriceNum <= 0 || mrrPriceNum <= 0) return null;
  const getBaseUnit = (u) => {
    const str = String(u || '').toUpperCase();
    if (str.includes('SHA256')) return 'EH';
    if (str.includes('SCRYPT')) return 'MH';
    if (str.includes('RANDOMX')) return 'KH';
    const m = str.match(/(EH|PH|TH|GH|MH|KH|EHS|PHS|THS|GHS|MHS|E|P|T|G|M|K|H)/);
    if (!m) return 'TH';
    const singleMap = { 'E': 'EH', 'P': 'PH', 'T': 'TH', 'G': 'GH', 'M': 'MH', 'K': 'KH' };
    return singleMap[m[0]] || m[0];
  };
  const mrrP = UNIT_TO_POWER[getBaseUnit(mrrUnit)] ?? -6;
  const nhP = UNIT_TO_POWER[getBaseUnit(nhUnit)] ?? -6;
  const mrrPriceNorm = mrrPriceNum / Math.pow(10, mrrP);
  const nhPriceNorm = nhPriceNum / Math.pow(10, nhP);
  return ((nhPriceNorm - mrrPriceNorm) / nhPriceNorm * 100).toFixed(1);
}