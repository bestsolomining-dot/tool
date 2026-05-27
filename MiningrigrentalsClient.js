import { request } from 'undici';
import { createHmac, createHash } from 'node:crypto';

export class MiningRigRentalsClient {
  constructor({ apiKey, apiSecret }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = 'https://www.miningrigrentals.com/api/v2';
    this.lastNonce = 0;
  }

  /**
   * Generates a strictly increasing millisecond nonce.
   */
  getNextNonce() {
    const now = Date.now();
    const nonce = now > this.lastNonce ? now : this.lastNonce + 1;
    this.lastNonce = nonce;
    return String(nonce);
  }

  async call({ method = 'GET', endpoint, query = {}, body = null }) {
    const nonce = this.getNextNonce();
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
      const nextNonce = this.getNextNonce();
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