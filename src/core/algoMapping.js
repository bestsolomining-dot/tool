/** Power factor mapping for normalization (EH/s base) */
export const UNIT_TO_POWER = {
  'EH': 0, 'PH': -3, 'TH': -6, 'GH': -9, 'MH': -12, 'KH': -15, 'H': -18,
  'E': 0, 'P': -3, 'T': -6, 'G': -9, 'M': -12,
  'EHS': 0, 'PHS': -3, 'THS': -6, 'GHS': -9, 'MHS': -12
};

/**
 * Shared algorithm mapping between MRR and NiceHash.
 */
export const algoMap = {
  // Common GPU Algorithms
  'ETHASH': 'DAGGERHASHIMOTO',
  'DAGGERHASHIMOTO': 'DAGGERHASHIMOTO',
  'ETCHASH': 'ETCHASH',
  'ETC': 'ETCHASH',
  'ETHEREUMCLASSIC': 'ETCHASH',
  'KAWPOW': 'KAWPOW',
  'RVN': 'KAWPOW',
  'OCTOPUS': 'OCTOPUS',
  'CFX': 'OCTOPUS',
  'AUTOLYKOS': 'AUTOLYKOS',
  'ERG': 'AUTOLYKOS',
  'FISHHASH': 'FISHHASH',

  // Common ASIC Algorithms
  'SHA256': 'SHA256',
  'SHA256ASICBOOST': 'SHA256ASICBOOST',
  'SHA256AB': 'SHA256ASICBOOST',
  'BTC': 'SHA256',
  'SCRYPT': 'SCRYPT',
  'LTC': 'SCRYPT',
  'X11': 'X11',
  'DASH': 'X11',
  'QUARK': 'QUARK',
  'X13': 'X13',
  'KECCAK': 'KECCAK',

  // Equihash Variants
  'EQUIHASH': 'EQUIHASH',
  'ZHASH': 'ZHASH',
  'EQUIHASH1445': 'ZHASH',
  'BEAMV3': 'BEAMV3',
  'EQUIHASH1254': 'BEAMV3',

  // Modern/Newer Algorithms
  'IRONFISH': 'IRONFISH',
  'IRON': 'IRONFISH',
  'ALEPHIUM': 'ALEPHIUM',
  'ALPH': 'ALEPHIUM',
  'KARLSENHASH': 'KARLSENHASH',
  'KLS': 'KARLSENHASH',
  'PYRINHASH': 'PYRINHASH',
  'PYI': 'PYRINHASH',
  'NEXA': 'NEXA'
};

/**
 * Standardizes an algorithm name by removing metadata (like "(ASIC)") 
 * and mapping it to the equivalent NiceHash identifier.
 */
export function normalizeAlgoForNiceHash(algo) {
  if (!algo) return '';
  const cleanAlgo = String(algo).toUpperCase().trim().replace(/\s*\(.*\)/g, '').replace(/[^A-Z0-9]/g, '');
  return algoMap[cleanAlgo] || cleanAlgo;
}

/**
 * Reverse mapping: NiceHash identifier to MRR slug.
 */
export function mapNiceHashToMRR(algo) {
  if (!algo) return '';
  const entry = Object.entries(algoMap).find(([mrr, nh]) => nh === algo.toUpperCase());
  return entry ? entry[0] : algo.toUpperCase();
}

/**
 * Standardized formatter for hashrate pricing.
 * Output Example: 0.010000 BTC / TH / Day
 */
export function formatHashratePrice(price, currency = 'BTC', unit = 'TH') {
  const cleanUnit = String(unit || 'TH').toUpperCase().replace('S', ''); // TH/s -> TH
  return `${parseFloat(price || 0).toFixed(6)} ${currency} / ${cleanUnit} / Day`;
}

/**
 * Reusable logic to calculate the price difference percentage between MRR and NiceHash.
 */
export function calculatePriceComparison(mrrPrice, mrrUnit, nhPrice, nhUnit) {
  const nhPriceNum = Number.parseFloat(nhPrice || 0);
  const mrrPriceNum = Number.parseFloat(mrrPrice || 0);

  if (nhPriceNum <= 0 || mrrPriceNum <= 0) return null;

  // Robustly extract base unit (e.g., 'GH/s' or 'BTC/TH/Day' -> 'GH' or 'TH')
  const clean = (u) => {
    const m = String(u || '').toUpperCase().match(/(EH|PH|TH|GH|MH|KH|H|E|P|T|G|M|K)/);
    if (!m) return 'TH';
    let unit = m[0];
    // Normalize single letters to standard 2-letter codes for mapping
    const singleMap = { 'E': 'EH', 'P': 'PH', 'T': 'TH', 'G': 'GH', 'M': 'MH', 'K': 'KH' };
    return singleMap[unit] || unit;
  };

  const mrrUnitClean = clean(mrrUnit) || 'TH';
  const nhUnitClean = clean(nhUnit) || 'TH';

  // Get power factors (10^n), defaulting to TeraHash (-6 relative to EH)
  const mrrP = UNIT_TO_POWER[mrrUnitClean] ?? -6;
  const nhP = UNIT_TO_POWER[nhUnitClean] ?? -6;

  // Normalize to base unit (H/s equivalent) for fair comparison
  const mrrPriceNorm = mrrPriceNum / Math.pow(10, mrrP);
  const nhPriceNorm = nhPriceNum / Math.pow(10, nhP);

  return ((mrrPriceNorm - nhPriceNorm) / nhPriceNorm * 100).toFixed(1);
}