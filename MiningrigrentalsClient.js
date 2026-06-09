import { request } from 'undici';
import { createHmac, createHash } from 'node:crypto';

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
  const now19 = BigInt(Date.now()) * 1000000n;
  let nonce = now19 > lastNonce ? now19 : lastNonce + 1n;

  // Safety: If our last nonce is more than 24 hours in the future compared to 
  // current system time, we likely have a bad baseline and should warn/reset.
  const driftLimit = 24n * 60n * 60n * 1000n * 1000000n;
  if (lastNonce > (now19 + driftLimit)) {
    console.warn(`[mrr] Nonce for ${apiKey.slice(0,6)} is drifted too far into future. Resetting to system time.`);
    nonce = now19;
  }

  mrrLastNonces.set(apiKey, nonce);
  return nonce.toString();
}

export class MiningRigRentalsClient {
  constructor({ apiKey, apiSecret, name = '' }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.clientName = name;
    this.baseUrl = 'https://www.miningrigrentals.com/api/v2';
  }

  async call({ method = 'GET', endpoint, query = {}, body = null, retryCount = 0 }) {
    const requestMethod = method.toUpperCase();
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const cleanPath = path.replace(/\/+$/, '') || '/';

    const sendRequest = async (authType = 'standard', customNonce = null) => {
      const activeNonce = customNonce || getNextSharedNonce(this.apiKey);
      const url = new URL(`${this.baseUrl}${cleanPath}`);
      if (query) {
        Object.entries(query).forEach(([k, v]) => {
          if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
        });
      }

      let headers = {
        'user-agent': 'Ben Tre Mining Tool/2.0',
        'accept': 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      };

      if (authType === 'legacy') {
        const legacySignStr = `${this.apiKey}${activeNonce}${cleanPath}${this.apiSecret}`;
        const legacySig = createHash('sha1').update(legacySignStr).digest('hex');
        headers['x-mrr-key'] = this.apiKey;
        headers['x-mrr-nonce'] = activeNonce;
        headers['x-mrr-signature'] = legacySig;
      } else {
        const signString = `${this.apiKey}${activeNonce}${cleanPath}`;
        const signature = createHmac('sha1', this.apiSecret).update(signString).digest('hex');
        headers['x-api-key'] = this.apiKey;
        headers['x-api-nonce'] = activeNonce;
        headers['x-api-sign'] = signature;
      }

      return request(url.toString(), {
        method: requestMethod,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    };

    let response = await sendRequest('standard');
    let data = await response.body.json();

    // --- Robust Nonce & Auth Recovery ---
    const errorMessage = String(data.message || data.data?.message || '');
    const isBadNonce = errorMessage.includes('Bad Nonce') || response.statusCode === 401 && errorMessage.includes('Nonce');
    
    if (isBadNonce && retryCount < 3) {
      // NUCLEAR JUMP: If we get a Bad Nonce, jump forward by 1 hour worth of microseconds 
      // to get ahead of any server-side clock issues or previous high nonces.
      const jumpValue = (BigInt(Date.now()) + 3600000n) * 1000000n;
      console.log(`[mrr:${this.clientName}] ☢️ NUCLEAR JUMP: Recovering from Bad Nonce. New baseline: ${jumpValue}`);
      mrrLastNonces.set(this.apiKey, jumpValue);
      
      return this.call({ method, endpoint, query, body, retryCount: retryCount + 1 });
    }

    // Legacy Fallback for certain account types
    const isAuthError = !data.success && (
      errorMessage.includes('Signature') ||
      errorMessage.includes('Invalid Key') ||
      errorMessage.includes('not find key') ||
      response.statusCode === 401
    );

    if (isAuthError) {
      console.log(`[mrr:${this.clientName}] HMAC failed, retrying with Legacy SHA1...`);
      response = await sendRequest('legacy');
      data = await response.body.json();
    }

    return { statusCode: response.statusCode, data };
  }
}