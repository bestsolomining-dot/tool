const DEFAULT_VERIFICATION_LOCATION = 'ANY'
const LOCATION_MAP = {
  EU: 'EUROPE', EUROPE: 'EUROPE',
  USA: 'USA', US: 'USA',
  US_EAST: 'USA_EAST', USA_EAST: 'USA_EAST',
  EUROPE_NORTH: 'EUROPE_NORTH', SOUTH_AMERICA: 'SOUTH_AMERICA',
  ASIA: 'ASIA', ANY: 'ANY',
}

/**
 * Shared API wrapper
 */
export async function apiFetch(path, options = {}) {
  const res = await fetch(path, options);
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  return { ok: res.ok, status: res.status, data, headers: res.headers };
}

/**
 * Pool Data Helpers
 */
export const poolHelpers = {
  getKey: (p, i = 0) => String(p?.id || p?.poolId || p?.name || p?.__generatedId || `gen-${i}`),
  getId: (p) => p?.id || p?.poolId,
  getLabel: (p, i = 0) => String(p?.name || p?.id || p?.poolId || p?.__generatedId || `Pool ${i + 1}`),
  getAlgo: (p) => {
    let val = p?.miningAlgorithm || p?.algorithm || (typeof p === 'string' ? p : null);
    if (val && typeof val === 'object') val = val.code || val.enumName || val.name || 'Unknown';
    let str = String(val || 'Unknown');
    if (str.includes(':')) str = str.split(':').pop().trim();
    return str;
  },

  normalizeList: (data) => {
    let list = []
    if (Array.isArray(data)) list = data
    else if (!data) list = []
    else if (Array.isArray(data.list)) list = data.list
    else if (Array.isArray(data.pools)) list = data.pools
    else if (data.result && Array.isArray(data.result.pools)) list = data.result.pools
    else if (typeof data === 'object') list = Object.values(data)

    return (Array.isArray(list) ? list : []).map((item, index) => {
      const obj = (typeof item === 'object' && !Array.isArray(item)) ? { ...item } : { value: item }
      if (!obj.id && !obj.poolId && !obj.name) obj.__generatedId = `gen-${index}`
      return obj
    })
  },

  getVerifyMessage: (result) => {
    const data = result?.data || result
    if (!data) return 'No response'
    if (data.error) return data.error
    if (data.message) return data.message
    if (data.stopped) return data.message || 'Stopped'
    if (Array.isArray(data.logs) && data.logs.length > 0) {
      return data.logs[data.logs.length - 1]?.message || 'Verification completed'
    }
    return poolHelpers.isVerifySuccess(result) ? 'Verified' : 'Verification failed'
  },

  getVerifyLogs: (result) => {
    const logs = result?.data?.logs || result?.logs
    return Array.isArray(logs) ? logs : []
  },

  getVerifyAlgo: (result) => {
    let val = result?.requestBody?.miningAlgorithm ||
                result?.poolDetails?.miningAlgorithm || 
                result?.poolDetails?.algorithm;

    if (!val) {
      const logs = result?.data?.logs || result?.logs;
      if (Array.isArray(logs)) {
        const found = logs.find(l => l.message && l.message.includes('mining algorithm:'));
        if (found) val = found.message;
      }
    }

    if (val && typeof val === 'object') val = val.code || val.enumName || val.name || 'Unknown';
    let str = String(val || 'Unknown');
    if (str.includes(':')) str = str.split(':').pop().trim();
    return str;
  },
  
  normalizeLocation: (val) => LOCATION_MAP[String(val || '').trim().toUpperCase()] || DEFAULT_VERIFICATION_LOCATION,

  buildVerifyBody: (pool) => !pool ? null : ({
    poolVerificationServiceLocation: poolHelpers.normalizeLocation(
      pool.poolVerificationServiceLocation || pool.serviceLocation || pool.location || pool.market
    ),
    miningAlgorithm: pool.miningAlgorithm || pool.algorithm,
    stratumHost: pool.stratumHost || pool.stratumHostname || pool.host,
    stratumPort: Number(pool.stratumPort || pool.port),
    username: pool.username,
    password: pool.password,
  }),

  buildSaveBody: (pool) => !pool ? null : ({
    ...(pool.id || pool.poolId ? { id: pool.id || pool.poolId } : {}),
    name: pool.name,
    algorithm: pool.algorithm || pool.miningAlgorithm,
    stratumHostname: pool.stratumHostname || pool.stratumHost || pool.host,
    stratumPort: Number(pool.stratumPort || pool.port),
    username: pool.username,
    password: pool.password,
  }),

  getMissingVerifyFields: (p) => Object.entries(p || {})
    .filter(([, v]) => v === undefined || v === null || v === '' || Number.isNaN(v))
    .map(([k]) => k),

  getMissingSaveFields: (p) => ['name', 'algorithm', 'stratumHostname', 'stratumPort', 'username', 'password']
    .filter(k => p?.[k] === undefined || p?.[k] === null || p?.[k] === '' || Number.isNaN(p?.[k])),

  isVerifySuccess: (result) => {
    if (!result || result.ok === false) return false;
    const data = result.data || result;
    return !(data.success === false || data.valid === false || data.error);
  }
};

/**
 * Shared API Actions
 */
export const poolApi = {
  list: () => apiFetch('/api/v2/pools'),
  get: (id) => apiFetch(`/api/v2/pool/${encodeURIComponent(id)}`),
  verify: (body, signal) => apiFetch('/api/v2/pools/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  }),
  save: (body) => apiFetch('/api/v2/pool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }),
  mrrRigs: () => apiFetch('/api/v2/mrr/rigs')
};