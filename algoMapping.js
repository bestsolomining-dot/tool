/**
 * Mapping of NiceHash algorithm names to MiningRigRentals algorithm slugs.
 * 
 * NiceHash Algorithm list: GET /main/api/v2/mining/algorithms
 * MRR Algorithm list: https://www.miningrigrentals.com/api/v2/info/algos
 */
const NH_TO_MRR_MAP = {
  'SHA256': 'sha256',
  'SCRYPT': 'scrypt',
  'X11': 'x11',
  'X13': 'x13',
  'KECCAK': 'keccak',
  'NEOSCRYPT': 'neoscrypt',
  'QUBIT': 'qubit',
  'QUARK': 'quark',
  'LYRA2REv2': 'lyra2rev2',
  'LYRA2REv3': 'lyra2rev3',
  'BLAKE2S': 'blake2s',
  'LBRY': 'lbry',
  'EQUHASH': 'equihash',
  'ZHASH': 'equihash1445', // NiceHash ZHash maps to MRR Equihash 144,5
  'BEAMV3': 'beamv3',
  'KAWPOW': 'kawpow',
  'RANDOMXMONERO': 'randomx',
  'OCTOPUS': 'octopus',
  'AUTOLYKOS': 'autolykos2',
  'ETCHASH': 'etchash',
  'SHA256ASICBOOST': 'sha256',
  'HANDSHAKE': 'handshake',
  'SCRYPTNCRYPT': 'scryptn',
};

/**
 * Maps a NiceHash algorithm name to its MRR equivalent slug.
 * Defaults to lowercase of the input if no explicit mapping exists.
 * 
 * @param {string} nhAlgo - The NiceHash algorithm name (e.g., "KAWPOW")
 * @returns {string} The MRR algorithm slug (e.g., "kawpow")
 */
export function mapNiceHashToMRR(nhAlgo) {
  if (!nhAlgo) return '';
  
  const upperAlgo = nhAlgo.toUpperCase();
  
  if (NH_TO_MRR_MAP[upperAlgo]) {
    return NH_TO_MRR_MAP[upperAlgo];
  }

  // Fallback for algos where the name is the same but case differs
  return nhAlgo.toLowerCase();
}
