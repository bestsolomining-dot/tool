import { request } from 'undici';
import { createHmac, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ─── Persistent Nonce Store ──────────────────────────────────────────
// All nonces are stored in a local JSON file.
// This guarantees nonces never go backwards, even after restarts.
// Escalation on Bad Nonce automatically catches up with server expectations.
// ─────────────────────────────────────────────────────────────────────

const NONCE_FILE = process.env.MRR_NONCE_FILE || join(process.cwd(), 'mrr_nonces.json');

function readNonceStore() {
  try {
    if (existsSync(NONCE_FILE)) {
      return JSON.parse(readFileSync(NONCE_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error(`[mrr] Nonce file read error: ${err.message}. Starting fresh.`);
  }
  return {};
}

function writeNonceStore(store) {
  try {
    writeFileSync(NONCE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[mrr] Nonce file write error: ${err.message}`);
  }
}

let nonceStore = readNonceStore();

/**
 * Returns the next nonce for the given API key as a string.
 * - First call for a key initialises it to 0 (or MRR_INITIAL_NONCE env if set for legacy reasons).
 * - With forceValue, you can jump to an explicit higher nonce.
 * - Increments by 1 on each normal call.
 * Persists immediately after every change.
 */
function getNextSharedNonce(apiKey, forceValue = null) {
  if (!(apiKey in nonceStore)) {
    // Start from 0 (or env var if you ever need a manual bootstrap)
    nonceStore[apiKey] = process.env.MRR_INITIAL_NONCE || '0';
    console.log(`[mrr] Initializing nonce for ${apiKey.slice(0, 6)}... to ${nonceStore[apiKey]}`);
  }

  let current = BigInt(nonceStore[apiKey]);
  let next;

  if (forceValue !== null) {
    const forced = BigInt(forceValue);
    next = forced > current ? forced : current + 1n;
    console.log(`[mrr] Nonce manually set to ${next} for key ${apiKey.slice(0, 6)}`);
  } else {
    next = current + 1n;
  }

  nonceStore[apiKey] = next.toString();
  writeNonceStore(nonceStore);
  return next.toString();
}

// ─── MiningRigRentals Client ─────────────────────────────────────────

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

    const sendRequest = async (authType = 'standard', nonceOverride = null) => {
      const activeNonce = nonceOverride || getNextSharedNonce(this.apiKey);

      const url = new URL(`${this.baseUrl}${cleanPath}`);
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      });

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

    // ── First attempt: standard HMAC ─────────────────
    let response = await sendRequest('standard');
    let data;
    try { data = await response.body.json(); } catch { data = {}; }

    const errorMessage = String(data.message || data.data?.message || '');
    const isBadNonce = errorMessage.includes('Bad Nonce') ||
                       (response.statusCode === 401 && errorMessage.includes('Nonce'));

    // ── Auto‑escalation on Bad Nonce ─────────────────
    // Instead of dying, we multiply the current nonce by 10 and retry.
    // After a few attempts, the nonce will exceed any high server value.
    if (isBadNonce && retryCount < 5) {
      const currentNonce = BigInt(nonceStore[this.apiKey] || '0');
      // If currentNonce is 0 (first call), start at a large 1e18 to skip low numbers.
      const escalated = currentNonce > 0n ? currentNonce * 10n : 1000000000000000000n;
      console.log(`[mrr:${this.clientName}] 🔁 Bad Nonce – escalating to ${escalated}`);
      // Force store to this new high nonce
      getNextSharedNonce(this.apiKey, escalated.toString());
      return this.call({ method, endpoint, query, body, retryCount: retryCount + 1 });
    }

    // ── Legacy fallback for certain account types ────
    const isAuthError = !data.success && (
      errorMessage.includes('Signature') ||
      errorMessage.includes('Invalid Key') ||
      errorMessage.includes('not find key') ||
      response.statusCode === 401
    );

    if (isAuthError && retryCount === 0) {
      console.log(`[mrr:${this.clientName}] HMAC failed, retrying with Legacy SHA1...`);
      const legacyNonce = nonceStore[this.apiKey] || getNextSharedNonce(this.apiKey);
      response = await sendRequest('legacy', legacyNonce);
      try { data = await response.body.json(); } catch { data = {}; }
    }

    return { statusCode: response.statusCode, data };
  }
}