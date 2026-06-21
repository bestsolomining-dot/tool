import { request } from "undici";
import { createHmac, createHash } from "node:crypto";

// Shared state to track nonces across client instances and prevent "Bad Nonce"
// errors when multiple calls happen in the same millisecond or clients are re-instantiated.
const mrrLastNonces = new Map();

/**
 * Shared Nonce Provider Logic
 * Generates a 19-digit high-precision nonce (ms * 1,000,000) to satisfy MRR requirements.
 */
function getNextSharedNonce(apiKey, forceJumpValue = null) {
  const lastNonce = BigInt(mrrLastNonces.get(apiKey) || 0n);

  // If we were explicitly told to jump (e.g. after a Bad Nonce error)
  if (forceJumpValue) {
    const jumped = BigInt(forceJumpValue);
    const final = jumped > lastNonce ? jumped : lastNonce + 1000000n;
    mrrLastNonces.set(apiKey, final);
    return final.toString();
  }

  // Standardize on 19-digit nonces (Microseconds)
  // ms * 1,000,000 ensures we are always in the same magnitude
  // Add a small buffer (e.g., 100ms) to 'now' to avoid race conditions
  const now19 = (BigInt(Date.now()) + 100n) * 1000000n;
  // The new nonce is always guaranteed to be greater than the last one.
  const nonce = now19 > lastNonce ? now19 : lastNonce + 1n;

  mrrLastNonces.set(apiKey, nonce);
  return nonce.toString();
}

export class MiningRigRentalsClient {
  constructor({ apiKey, apiSecret, name = "" }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.clientName = name;
    this.baseUrl = "https://www.miningrigrentals.com/api/v2";
  }

  async call({
    method = "GET",
    endpoint,
    query = {},
    body = null,
    retryCount = 0,
  }) {
    const requestMethod = method.toUpperCase();
    const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const cleanPath = path.replace(/\/+$/, "") || "/";

    const sendRequest = async (authType = "standard", customNonce = null) => {
      const activeNonce = customNonce || getNextSharedNonce(this.apiKey);
      const url = new URL(`${this.baseUrl}${cleanPath}`);
      if (query) {
        Object.entries(query).forEach(([k, v]) => {
          if (v !== undefined && v !== null && v !== "")
            url.searchParams.set(k, String(v));
        });
      }

      let headers = {
        "user-agent": "Ben Tre Mining Tool/2.0",
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      };

      if (authType === "legacy") {
        const legacySignStr = `${this.apiKey}${activeNonce}${cleanPath}${this.apiSecret}`;
        const legacySig = createHash("sha1")
          .update(legacySignStr)
          .digest("hex");
        headers["x-mrr-key"] = this.apiKey;
        headers["x-mrr-nonce"] = activeNonce;
        headers["x-mrr-signature"] = legacySig;
      } else {
        const signString = `${this.apiKey}${activeNonce}${cleanPath}`;
        const signature = createHmac("sha1", this.apiSecret)
          .update(signString)
          .digest("hex");
        headers["x-api-key"] = this.apiKey;
        headers["x-api-nonce"] = activeNonce;
        headers["x-api-sign"] = signature;
      }

      return request(url.toString(), {
        method: requestMethod,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    };

    let response = await sendRequest("standard");
    let data = await response.body.json();

    // --- Robust Nonce & Auth Recovery ---
    const errorMessage = String(data.message || data.data?.message || "");
    const isBadNonce =
      errorMessage.includes("Bad Nonce") ||
      (response.statusCode === 401 &&
        (errorMessage.includes("Nonce") ||
          /signature|invalid|key/i.test(errorMessage)));

    if (isBadNonce && retryCount < 3) {
      // NUCLEAR JUMP: If we get a Bad Nonce, jump forward by 90 days worth of nanoseconds
      // to get ahead of any server-side clock issues or previous high nonces.
      const jumpValue = (BigInt(Date.now()) + 19976000000n) * 1000000n;
      console.log(
        `[mrr:${this.clientName}] ☢️ NUCLEAR JUMP: Recovering from Bad Nonce. New baseline: ${jumpValue} (+90d)`,
      );
      mrrLastNonces.set(this.apiKey, jumpValue);

      return this.call({
        method,
        endpoint,
        query,
        body,
        retryCount: retryCount + 1,
      });
    }

    // Legacy Fallback for certain account types
    const isAuthError =
      !data.success &&
      (errorMessage.includes("Signature") ||
        errorMessage.includes("Invalid Key") ||
        errorMessage.includes("not find key") ||
        response.statusCode === 401);

    if (isAuthError) {
      console.log(
        `[mrr:${this.clientName}] HMAC failed, retrying with Legacy SHA1...`,
      );
      response = await sendRequest("legacy");
      data = await response.body.json();
    }

    return { statusCode: response.statusCode, data };
  }
}
