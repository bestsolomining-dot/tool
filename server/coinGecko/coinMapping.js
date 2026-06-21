// server/coinGecko/coinMapping.js

export const COIN_TO_COINGECKO_MAP = {
  // Bitcoin and friends
  'BTC': 'bitcoin', 'BITCOIN': 'bitcoin',
  'LTC': 'litecoin', 'LITECOIN': 'litecoin',
  'DOGE': 'dogecoin', 'DOGECOIN': 'dogecoin',
  
  // Ethereum ecosystem
  'ETH': 'ethereum', 'ETHEREUM': 'ethereum',
  'ETC': 'ethereum-classic',
  
  // Privacy coins
  'XMR': 'monero', 'MONERO': 'monero',
  'ZEPH': 'zephyr-protocol', 'ZEPHYR': 'zephyr-protocol',
  'BEAM': 'beam', 'BEAMV3': 'beam',
  
  // GPU mineable
  'RVN': 'ravencoin', 'RAVENCOIN': 'ravencoin',
  'ERG': 'ergo', 'ERGO': 'ergo',
  'KAWPOW': 'ravencoin', 'AUTOLYKOS': 'ergo',
  
  // ASIC resistant
  'KAS': 'kaspa', 'KASPA': 'kaspa', 'KHEAVYHASH': 'kaspa',
  
  // Others
  'IRON': 'iron-fish', 'IRONFISH': 'iron-fish',
  'DYNEX': 'dynex', 'DYNEXSOLVE': 'dynex',
  'ALPH': 'alephium', 'ALEPHIUM': 'alephium',
  'NEXA': 'nexa', 'NEXAPOW': 'nexa',
  'CLORE': 'clore-ai', 'CLOREAI': 'clore-ai',
  'CFX': 'conflux', 'CONFLUX': 'conflux',
  'QRL': 'qrl',
  'XELIS': 'xelis', 'XELISHASHV3': 'xelis',
  'ZANO': 'zano', 'PROGPOWZ': 'zano',
  'SALVIUM': 'monero', 'AIPG': 'aipg', 'KARLSEN': 'kaspa',
  'NEOXA': 'neoxa', 'FISHHASH': 'iron-fish', 'BLAKE3': 'alephium',
  'OCTOPUS': 'conflux', 'VERUSHASH': 'verus', 'VERUS': 'verus',
  'RANDOMX': 'monero', 'CRYPTONIGHT': 'monero',
  'ETCHASH': 'ethereum-classic', 'X11': 'dash',
  'LYRA2REV2': 'vertcoin', 'NEOSCRYPT': 'feathercoin',
  'YESPOWER': 'verus',
};

export const TRACKED_COINS = [
  'bitcoin', 'ethereum', 'monero', 'ravencoin', 'ergo', 'kaspa',
  'beam', 'ethereum-classic', 'litecoin', 'dogecoin',
  'zephyr-protocol', 'iron-fish', 'dynex', 'alephium', 'nexa',
  'clore-ai', 'conflux', 'qrl', 'xelis', 'zano', 'aipg'
];

export function mapCoinToCoinGeckoId(coinName) {
  if (!coinName) return null;
  const upper = coinName.toUpperCase().trim();
  if (COIN_TO_COINGECKO_MAP[upper]) return COIN_TO_COINGECKO_MAP[upper];
  for (const [key, id] of Object.entries(COIN_TO_COINGECKO_MAP)) {
    if (upper.includes(key) || key.includes(upper)) return id;
  }
  return null;
}

export function getCoinGeckoId(coinName, algorithm) {
  let id = mapCoinToCoinGeckoId(coinName);
  if (!id && algorithm) id = mapCoinToCoinGeckoId(algorithm);
  if (!id) {
    const lower = (coinName || '').toLowerCase();
    if (lower.includes('monero') || lower.includes('xmr')) id = 'monero';
    else if (lower.includes('raven') || lower.includes('rvn')) id = 'ravencoin';
    else if (lower.includes('kaspa') || lower.includes('kas')) id = 'kaspa';
    else if (lower.includes('ergo') || lower.includes('erg')) id = 'ergo';
    else if (lower.includes('beam')) id = 'beam';
    else if (lower.includes('etc')) id = 'ethereum-classic';
    else if (lower.includes('eth')) id = 'ethereum';
    else if (lower.includes('btc')) id = 'bitcoin';
  }
  return id;
}