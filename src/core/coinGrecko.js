/**
 * JavaScript Client for fetching coin prices from CoinGecko.
 * Corrects the invalid Java implementation previously found in this file.
 */
export async function getSimplePrice(ids, vsCurrencies = "usd,btc") {
  const isPro = process.env.COINGECKO_PRO === "true";
  const apiKey = process.env.COINGECKO_API_KEY || "";
  const baseUrl = isPro
    ? "https://pro-api.coingecko.com/api/v3"
    : "https://api.coingecko.com/api/v3";
  const headerName = isPro ? "x-cg-pro-api-key" : "x-cg-demo-api-key";

  const params = new URLSearchParams({
    ids,
    vs_currencies: vsCurrencies,
    include_24hr_change: "true",
  });

  const url = `${baseUrl}/simple/price?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        [headerName]: apiKey,
      },
    });

    if (response.status === 429) throw new Error("Rate limit exceeded.");
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error("[CoinGecko] Request failed:", error.message);
    throw error;
  }
}

/**
 * Fetches current prices for calculator assets: BTC, DOGE, LTC, ETH, BCH.
 * Useful for server-side aggregation or background tasks.
 */
export async function getCalculatorPrices() {
  const ids = "bitcoin,dogecoin,litecoin,ethereum,bitcoin-cash";
  return getSimplePrice(ids, "usd,btc");
}
