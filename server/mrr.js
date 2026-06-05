import { createHash, createHmac } from 'crypto';
import { request } from 'undici';
import { db } from './db.js';
import { normalizeCredential, sanitizeMrrEndpoint } from './utils.js';
import { isAggregate, resolveNhClient, getNiceHashApp } from './nh.js';

const mrrLastNonceByClient = new Map();
const mrrInitTracker = new Set();
let mrrClockOffset = 0n;
let mrrClockSynced = false;
let mrrSyncPromise = null;

export let mrrConfigs = {}; // Declare as mutable
export let defaultMrrClient = 'BT'; // Declare as mutable

const mrrQueueByClient = new Map();
const mrrInstances = new Map(); // This map will store resolved client configs

export function initMrrConfigs(env) {
  mrrConfigs = {
    BT: {
      apiKey: normalizeCredential(env.MRR_KEY_RIG_BT),
      apiSecret: normalizeCredential(env.MRR_SECRET_RIG_BT),
    },
    SL: {
      apiKey: normalizeCredential(env.MRR_KEY_RIG_SL),
      apiSecret: normalizeCredential(env.MRR_SECRET_RIG_SL),
    },
    LN: {
      apiKey: normalizeCredential(env.MRR_KEY_RIG_LN),
      apiSecret: normalizeCredential(env.MRR_SECRET_RIG_LN),
    },
  };

  // Discover and register additional accounts from environment variables
  Object.keys(env).forEach(key => {
    if (key.startsWith('MRR_KEY_RIG_')) {
      const acct = key.replace('MRR_KEY_RIG_', '').toUpperCase();
      if (!mrrConfigs[acct]) {
        mrrConfigs[acct] = {
          apiKey: normalizeCredential(env[key]),
          apiSecret: normalizeCredential(env[`MRR_SECRET_RIG_${acct}`] || env[`MRR_API_SECRET_${acct}`]),
        };
      };
    }
  });

  const defaultMrrClientRaw = String(env.MRR_DEFAULT_CLIENT || 'VN').trim().toUpperCase();
  defaultMrrClient = (function () {
    if (defaultMrrClientRaw === 'VN') return 'VN';
    if (defaultMrrClientRaw === 'SL') return 'SL';
    if (defaultMrrClientRaw === 'LN') return 'LN';
    return mrrConfigs[defaultMrrClientRaw] ? defaultMrrClientRaw : 'BT';
  })();
}

export async function initNonces() {
  return new Promise((resolve) => {
    db.all('SELECT client, last_nonce FROM mrr_nonces', [], (err, rows) => {
      if (!err && rows) {
        rows.forEach(row => {
          try {
            mrrLastNonceByClient.set(row.client, BigInt(row.last_nonce));
            console.log(`[mrr:init] Loaded last nonce baseline for ${row.client}: ${row.last_nonce}`);
          } catch (e) { }
        });
      }
      resolve();
    });
  });
}

function extractEpochMs(payload) {
  const candidates = [
    payload?.data,
    payload?.data?.time,
    payload?.data?.timestamp,
    payload?.data?.server_time,
    payload?.data?.serverTime,
    payload?.time,
    payload?.timestamp,
    payload?.server_time,
    payload?.serverTime,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === '') continue;

    if (typeof candidate === 'object') {
      continue;
    }

    const parsed = Number(candidate);
    if (!Number.isFinite(parsed) || parsed <= 0) continue;

    // API values are usually Unix seconds; tolerate millisecond payloads too.
    return parsed >= 1e12 ? BigInt(Math.trunc(parsed)) : BigInt(Math.trunc(parsed * 1000));
  }

  return null;
}

