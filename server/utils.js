export const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(err => {
    console.error(`[api:error] ${req.method} ${req.originalUrl}`, err);
    const status = err.statusCode || 500;

    if (status === 429 && err.headers) {
      if (err.headers['retry-after']) res.set('Retry-After', err.headers['retry-after']);
      if (err.headers['x-ratelimit-limit']) res.set('X-RateLimit-Limit', err.headers['x-ratelimit-limit']);
    }

    res.status(status).json({ error: err.message });
  });
};

const SENSITIVE_KEYS = new Set(['password', 'apiKey', 'apiSecret', 'secret', 'token']);

export function maskSensitive(value) {
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.has(key) ? '<masked>' : maskSensitive(item),
    ]),
  );
}

export function corsMiddleware(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'X-MRR-Client, Retry-After, X-RateLimit-Limit');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

export function logRequestMiddleware(req, res, next) {
  const start = Date.now();
  const clientTag = String(req.query.client || req.body?.client || 'system').toUpperCase();
  const time = new Date().toLocaleTimeString();
  const body = req.method === 'GET' ? '' : ` body=${JSON.stringify(maskSensitive(req.body || {}))}`;

  console.info(`[${time}] [api:${clientTag}] -> ${req.method} ${req.originalUrl}${body}`);

  res.on('finish', () => {
    console.info(`[${time}] [api:${clientTag}] <- ${res.statusCode} ${req.method} ${req.originalUrl} ${Date.now() - start}ms`);
  });

  next();
}

export function normalizeCredential(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^['"]|['"]$/g, '').trim();
}

export function extractAlgorithmItems(payload, candidateKeys = []) {
  if (!payload || typeof payload !== 'object') return [];

  for (const key of candidateKeys) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const nestedKey of candidateKeys) {
        if (Array.isArray(value[nestedKey])) return value[nestedKey];
      }
    }
  }

  const visited = new WeakSet();
  const queue = [payload];

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);

    if (Array.isArray(node)) {
      if (node.every(item => typeof item === 'object' && (item.algo || item.algorithm || item.name))) {
        return node;
      }
      for (const item of node) {
        if (item && typeof item === 'object') queue.push(item);
      }
    } else {
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          if (value.every(item => typeof item === 'object' && (item.algo || item.algorithm || item.name))) {
            return value;
          }
          for (const item of value) {
            if (item && typeof item === 'object') queue.push(item);
          }
        } else if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }
  }
  return [];
}

export function sanitizeMrrEndpoint(rawEndpoint) {
  const value = String(rawEndpoint || '').trim();
  if (!value) {
    const err = new Error('MRR endpoint is required.');
    err.statusCode = 400;
    throw err;
  }

  const normalized = value.startsWith('/') ? value : `/${value}`;
  return normalized.replace(/\/+$|\/+$/, '') || '/';
}

