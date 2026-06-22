// src/core/marketApi.js
import { normalizeAlgoForNiceHash, getAlgorithmUnit } from './mapping.js';

/**
 * Fetches the highest buy order price for a given algorithm from the NiceHash API.
 * Uses the orderBook endpoint to get buy orders and picks the highest price.
 * @param {function} callApi - The API calling function from the context.
 * @param {string} algo - The algorithm name (e.g., 'KAWPOW').
 * @param {string} market - The market (e.g., 'USA' or 'EU').
 * @param {string} client - The client account to use for the API call.
 * @returns {Promise<{value: number, unit: string}>} The highest order price and unit.
 */
export async function fetchMarketPrice(callApi, algo, market, client) {
  try {
    const nhAlgo = normalizeAlgoForNiceHash(algo);
    const priceData = await callApi('/api/v2/hashpower/marketPrice', {
      query: { algorithm: nhAlgo, market: market || 'USA', client: client || 'BT' },
      silent: true
    });

    const rawPrice = priceData?.price || priceData;
    if (rawPrice && !rawPrice.error) {
      const priceValue = parseFloat(rawPrice.fixedPrice || rawPrice.standardPrice?.fast || rawPrice.standardPrice || rawPrice.price || 0);
      const priceUnit = getAlgorithmUnit(nhAlgo);
      return { value: priceValue, unit: priceUnit };
    }

    const priceUnit = getAlgorithmUnit(nhAlgo);
    return { value: highestPrice, unit: priceUnit };
  } catch (e) {
    console.error(`[marketApi] Failed to fetch market price for ${algo}:`, e);
    return { value: 0, unit: getAlgorithmUnit(algo) };
  }
}