export async function syncMrrClock() {
  if (mrrClockSynced) return;
  if (mrrSyncPromise) return mrrSyncPromise;
  console.log('[mrr:clock] Synchronizing with MiningRigRentals server time...');
  mrrSyncPromise = (async () => {
    try {
      // Nonces must be close to MRR's server time. Syncing with NiceHash (which may drift) is risky.
      const res = await request('https://www.miningrigrentals.com/api/v2/info/time', {
        headers: { 'user-agent': 'Ben Tre Mining Tool/2.0' },
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`HTTP ${res.statusCode}`);
      }

      const body = await res.body.json();
      const serverTimeMs = extractEpochMs(body) ?? BigInt(Date.now());
      const localTimeMs = Date.now();
      mrrClockOffset = serverTimeMs - BigInt(localTimeMs);
      mrrClockSynced = true;

      if (Math.abs(Number(mrrClockOffset)) > 1000) {
        console.info(`[mrr:clock] Significant drift detected! Offset: ${mrrClockOffset}ms. (MRR Server: ${serverTimeMs}, Local: ${localTimeMs})`);
      } else {
        console.info(`[mrr:clock] Synced with MRR. Offset: ${mrrClockOffset}ms.`);
      }
    } catch (err) {
      console.warn(`[mrr:clock] MRR time sync failed: ${err.message}. Using local clock.`);
      mrrClockSynced = true;
    } finally {
      mrrSyncPromise = null;
    }
  })();

  return mrrSyncPromise;
}

export async function nextMrrNonce(clientName) {
  const cleanName = String(clientName || '').trim().toUpperCase();
  const lastNonce = BigInt(mrrLastNonceByClient.get(cleanName) || 0n);

  if (lastNonce > 99999999999999999999n) {
    console.warn(`[mrr:${cleanName}] Resetting nonsensical high-watermark nonce (${lastNonce}) to 0.`);
    mrrLastNonceByClient.set(cleanName, 0n);
    return nextMrrNonce(cleanName);
  }

  const nowMs = BigInt(Date.now()) + mrrClockOffset;
  const now19 = BigInt(nowMs) * 1000000n;

  // Safety: If the last stored nonce is more than 1 day in the future relative 
  // to our current synced time, reset it to allow recovering from clock jumps.
  const oneDayInNonces = 86400000n * 1000000n;
  if (lastNonce > (now19 + oneDayInNonces)) {
    console.warn(`[mrr:${cleanName}] Database nonce (${lastNonce}) is too far in the future. Resetting to current synced time.`);
    mrrLastNonceByClient.set(cleanName, now19);
    return nextMrrNonce(cleanName);
  }

  let nonce;
  nonce = (now19 > lastNonce) ? now19 : (lastNonce + 1n);

  mrrLastNonceByClient.set(cleanName, nonce);
  await new Promise((resolve) => {
    db.run(
      `INSERT INTO mrr_nonces (client, last_nonce) VALUES (?, ?) 
       ON CONFLICT(client) DO UPDATE SET last_nonce=excluded.last_nonce`,
      [cleanName, nonce.toString()],
      () => resolve(),
    );
  });

  return nonce.toString();
}

export function resolveMrrClient(clientNameRaw) {
  const clientName = isAggregate(clientNameRaw) ? 'VN' : String(clientNameRaw || defaultMrrClient).trim().toUpperCase();
  const lookupSuffix = clientName;

  if (!mrrInstances.has(clientName)) {
    let config = mrrConfigs[clientName];
    const envKey = process.env[`MRR_KEY_RIG_${lookupSuffix}`] || process.env[`MRR_API_KEY_${lookupSuffix}`];
    const envSecret = process.env[`MRR_SECRET_RIG_${lookupSuffix}`] || process.env[`MRR_API_SECRET_${lookupSuffix}`];

    const envNonce = normalizeCredential(
      process.env[`RIG_NOUNCE_${lookupSuffix}`] ||
      process.env[`RIG_NONCE_${lookupSuffix}`] ||
      process.env[`RIG_${lookupSuffix}_NOUNCE`] ||
      process.env[`RIG_${lookupSuffix}_NONCE`] ||
      process.env[`MRR_NOUNCE_${lookupSuffix}`] ||
      process.env[`MRR_NONCE_${lookupSuffix}`]
    );

    if (envKey && envSecret) {
      config = { apiKey: normalizeCredential(envKey), apiSecret: normalizeCredential(envSecret) };
    }

    if (config?.apiKey && config?.apiSecret) {
      mrrInstances.set(clientName, config);
    }
  }

  const clientConfig = mrrInstances.get(clientName);
  if (!clientConfig) {
    if (isAggregate(clientName)) return { clientName, clientConfig: null };
    const err = new Error(`MRR credentials missing for client "${clientName}". Ensure MRR_KEY_RIG_${lookupSuffix} is set.`);
    err.statusCode = 400;
    throw err;
  }

  return { clientName, clientConfig };
}