export function extractRentalInfo(rental) {
  const algo = rental.algo || rental.algorithm || rental.miningAlgorithm || rental.rig?.algo || rental.rig?.algorithm || rental.rig?.type || 'Unknown';
  const type = rental.price_type || rental.price?.type || rental.type || 'Day';
  const duration = rental.length || rental.hours || rental.rig?.hours || '0';
  const rigId = rental.rig?.id || rental.rigid || rental.rig_id || rental.rigId || 'N/A';
  const percent = rental.hashrate?.average?.percent || rental.rig?.hashrate?.average?.percent || rental.percent || '0';
  const priceObj = rental.price || rental.rig?.price || {};
  const currency = priceObj.currency || rental.currency || rental.price_unit || 'BTC';

  // Merge hashrate info from both top level and nested rig object to get the most detail
  const rentalHr = rental.hashrate && typeof rental.hashrate === 'object' ? rental.hashrate : {};
  const rigHashObj = rental.rig?.hashrate || rental.rig?.hash;
  const rigHr = rigHashObj && typeof rigHashObj === 'object' ? rigHashObj : {};

  // Rig hashrate contains the detailed time windows (last_5min, last_15min, etc)
  const hr = { ...rigHr, ...rentalHr };

  let currentHash = 0;
  let advertisedHash = 0;
  let averageHash = 0;
  let hashrateSuffix = hr.suffix || '';

  if (hr && typeof hr === 'object') {
    // Prioritize last 15 minutes as the current hashrate per user request
    currentHash = parseFloat(
      (hr.last_15min && typeof hr.last_15min === 'object' ? hr.last_15min.hash : hr.last_15min) ||
      hr.hashrate || 
      hr.current || 
      hr.hash || 
      0);

    if (hr.advertised && typeof hr.advertised === 'object') {
      advertisedHash = parseFloat(hr.advertised.hash || hr.advertised.hashrate || 0);
      hashrateSuffix = hr.advertised.type || hr.advertised.suffix || '';
    } else {
      advertisedHash = parseFloat(hr.advertised || 0);
    }

    if (hr.average && typeof hr.average === 'object') {
      averageHash = parseFloat(hr.average.hash || hr.average.hashrate || 0);
      hashrateSuffix = hashrateSuffix || hr.average.type || hr.average.suffix || '';
    } else {
      averageHash = parseFloat(hr.average || 0);
    }

    hashrateSuffix = hashrateSuffix || hr.suffix || '';
  } else if (typeof hr === 'number' || typeof hr === 'string') {
    currentHash = parseFloat(hr);
  }

  const niceAdvertisedHashrate = (hr && typeof hr === 'object' && hr.advertised?.nice) ||
    (advertisedHash > 0 ? `${advertisedHash.toFixed(2)} ${hashrateSuffix}`.trim() : '0 N/A');

  const nice5mHashrate = (hr && typeof hr === 'object' && hr.last_5min?.nice) ||
    (hr && typeof hr === 'object' && hr.last_5min ? `${parseFloat(hr.last_5min.hash || hr.last_5min || 0).toFixed(2)} ${hashrateSuffix}`.trim() : '0 N/A');

  const niceHashrate = (hr && typeof hr === 'object' && hr.last_15min?.nice) ||
    (hr && typeof hr === 'object' && hr.nice) ||
    (currentHash > 0 ? `${currentHash.toFixed(2)} ${hashrateSuffix}`.trim() : '0 N/A');

  const nice15mHashrate = niceHashrate;

  const niceAverageHashrate = (hr && typeof hr === 'object' && hr.average?.nice) ||
    (averageHash > 0 ? `${averageHash.toFixed(2)} ${hashrateSuffix}`.trim() : '0 N/A');

  // If efficiency (percent) is missing or '0' but we have hashrate numbers, calculate it manually
  let finalPercent = percent;
  if ((!percent || percent === '0') && advertisedHash > 0) {
    const calc = (averageHash / advertisedHash) * 100;
    finalPercent = calc.toFixed(2);
  }

  return {
    algo,
    type,
    duration,
    rigId,
    startTime: rental.start || rental.start_time || rental.rig?.status?.start || rental.rig?.start || '',
    endTime: rental.end || rental.end_time || rental.rig?.status?.end || rental.rig?.end || '',
    percent: finalPercent,
    hashrate: { current: currentHash, advertised: advertisedHash, average: averageHash, suffix: hashrateSuffix },
    price: {
      paid: priceObj.paid || '0.00',
      advertised: priceObj.advertised || '0.00',
      currency
    },
    niceHashrate,
    nice5mHashrate,
    nice15mHashrate,
    niceAverageHashrate,
    niceAdvertisedHashrate,
  };
}

export function extractRigInfo(payload) {
  const queue = [payload];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;

    const miningAlgorithm = node.miningAlgorithm || node.algorithm || node.algo || '';
    const stratumHost = node.stratumHost || node.stratumHostname || node.host || '';
    const stratumPortRaw = node.stratumPort || node.port;
    const stratumPort = Number(stratumPortRaw);
    const username = node.username || node.user || '';
    const password = node.password || node.pass || '';

    if (miningAlgorithm && stratumHost && Number.isFinite(stratumPort) && username && password) {
      return { miningAlgorithm, stratumHost, stratumPort, username, password };
    }

    if (node.pools && Array.isArray(node.pools)) {
      for (const pool of node.pools) {
        const poolAlgo = pool.algo || pool.algorithm || '';
        const poolHost = pool.stratumHost || pool.host || '';
        const poolUser = pool.username || pool.user || '';
        const poolPass = pool.password || pool.pass || '';
        const poolPortFromHost = (poolHost.match(/:(\d+)$/) || [])[1];
        const poolPort = Number(pool.port || pool.stratumPort || poolPortFromHost || null);

        if (poolAlgo && poolHost && poolUser && poolPass && Number.isFinite(poolPort)) {
          return { miningAlgorithm: poolAlgo, stratumHost: poolHost, stratumPort: poolPort, username: poolUser, password: poolPass };
        }
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }

  return { miningAlgorithm: '', stratumHost: '', stratumPort: null, username: '', password: '' };
}
