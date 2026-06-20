import { normalizeAlgoForNiceHash, getAlgorithmUnit } from "./mapping.js";

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
    const marketParam = market || "USA";

    // Correct endpoint for order book
    const orderData = await callApi(
      `/api/v2/hashpower/orderBook/${nhAlgo}/${marketParam}`,
      {
        query: {
          client: client || "BT",
        },
        silent: true,
      },
    );

    let highestPrice = 0;

    // If the response is a plain number (legacy), use it directly
    if (typeof orderData === 'number') {
      highestPrice = orderData;
    } else if (orderData && typeof orderData === 'object') {
      // The orderBook returns { buy: [...], sell: [...] }
      // Buy orders are typically sorted by price descending, but we take max to be safe.
      const buyOrders = orderData.buy || [];
      if (Array.isArray(buyOrders) && buyOrders.length > 0) {
        const prices = buyOrders
          .map(order => parseFloat(order.price ?? order.fixedPrice ?? order.rate ?? 0))
          .filter(p => p > 0);
        if (prices.length > 0) {
          highestPrice = Math.max(...prices);
        }
      }

      // Fallback: if no buy orders, try sell orders (rare)
      if (highestPrice === 0) {
        const sellOrders = orderData.sell || [];
        if (sellOrders.length > 0) {
          const sellPrice = parseFloat(sellOrders[0]?.price ?? sellOrders[0]?.fixedPrice ?? 0);
          if (sellPrice > 0) highestPrice = sellPrice;
        }
      }

      // Last resort: legacy fields
      if (highestPrice === 0) {
        highestPrice = parseFloat(
          orderData.fixedPrice ||
          orderData.standardPrice?.fast ||
          orderData.standardPrice ||
          orderData.price ||
          0
        );
      }
    }

    const priceUnit = getAlgorithmUnit(nhAlgo);
    return { value: highestPrice, unit: priceUnit };
  } catch (e) {
    console.error(`[marketApi] Failed to fetch market price for ${algo}:`, e);
    return { value: 0, unit: getAlgorithmUnit(algo) };
  }
}