export async function runMrrCallInOrder(clientName, task) {
  const previous = mrrQueueByClient.get(clientName) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  mrrQueueByClient.set(clientName, current);

  try {
    return await current;
  } finally {
    if (mrrQueueByClient.get(clientName) === current) {
      mrrQueueByClient.delete(clientName);
    }
  }
}

export async function mrrApiCall({ endpoint, method = 'GET', query, body, clientNameRaw }) {
  if (!mrrInitTracker.has(endpoint)) {
    console.log(`[MRR] First-time endpoint delay (2s): ${endpoint}`);
    await new Promise(r => setTimeout(r, 2000));
    mrrInitTracker.add(endpoint);
  }

  if (!mrrClockSynced) {
    await syncMrrClock();
  }

  const { clientName, clientConfig } = resolveMrrClient(clientNameRaw);
  return runMrrCallInOrder(clientName, async () => {
    const normalizedEndpoint = sanitizeMrrEndpoint(endpoint);
    const requestMethod = String(method || 'GET').toUpperCase();
    const hasBody = body !== undefined && body !== null && requestMethod !== 'GET' && requestMethod !== 'DELETE';
    const baseUrl = new URL(`https://www.miningrigrentals.com/api/v2${normalizedEndpoint}`);
    const sigEndpoint = normalizedEndpoint;
    const { client: _c, ts: _t, endpoint: _e, ...cleanQuery } = query || {};

    if (Object.keys(cleanQuery).length > 0) {
      for (const [key, value] of Object.entries(cleanQuery)) {
        if (value === undefined || value === null || value === '') continue;
        baseUrl.searchParams.set(key, String(value));
      }
    }

    const send = async (nStr, sig, authHeaders = {}) => request(baseUrl.toString(), {
      method: requestMethod,
      headers: {
        'user-agent': 'Ben Tre Mining Tool/2.0',
        'accept': 'application/json',
        'cache-control': 'no-store, no-cache, must-revalidate',
        ...authHeaders,
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
    });

    let currentNonce = await nextMrrNonce(clientName);
    let signString = `${clientConfig.apiKey}${currentNonce}${sigEndpoint}`;
    const signatureV2 = createHmac('sha1', clientConfig.apiSecret).update(signString).digest('hex');

    let response = await send(currentNonce, signatureV2, {
      'x-api-key': clientConfig.apiKey,
      'x-api-nonce': currentNonce,
      'x-api-sign': signatureV2,
    });

    let text = await response.body.text();
    let data;
    try {
      data = text ? JSON.parse(text) : { success: false, message: 'Empty response' };
    } catch {
      data = { success: false, message: text };
    }

    let authMessage = String(data?.data?.message || data?.message || '');
    let isAuthFailureMessage = /signature|unauthorized|authenticated|missing api key/i.test(authMessage);
    const isBadNonce = /nonce/i.test(authMessage);
    const shouldRetry = (!data.success && isAuthFailureMessage && !isBadNonce) || response.statusCode === 401;

    if (shouldRetry && !isBadNonce) {
      console.warn(`[mrr:${clientName}] HMAC failed (${authMessage || 'Unauthorized'}), retrying with Legacy SHA1 Concatenation...`);
      currentNonce = await nextMrrNonce(clientName);
      // Correct V1 Legacy concatenation: apiKey + nonce + apiSecret
      const legacyStr = `${clientConfig.apiKey}${currentNonce}${clientConfig.apiSecret}`;
      const legacySig = createHash('sha1').update(legacyStr).digest('hex');

      const retryRes = await send(currentNonce, legacySig, {
        'X-Api-Key': clientConfig.apiKey,
        'X-Api-Nonce': currentNonce,
        'X-Api-Sign': legacySig,
      });
      const retryText = await retryRes.body.text();
      try {
        data = JSON.parse(retryText);
        response = retryRes;
        authMessage = String(data?.data?.message || data?.message || '');
        isAuthFailureMessage = /signature|unauthorized|authenticated|invalid/i.test(authMessage);
      } catch (e) {
        // keep original response if retry isn't JSON
      }
    }

    let finalStatus = response.statusCode;
    if ((data?.success === false || isAuthFailureMessage) && finalStatus < 400) {
      finalStatus = 401;
    }

    const logTime = new Date().toLocaleTimeString();
    console.log(`[${logTime}] [mrr:${clientName}] endpoint=${normalizedEndpoint} nonce=${currentNonce} status=${finalStatus} msg=${authMessage || 'OK'}`);

    return { statusCode: finalStatus, data, clientName };
  });
}

export async function mrrRequest(endpoint, req, res, method = 'GET', body = undefined) {
  const { client: clientQuery, endpoint: _internalPath, ts: _ts, ...forwardQuery } = req.query || {};
  const targetClient = isAggregate(clientQuery) ? defaultMrrClient : clientQuery;
  const { statusCode, data, clientName } = await mrrApiCall({
    endpoint,
    method,
    clientNameRaw: targetClient,
    query: forwardQuery,
    body,
  });
  res.set('X-MRR-Client', clientName);
  res.status(statusCode).json(data);
}

export async function fetchAggregatedRentals(query = {}, clientParam = 'BT') {
  const isAll = isAggregate(clientParam);
  const allClientNames = isAll
    ? Object.keys(mrrConfigs).filter(c => mrrConfigs[c].apiKey && mrrConfigs[c].apiSecret && !isAggregate(c))
    : [clientParam];

  const allRentals = [];
  const errors = [];

  const { ts: _t, client: _c, ...mrrQuery } = query || {};

  for (const clientName of allClientNames) {
    try {
      const results = [];
      
      // If a specific type is requested, use it; otherwise fetch both bought and sold
      const typesToFetch = mrrQuery.type ? [mrrQuery.type] : ['bought', 'sold'];
      
      for (const type of typesToFetch) {
        const { data, statusCode } = await mrrApiCall({ 
          endpoint: '/rental', 
          method: 'GET', 
          clientNameRaw: clientName, 
          query: { ...mrrQuery, type } 
        });

        if (statusCode === 200 && data.success) {
          const list = Array.isArray(data.data) ? data.data : (data.data?.rentals || []);
          results.push(...list);
        } else if (!isAll && typesToFetch.length === 1) {
          return { statusCode, data, clientName };
        }
      }

      if (results.length > 0) {
        // De-duplicate if fetching multiple types
        const uniqueList = Array.from(new Map(results.map(r => [String(r.id), r])).values());
        uniqueList.forEach(r => r.mrrClient = clientName);
        
        const rentalIds = uniqueList.map(r => r.id).join(';');
          const { data: poolsData } = await mrrApiCall({ endpoint: `/rental/${rentalIds}/pool`, clientNameRaw: clientName });
          if (poolsData && poolsData.success) {
            const poolItems = Array.isArray(poolsData.data) ? poolsData.data : (Array.isArray(poolsData.data?.result) ? poolsData.data.result : []);
            const poolMap = new Map(poolItems.map(item => [String(item.rigid || item.id || item.rentalid || item.rental_id), item.pools]));
            uniqueList.forEach(r => {
              const pools = poolMap.get(String(r.id));
              if (pools && pools.length > 0) {
                const p0 = pools.find(p => p.priority === 0 || p.priority === '0') || pools[0];
                r.host = p0.host || p0.stratumHost;
                r.port = p0.port || p0.stratumPort;
                r.user = p0.user || p0.username;
              }
            });
          }
        allRentals.push(...uniqueList);
      }
    } catch (err) {
      if (!isAll) throw err;
      errors.push({ client: clientName, message: err.message });
    }
  }

  return {
    statusCode: 200,
    data: { success: true, data: { rentals: allRentals }, errors: errors.length > 0 ? errors : undefined },
    clientName: isAll ? 'ALL' : clientParam,
  };
}
