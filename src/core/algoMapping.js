/**
 * Shared algorithm mapping between MRR and NiceHash.
 */
export const algoMap = {
  'ETHASH': 'DAGGERHASHIMOTO',
  'EQUIHASH1445': 'ZHASH',
  'EQUIHASH1254': 'BEAMV3',
  'SHA256': 'SHA256',
  'SCRYPT': 'SCRYPT',
  'KAWPOW': 'KAWPOW',
  'ETCHASH': 'ETCHASH'
};

/**
 * Standardizes an algorithm name by removing metadata (like "(ASIC)") 
 * and mapping it to the equivalent NiceHash identifier.
 */
export function normalizeAlgoForNiceHash(algo) {
  if (!algo) return '';
  const cleanAlgo = String(algo).toUpperCase().replace(/\s*\(.*\)/g, '').replace(/[^A-Z0-9]/g, '');
  return algoMap[cleanAlgo] || cleanAlgo;
}

export function mapNiceHashToMRR(algo) { return algo; } // Placeholder for existing references