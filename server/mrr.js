import { createHash, createHmac } from 'crypto';
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

const mrrGlobalQueue = Promise.resolve(); // Hàng đợi duy nhất cho toàn bộ hệ thống MRR
let mrrGlobalCounter = 0; // Biến đếm phụ để chống trùng lặp tuyệt đối

// --- Cache and In-flight request tracking to reduce API hammering ---
const mrrRequestCache = new Map();
const mrrInflight = new Map();
const MRR_CACHE_TTL = 10000; // 10 seconds cache
const MRR_NONCE_RECOVERY_JUMP = 600000000000n; // 10 PHÚT - Nhảy vọt cực mạnh để phá băng Bad Nonce

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
            // Nonce state is tracked by API Key. If the row key looks like a label (e.g., 'BT'),
            // it's likely from an older version of the tool and should be ignored to prevent conflicts.
            if (row.client.length > 10) {
              mrrLastNonceByClient.set(row.client, BigInt(row.last_nonce));
              console.log(`[mrr:init] Loaded nonce baseline for Key ${row.client.slice(0, 8)}...: ${row.last_nonce}`);
            }
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

/** Synchronizes local clock with MRR server time. */
export async function syncMrrClock(force = false) {
  if (mrrClockSynced && !force) return;
  if (mrrSyncPromise) return mrrSyncPromise;
  console.log('[mrr:clock] Synchronizing with MiningRigRentals server time...');
  mrrSyncPromise = (async () => {
    try {
      // Nonces must be close to MRR's server time. Syncing with NiceHash (which may drift) is risky.
      const res = await fetch('https://www.miningrigrentals.com/api/v2/info/time', {
        headers: { 'user-agent': 'Ben Tre Mining Tool/2.0' },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const body = await res.json();
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

/**
 * Generates a strictly increasing nonce for a specific API Key.
 * Keying by API Key prevents collisions if multiple client names share the same credentials.
 */
export function nextMrrNonce(apiKey, clientLabel) {
  if (!apiKey) return (BigInt(Date.now()) * 1000000n).toString();
  
  const lastNonce = BigInt(mrrLastNonceByClient.get(apiKey) || 0n);

  // Safety: Nếu nonce trong DB/Map quá lớn (> 19 chữ số) hoặc quá xa tương lai (> 24h), reset về hiện tại.
  const oneDayNano = 24n * 60n * 60n * 1000n * 1000000n;
  const nowNano = (BigInt(Date.now()) + mrrClockOffset) * 1000000n;
  if (lastNonce > 9999999999999999999n || lastNonce > (nowNano + oneDayNano)) {
    console.warn(`[mrr:${clientLabel}] Resetting outlier/future high-watermark nonce (${lastNonce}) to current time.`);
    mrrLastNonceByClient.set(apiKey, nowNano);
  }

  const nowMs = BigInt(Date.now()) + mrrClockOffset;
  const now19 = BigInt(nowMs) * 1000000n;

  // Đảm bảo nonce luôn tăng và cộng thêm biến đếm toàn cục để tránh va chạm mili giây
  mrrGlobalCounter = (mrrGlobalCounter + 1) % 1000;
  const baseNonce = (now19 > lastNonce) ? now19 : (lastNonce + 1000n);
  const nonce = baseNonce + BigInt(mrrGlobalCounter);

  mrrLastNonceByClient.set(apiKey, nonce); // Update synchronously to block concurrent reads
  
  // Async DB update - don't block the API thread
  new Promise((resolve) => {
    db.run(
      `INSERT INTO mrr_nonces (client, last_nonce) VALUES (?, ?)
       ON CONFLICT(client) DO UPDATE SET last_nonce=excluded.last_nonce`,
      [apiKey, nonce.toString()], // Use apiKey as the unique ID for DB storage
      () => resolve(),
    );
  });

  return nonce.toString();
}

function getFallbackRealAccount() {
  return Object.keys(mrrConfigs).find(k => !isAggregate(k) && mrrConfigs[k].apiKey && mrrConfigs[k].apiSecret) || 'BT';
}

export function resolveMrrClient(clientNameRaw) {
  let clientName = String(clientNameRaw || defaultMrrClient).trim().toUpperCase();

  // Single-client operations cannot use aggregate handles; resolve to a real account
  if (isAggregate(clientName)) {
    clientName = isAggregate(defaultMrrClient) ? getFallbackRealAccount() : defaultMrrClient;
  }

  if (!mrrInstances.has(clientName)) {
    let config = mrrConfigs[clientName];
    const envKey = process.env[`MRR_KEY_RIG_${clientName}`] || process.env[`MRR_API_KEY_${clientName}`];
    const envSecret = process.env[`MRR_SECRET_RIG_${clientName}`] || process.env[`MRR_API_SECRET_${clientName}`];

    if (envKey && envSecret) {
      config = { apiKey: normalizeCredential(envKey), apiSecret: normalizeCredential(envSecret) };
    }

    if (config?.apiKey && config?.apiSecret) {
      mrrInstances.set(clientName, config);
    }
  }

  const clientConfig = mrrInstances.get(clientName);
  if (!clientConfig) {
    const err = new Error(`MRR credentials missing for client "${clientName}".`);
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
  const requestMethod = String(method || 'GET').toUpperCase();
  const isCacheable = requestMethod === 'GET';

  const { clientName, clientConfig } = resolveMrrClient(clientNameRaw);
  const apiKey = clientConfig?.apiKey;

  // 1. Loại bỏ các tham số nhiễu (ts, client) để tạo Cache Key ổn định
  const { client: _c, ts: _t, endpoint: _e, ...cleanQuery } = query || {};
  const cacheKey = `${apiKey || clientName}:${requestMethod}:${endpoint}:${JSON.stringify(cleanQuery)}:${JSON.stringify(body || {})}`;

  // 2. CATCH LOADING: Nếu đang có request tương tự, đợi nó thay vì bắn request mới
  if (isCacheable && !endpoint.includes('/rental/')) { // Đừng cache chi tiết rental quá lâu
    const cached = mrrRequestCache.get(cacheKey);
    if (cached && Date.now() < cached.expires) return cached.data;

    const inflight = mrrInflight.get(cacheKey);
    if (inflight) return inflight;
  }

  const task = (async () => {
    // Throttle: Chỉ delay 1s cho lần đầu tiên gọi endpoint cụ thể
  const trackingBase = endpoint.split('\n')[0].trim(); // In case endpoint has extra whitespace or newlines
  const trackingEndpoint = trackingBase
    .replace(/\/(rig|rental)\/[^/]+\/pool/, '/$1/:id/pool')
    .replace(/\/(rig|rental)\/[0-9;]+$/, '/$1/:id')
    .replace(/\/(rig|rental)\/[0-9;]+\/info$/, '/$1/:id/info');

  if (!mrrInitTracker.has(trackingEndpoint)) {
    console.log(`[MRR] First-time endpoint delay (1s): ${trackingEndpoint}`);
    await new Promise(r => setTimeout(r, 1000));
    mrrInitTracker.add(trackingEndpoint);
  }

  if (!mrrClockSynced) {
    await syncMrrClock();
  }

  // 3. GLOBAL SERIALIZATION: Ép mọi request MRR phải chạy nối đuôi nhau
  // Điều này loại bỏ hoàn toàn khả năng 2 request bắn cùng 1 lúc gây Bad Nonce
  const lockKey = "GLOBAL_MRR_LOCK"; 

  return runMrrCallInOrder(lockKey, async () => {
    const normalizedEndpoint = sanitizeMrrEndpoint(endpoint);
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

    const send = async (nStr, sig, authHeaders = {}) => fetch(baseUrl.toString(), {
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

    let currentNonce = nextMrrNonce(clientConfig.apiKey, clientName);
    let signString = `${clientConfig.apiKey}${currentNonce}${sigEndpoint}`;
    const signatureV2 = createHmac('sha1', clientConfig.apiSecret).update(signString).digest('hex');

    let response = await send(currentNonce, signatureV2, {
      'x-api-key': clientConfig.apiKey,
      'x-api-nonce': currentNonce,
      'x-api-sign': signatureV2,
    });

    let text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : { success: false, message: 'Empty response' };
    } catch {
      data = { success: false, message: text };
    }

    let authMessage = String(data?.data?.message || data?.message || '');
    let isAuthFailureMessage = /signature|unauthorized|authenticated|missing api key/i.test(authMessage);
    const isBadNonce = /nonce/i.test(authMessage);

    // Optimizer: If "Bad Nonce" is received, force clock re-sync and retry ONCE.
    if (isBadNonce || (response.status === 401 && /nonce/i.test(text))) {
      // Force immediate clock re-sync
      await syncMrrClock(true);
      
      const nowNano = (BigInt(Date.now()) + mrrClockOffset + 1000n) * 1000000n;
      const failedNonce = BigInt(currentNonce);
      
      // Lấy giá trị lớn nhất giữa (nonce vừa xịt, thời điểm hiện tại) rồi cộng thêm 10 phút
      const baseForJump = failedNonce > nowNano ? failedNonce : nowNano;
      const newJumpedNonce = baseForJump + MRR_NONCE_RECOVERY_JUMP;

      console.warn(`[mrr:${clientName}] ☢️ NUCLEAR JUMP: Baseline reset to ${newJumpedNonce} (+10m) for key ${clientConfig.apiKey.slice(0, 6)}...`);
      mrrLastNonceByClient.set(clientConfig.apiKey, newJumpedNonce);
      db.run('INSERT OR REPLACE INTO mrr_nonces (client, last_nonce) VALUES (?, ?)', [clientConfig.apiKey, newJumpedNonce.toString()]);

      currentNonce = nextMrrNonce(clientConfig.apiKey, clientName);
      signString = `${clientConfig.apiKey}${currentNonce}${sigEndpoint}`;
      const retrySig = createHmac('sha1', clientConfig.apiSecret).update(signString).digest('hex');

      const retryRes = await send(currentNonce, retrySig, {
        'x-api-key': clientConfig.apiKey,
        'x-api-nonce': currentNonce,
        'x-api-sign': retrySig,
      });

      const retryText = await retryRes.text();
      try {
        data = JSON.parse(retryText);
        if (data.success) {
          return { statusCode: 200, data, clientName };
        }
        
        // If it still fails after a jump and clock sync, it's NOT a nonce error.
        const secondMsg = String(data?.data?.message || data?.message || '');
        if (retryRes.status === 401) {
          console.error(`[mrr:${clientName}] Permanent Auth failure for key ${clientConfig.apiKey.slice(0, 6)}... - Check if API Key/Secret are valid.`);
          return { statusCode: 401, data: { ...data, message: "Invalid Credentials (checked via Nonce Reset)" }, clientName };
        }
      } catch (e) { 
        return { statusCode: retryRes.status, data: { success: false, message: "Recovery failed" }, clientName };
      }
    }

    const shouldRetry = (!data.success && isAuthFailureMessage && !isBadNonce) || response.status === 401;

    if (shouldRetry && !isBadNonce) {
      console.warn(`[mrr:${clientName}] HMAC failed (${authMessage || 'Unauthorized'}), retrying with Legacy SHA1 Concatenation...`);
      currentNonce = nextMrrNonce(clientConfig.apiKey, clientName);
      // Correct V1 Legacy concatenation: apiKey + nonce + apiSecret
      const legacyStr = `${clientConfig.apiKey}${currentNonce}${clientConfig.apiSecret}`;
      const legacySig = createHash('sha1').update(legacyStr).digest('hex');

      const retryRes = await send(currentNonce, legacySig, {
        'X-Api-Key': clientConfig.apiKey,
        'X-Api-Nonce': currentNonce,
        'X-Api-Sign': legacySig,
      });
      const retryText = await retryRes.text();
      try {
        data = JSON.parse(retryText);
        response = retryRes;
        authMessage = String(data?.data?.message || data?.message || '');
        isAuthFailureMessage = /signature|unauthorized|authenticated|invalid/i.test(authMessage);
      } catch (e) {
        // keep original response if retry isn't JSON
      }
    }

    let finalStatus = response.status;
    if ((data?.success === false || isAuthFailureMessage) && finalStatus < 400) {
      finalStatus = 401;
    }

    const logTime = new Date().toLocaleTimeString();
    console.log(`[${logTime}] [mrr:${clientName}] endpoint=${normalizedEndpoint} nonce=${currentNonce} status=${finalStatus} msg=${authMessage || 'OK'}`);

    return { statusCode: finalStatus, data, clientName };
  });
  })();

  if (isCacheable) {
    mrrInflight.set(cacheKey, task);
  }

  try {
    const result = await task;
    if (isCacheable && result.statusCode === 200 && result.data?.success) {
      mrrRequestCache.set(cacheKey, { data: result, expires: Date.now() + MRR_CACHE_TTL });
    }
    return result;
  } finally {
    if (isCacheable) {
      mrrInflight.delete(cacheKey);
    }
  }
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

  const fetchSingleAccount = async (clientName) => {
    const localRentals = [];
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
        localRentals.push(...list);
      }
    }

    if (localRentals.length > 0) {
      const uniqueList = Array.from(new Map(localRentals.map(r => [String(r.id), r])).values());
      uniqueList.forEach(r => r.mrrClient = clientName);
      
      const rentalIds = uniqueList.map(r => r.id).join(';');
      const { data: poolsData } = await mrrApiCall({ endpoint: `/rental/${rentalIds}/pool`, clientNameRaw: clientName });
      if (poolsData?.success) {
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
      return uniqueList;
    }
    return [];
  };

  const results = await Promise.all(allClientNames.map(async (clientName) => {
    try {
      const rentals = await fetchSingleAccount(clientName);
      return { rentals };
    } catch (err) {
      return { error: { client: clientName, message: err.message } };
    }
  }));

  results.forEach(res => {
    if (res.rentals) allRentals.push(...res.rentals);
    if (res.error) errors.push(res.error);
  });

  return {
    statusCode: 200,
    data: { success: true, data: { rentals: allRentals }, errors: errors.length > 0 ? errors : undefined },
    clientName: isAll ? 'ALL' : clientParam,
  };
}
