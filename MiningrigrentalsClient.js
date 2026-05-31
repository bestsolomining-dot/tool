import { request } from 'undici';
import { createHmac, createHash } from 'node:crypto';

// Shared state to track nonces across client instances and prevent "Bad Nonce"
// errors when multiple calls happen in the same millisecond or clients are re-instantiated.
const mrrLastNonces = new Map();

/**
 * Shared Nonce Provider Logic
 * Generates a 19-digit high-precision nonce (ms * 1,000,000) to satisfy MRR requirements.
 */
function getNextSharedNonce(apiKey, clientHint = '') {
  const cleanHint = String(clientHint || '').trim().toUpperCase();
  const lastNonce = BigInt(mrrLastNonces.get(apiKey) || 0n);
  const nowMs = BigInt(Date.now());

  let nonce;
  if (['BT', 'ALL', 'VN'].includes(cleanHint) || lastNonce > 100000000000000n) {
    const now19 = nowMs * 1000000n;
    nonce = now19 > lastNonce ? now19 : lastNonce + 1n;
  } else {
    const now14 = nowMs * 10n;
    nonce = now14 > lastNonce ? now14 : lastNonce + 1n;
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

  async call({ method = 'GET', endpoint, query = {}, body = null }) {
    const nonce = getNextSharedNonce(this.apiKey, this.clientName);
    const requestMethod = method.toUpperCase();

    // Ensure endpoint starts with / and remove trailing slashes for signature
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const cleanPath = path.replace(/\/+$/, '') || '/';

    const signString = `${this.apiKey}${nonce}${cleanPath}`;
    const signature = createHmac('sha1', this.apiSecret).update(signString).digest('hex');

    const url = new URL(`${this.baseUrl}${cleanPath}`);
    if (query) {
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      });
    }

    const sendRequest = async (authHeaders) => {
      return request(url.toString(), {
        method: requestMethod,
        headers: {
          'user-agent': 'Ben Tre Mining Tool/2.0',
          'accept': 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
          'x-api-key': this.apiKey,
          'x-api-nonce': nonce,
          'x-api-sign': signature,
          ...authHeaders // Allow overrides
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    };

    let response = await sendRequest({
      'x-api-key': this.apiKey,
      'x-api-nonce': nonce,
      'x-api-sign': signature,
    });

    let data = await response.body.json();

    // --- Legacy Fallback ---
    // Some account types or endpoints require the older SHA1(key + nonce + endpoint + secret) format
    const isAuthError = !data.success && (
      data.message?.includes('Signature') ||
      data.data?.message?.includes('Signature') ||
      response.statusCode === 401
    );

    if (isAuthError) {
      const nextNonce = getNextSharedNonce(this.apiKey, this.clientName);
      const legacySignStr = `${this.apiKey}${nextNonce}${cleanPath}${this.apiSecret}`;
      const legacySig = createHash('sha1').update(legacySignStr).digest('hex');

      response = await sendRequest({
        'x-mrr-key': this.apiKey,
        'x-mrr-nonce': nextNonce,
        'x-mrr-signature': legacySig,
      });
      data = await response.body.json();
    }

    return { statusCode: response.statusCode, data };
  }
}