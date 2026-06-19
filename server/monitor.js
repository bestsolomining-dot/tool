import { db } from './db.js';
import { mrrApiCall, mrrConfigs } from './mrr.js';
import { resolveNhClient, getNiceHashApp, isAggregate, nhConfigs } from './nh.js';
import { extractRentalInfo, extractRigInfo } from './utils.js';
import { TELEGRAM_CONFIG, TelegramTemplates } from '../src/core/telegram.js';
import { ALGO_DISPLAY_NAMES, HASHRATE_SUFFIXES, normalizeAlgoForNiceHash, getMrrAlgorithmUnit, calculatePriceComparison } from '../src/core/mapping.js';
import { getBtcPriceData } from '../src/core/priceUtils.js';

const getAlgoDisplayName = (code) => {
  if (!code) return 'N/A';
  const uc = String(code).toUpperCase();
  return ALGO_DISPLAY_NAMES[uc] || code;
};

const cleanHashrateUnit = (unit) => {
  const match = String(unit || '').toUpperCase().match(/GSOL|MSOL|KSOL|SOL|EH|PH|TH|GH|MH|KH|H/);
  return match?.[0] || 'H';
};

const convertHashrateValue = (value, fromUnit, toUnit) => {
  const fromMultiplier = HASHRATE_SUFFIXES[cleanHashrateUnit(fromUnit)] || 1;
  const toMultiplier = HASHRATE_SUFFIXES[cleanHashrateUnit(toUnit)] || 1;
  return value * fromMultiplier / toMultiplier;
};

const resolveRentalAlgo = (r, info) =>
  info?.algo || r?.algo || r?.algorithm || r?.miningAlgorithm || r?.rig?.type || r?.rig?.algo || r?.type || 'N/A';

function getRentalIdFromRig(rig) {
  const candidates = [
    rig?.status?.rentalid,
    rig?.status?.rental_id,
    rig?.status?.rentalId,
    rig?.rentalid,
    rig?.rental_id,
    rig?.rentalId,
    rig?.current_rental_id,
    rig?.currentRentalId,
    rig?.rental?.id,
  ];

  const found = candidates.find(value => value !== undefined && value !== null && String(value).trim() !== '' && String(value).trim() !== '0');
  return found === undefined ? '' : String(found).trim();
}

function getRigLookupKeys(rental, fallbackId = '') {
  return [
    rental?.id,
    rental?.rentalid,
    rental?.rental_id,
    rental?.rentalId,
    rental?.rigid,
    rental?.rig_id,
    rental?.rigId,
    rental?.rig?.id,
    fallbackId,
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function isRentalFinished(now, endTs, sourceRig) {
  if (endTs > 0) return now >= endTs;

  const statusRaw = sourceRig?.status;
  const status = String(typeof statusRaw === 'object' ? statusRaw.status : statusRaw || '').toLowerCase();
  const hasLiveRentalId = Boolean(getRentalIdFromRig(sourceRig));
  const rentedFlag = Boolean(sourceRig?.status?.rented);

  return !(rentedFlag || hasLiveRentalId || status.includes('rented') || status.includes('active'));
}

function hasInactiveRentalStatus(rental) {
  const statusCandidates = [
    rental?.status,
    rental?.state,
    rental?.rental_status,
    rental?.rentalStatus,
    rental?.rig?.status,
  ];
  const status = statusCandidates
    .map(value => String(typeof value === 'object' ? value?.status : value || '').toLowerCase())
    .find(Boolean) || '';

  return ['finished', 'complete', 'completed', 'cancelled', 'canceled', 'expired', 'ended'].some(token => status.includes(token));
}

function isRentalActive(now, endTs, sourceRig, rental) {
  if (hasInactiveRentalStatus(rental)) return false;
  if (endTs > 0) return now < endTs;

  const statusRaw = sourceRig?.status ?? rental?.status ?? rental?.state ?? rental?.rental_status ?? rental?.rentalStatus;
  const status = String(typeof statusRaw === 'object' ? statusRaw.status : statusRaw || '').toLowerCase();
  const hasLiveRentalId = Boolean(getRentalIdFromRig(sourceRig));
  const rentedFlag = Boolean(sourceRig?.status?.rented || rental?.status?.rented);

  return rentedFlag || hasLiveRentalId || status.includes('rented') || status.includes('active') || status.includes('running');
}

function isLiveRigCurrentlyRented(rig) {
  if (!rig) return false;
  const statusRaw = rig?.status;
  const status = String(typeof statusRaw === 'object' ? statusRaw.status : statusRaw || '').toLowerCase();
  return Boolean(getRentalIdFromRig(rig)) && (status.includes('rented') || status.includes('active') || status.includes('running'));
}

// ==========================
//  Global State (Persisted in DB)
// ==========================

let isMonitorRunning = false;
const monitorInitTracker = new Set();
async function maybeDelay(key) {
  if (!monitorInitTracker.has(key)) {
    console.log(`[Monitor] First-time load delay (1s) for: ${key}`);
    await new Promise(r => setTimeout(r, 1000));
    monitorInitTracker.add(key);
  }
}

/** Retrieves the global telegram notification status from the DB */
export async function getTelegramStatus() {
  try {
    // Defensive check: ensure table exists
    await dbRunAsync("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
    const row = await dbGetAsync("SELECT value FROM settings WHERE key = 'telegram_enabled'");
    return { enabled: row ? row.value === 'true' : true }; // Default to true
  } catch (err) {
    console.warn('[monitor:db] Failed to fetch telegram status:', err.message);
    return { enabled: true };
  }
}

/** Updates the global telegram notification status in the DB */
export async function setTelegramStatus(enabled) {
  const val = enabled ? 'true' : 'false';
  await dbRunAsync("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
  await dbRunAsync(
    "INSERT INTO settings (key, value) VALUES ('telegram_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [val]
  );
  return { enabled: !!enabled };
}

// ==========================
//  Constants
// ==========================

// Local aliases for convenience
const { 
  ALERT_COOLDOWN_MS, 
  WARNING_RIG_THRESHOLD, 
} = TELEGRAM_CONFIG;

const RENTED_HEARTBEAT_MS = 15 * 60 * 1000; // Force heartbeat summary to every 15 minutes

// In‑memory state
const lastAlertTimes = new Map([['global_summary', Date.now()]]);   // key → timestamp
const lastRigStates = new Map();    // rigId → status string
const monitorNhPriceCache = new Map(); // algo:client -> {price, unit}
const monitorNhPriceErrorCache = new Map(); // algo:client -> {message, ts}
const monitorNhOrdersCache = new Map(); // client -> { orders, ts }
const MONITOR_NH_ORDERS_TTL = 60 * 1000;

// ==========================
//  Helper: HTML escaping
// ==========================
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');
}

function getMonitorNhAlgoPriceUnit(order, fallbackAlgo) {
  const algo = normalizeAlgoForNiceHash(order?.algorithm || order?.algo || order?.type || fallbackAlgo);
  return getMrrAlgorithmUnit(algo);
}

async function getMonitorNhActiveOrders(clientName) {
  const cacheKey = String(clientName || 'BT').toUpperCase();
  const cached = monitorNhOrdersCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts < MONITOR_NH_ORDERS_TTL)) {
    return cached.orders;
  }

  const cfg = nhConfigs[cacheKey];
  if (!cfg?.apiKey || !cfg?.apiSecret || !cfg?.orgId) return [];

  const { client } = resolveNhClient(cacheKey);
  if (!client) return [];

  const result = await getNiceHashApp(client).hashpower.getMyOrders({ op: 'LE', limit: 100 });
  const rawList = result?.list || result?.myOrders || (Array.isArray(result) ? result : []);
  const activeOrders = rawList.filter(o => String(o?.status?.code || o?.status || '').toUpperCase() === 'ACTIVE');
  monitorNhOrdersCache.set(cacheKey, { orders: activeOrders, ts: Date.now() });
  return activeOrders;
}

// ==========================
//  Helper: Extract array (iterative, safe)
// ==========================
function extractArray(payload, keys = ['rentals', 'rigs', 'list', 'result', 'items', 'data']) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  // Direct key match
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload.data && Array.isArray(payload.data[key])) return payload.data[key];
  }

  // Direct array under .data
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.rentals && Array.isArray(payload.rentals)) return payload.rentals;

  // Recursive lookup inside payload.data (one level deep)
  if (payload.data && typeof payload.data === 'object') {
    return extractArray(payload.data, keys);
  }

  return [];
}

// ==========================
//  Telegram sender (with retries)
// ==========================
export async function sendTelegramInternal(message) {
  await maybeDelay('sendTelegram');
  const status = await getTelegramStatus();
  if (!status.enabled) {
    console.log('[telegram] Notifications are globally disabled, skipping message.');
    return { ok: true, description: 'Notifications disabled' };
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.warn('[telegram] Credentials missing');
    throw new Error('Telegram credentials missing');
  }

  const text = String(message || '').trim();
  if (!text) throw new Error('Message empty');

  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
      });

      const data = await res.json();
      if (res.ok && data?.ok) {
        return data;
      }
      throw new Error(data?.description || `HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 300));
      }
    }
  }

  console.error(`[telegram] Failed after ${maxAttempts} attempts: ${lastError.message}`);
  throw lastError;
}

// ==========================
//  Database helpers (promisified with error handling)
// ==========================
function dbGetAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbRunAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbAllAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ==========================
//  Main monitoring function
// ==========================
export async function runRentalMonitor(forceNotify = false, clientScope = 'ALL') {
  if (isMonitorRunning) {
    console.log(`[Monitor] Run already in progress (force=${forceNotify}), skipping to prevent nonce collisions...`);
    return { notifications: [], summary: { error: 'Monitor already running' } };
  }
  isMonitorRunning = true;
  try {
  await maybeDelay('runRentalMonitor');
  const requestedScope = String(clientScope || 'ALL').trim().toUpperCase();
  const scopeList = requestedScope.split(',').map(s => s.trim());

  const allConfiguredAccts = Object.keys(mrrConfigs).filter(
    k => mrrConfigs[k].apiKey && mrrConfigs[k].apiSecret
  );

  const mrrAccts = (scopeList.includes('ALL') || scopeList.includes('VN') || scopeList.some(s => isAggregate(s)))
    ? allConfiguredAccts
    : allConfiguredAccts.filter(acct => scopeList.includes(acct.toUpperCase()));

  const now = Date.now();
  const notifications = [];
  const activeRentalLines = [];
  const accountMetrics = [];
  const allRentedRigs = [];
  const successfulAccts = [];
  const currentActiveRentalIds = new Set();
  const globalRentalsMap = new Map();
  const globalOnlineAlgos = new Map();
  const queuedTelegramMessages = [];
  const notifiedRentalIdsThisRun = new Set();

  const queueTelegramMessage = (message, options = {}) => {
    const text = String(message || '').trim();
    if (!text) return;
    queuedTelegramMessages.push({
      message: text,
      label: options.label || 'Monitor',
      type: options.type || options.label || 'Monitor',
      summary: options.summary || null,
      onSuccess: options.onSuccess,
      onFailure: options.onFailure,
    });
  };

  const buildGroupedTelegramMessages = (items, typeLabel = 'Grouped Monitor') => {
    if (typeLabel === 'RENTAL FINISHED') {
      const title = `📦 [${new Date().toLocaleTimeString()}]\n` +
        `━━━━━━━━━━━━━━\n` +
        `<b>Type:</b> ${escapeHtml(typeLabel)}\n` +
        `<b>Total:</b> ${items.length}\n\n`;
      const chunks = [];
      let current = title;

      items.forEach((item, index) => {
        const s = item.summary || {};
        const line1 = `${index + 1}. ${escapeHtml(item.label)}\n` +
          `🏁 ${escapeHtml(s.account || 'N/A')} | ${escapeHtml(s.rig || 'N/A')}\n` +
          `Algo: <code>${escapeHtml(s.algo || 'N/A')}</code> | Paid: <b>${escapeHtml(s.paid || '0.00000000 BTC')}</b>\n` +
          `Avg: <code>${escapeHtml(s.avg || '0.00')}</code> | Adv: <code>${escapeHtml(s.ads || 'N/A')}</code> | Eff: <b>${escapeHtml(s.eff || '0%')}</b>\n\n` +
          `━━━━━━━━━━━━━━\n`;
        if (current.length > title.length && current.length + line1.length > 3500) {
          chunks.push(current);
          current = title;
        }
        current += line1;
      });

      if (current.length > title.length) chunks.push(current);
      return chunks;
    }

    const title = `📦 [${new Date().toLocaleTimeString()}]\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Type:</b> ${escapeHtml(typeLabel)}\n` +
      `<b>Total:</b> ${items.length}\n\n`;
    const chunks = [];
    let current = title;

    items.forEach((item, index) => {
      const block = `<b>${index + 1}. ${escapeHtml(item.label)}</b>\n${item.message}\n\n━━━━━━━━━━━━━━\n`;
      if (current.length > title.length && current.length + block.length > 3500) {
        chunks.push(current);
        current = title;
      }
      current += block;
    });

    if (current.length > title.length) chunks.push(current);
    return chunks;
  };

  const flushQueuedTelegramMessages = async () => {
    if (queuedTelegramMessages.length === 0) return;

    const groupedByType = new Map();
    for (const item of queuedTelegramMessages) {
      const type = String(item.type || item.label || 'Monitor');
      if (!groupedByType.has(type)) groupedByType.set(type, []);
      groupedByType.get(type).push(item);
    }

    for (const [typeLabel, items] of groupedByType.entries()) {
      if (items.length === 1) {
        const item = items[0];
        try {
          await sendTelegramInternal(item.message);
          await item.onSuccess?.();
        } catch (err) {
          await item.onFailure?.(err);
        }
        continue;
      }

      try {
        const groupedMessages = buildGroupedTelegramMessages(items, typeLabel);
        for (const groupedMessage of groupedMessages) {
          await sendTelegramInternal(groupedMessage);
        }
        for (const item of items) {
          await item.onSuccess?.();
        }
      } catch (err) {
        for (const item of items) {
          await item.onFailure?.(err);
        }
      }
    }
  };

  let totalAll = 0;
  let availableAll = 0;
  let rentedAll = 0;
  let offlineAll = 0;
  let disabledAll = 0;
  let warningAll = 0;
  let onlineAll = 0;

  // Proactively ensure tables exist to prevent startup race conditions.
  await new Promise((resolve) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS rentals (
        id TEXT PRIMARY KEY, name TEXT, client TEXT, start_time INTEGER, end_time INTEGER, algo TEXT,
        target_100 REAL, order_diff REAL, last_updated INTEGER, last_notified INTEGER,
        low_hashrate_start INTEGER, zero_hashrate_start INTEGER, current_hashrate TEXT,
        average_hashrate TEXT, advertised_hashrate TEXT, price_paid TEXT
      )`, (err) => { if (err) console.error(`[monitor:db] Failed to create rentals table: ${err.message}`); });

      db.run(`CREATE TABLE IF NOT EXISTS rental_history (id TEXT PRIMARY KEY, start_time INTEGER)`,
        (err) => { if (err) console.error(`[monitor:db] Failed to create rental_history table: ${err.message}`); });

      // Cleanup history older than 2 days
      db.run("DELETE FROM rental_history WHERE start_time < ?", [Date.now() - 172800000], () => resolve());
    });
  });

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartTs = todayStart.getTime();

  if (mrrAccts.length === 0) {
    console.warn(`[${new Date().toLocaleTimeString()}] No accounts for scope: ${requestedScope}`);
    return { notifications: [], summary: { error: 'No accounts configured' } };
  }

  console.log(`[${new Date().toLocaleTimeString()}] Starting check for ${mrrAccts.length} accounts...`);

  // ------------------------------------------------------------------
  //  Process each MRR account
  // ------------------------------------------------------------------
  await Promise.all(mrrAccts.map(async (acct) => {
    const harvestedRentalIds = new Set();
    const rigLookupByRentalId = new Map();
    let accountRentedActive = 0;

    const metric = {
      name: acct,
      total: 0,
      online: 0,
      rented: 0,
      offline: 0,
      disabled: 0,
      warning: 0,
      error: false
    };

    try {
      // Parallelize base data fetching for the account to maximize throughput
      const [rigsRes, boughtRes, soldRes] = await Promise.all([
        mrrApiCall({ endpoint: '/rig/mine', clientNameRaw: acct }),
        mrrApiCall({ endpoint: '/rental', query: { type: 'bought' }, clientNameRaw: acct }),
        mrrApiCall({ endpoint: '/rental', query: { type: 'sold' }, clientNameRaw: acct })
      ]);

      if (rigsRes.statusCode === 200 && rigsRes.data?.success) {
        const rigList = extractArray(rigsRes.data);
        const rentedRigs = [];
        let availableCount = 0;
        let offlineCount = 0;
        let disabledCount = 0;
        let warningCount = 0;
        let onlineCount = 0;

        for (const rig of rigList) {
          const statusRaw = rig.status;
          const status = String(typeof statusRaw === 'object' ? statusRaw.status : statusRaw || '').toLowerCase();
          const rentedFlag = Boolean(rig?.status?.rented);
          const rentalId = getRentalIdFromRig(rig);
          const onlineFlag = typeof rig?.status?.online === 'boolean' ? rig.status.online : Boolean(rig?.online);

          const isRented = rentedFlag || status.includes('rented') || status.includes('active') ||
                           (rentalId && rentalId !== '0');
          const isDisabled = status.includes('disabled');
          const isOffline = status.includes('offline') || !onlineFlag;
          const isWarning = status.includes('warning');
          const isAvailable = !isRented && !isDisabled && onlineFlag &&
                              (status.includes('available') || status.includes('online') || status === '');

          // ----- FIXED: currentStatus properly computed -----
          const currentStatus = isOffline ? 'OFFLINE'
                              : isDisabled ? 'DISABLED'
                              : isWarning  ? 'WARNING'
                              : 'OK';

          const rigIdKey = `rig_state_${acct}_${rig.id}`;
          const prevStatus = lastRigStates.get(rigIdKey);
          const isStatusChanged = prevStatus !== undefined && prevStatus !== currentStatus;
          const isCriticalChange = currentStatus === 'WARNING';

          // Only alert on warning if the request actually succeeded (not a 401/Auth error)
          if (isStatusChanged && isCriticalChange && rigsRes.statusCode === 200) {
            const rigAlertKey = `alert_${rigIdKey}_${currentStatus}`;
            const lastRigAlert = lastAlertTimes.get(rigAlertKey) || 0;

            if (now - lastRigAlert > ALERT_COOLDOWN_MS) {
              const rigMsg = TelegramTemplates.rigStatusWarning(acct, rig, resolveRentalAlgo(rig));
              queueTelegramMessage(rigMsg, { label: `Rig warning ${acct}`, type: 'RIG WARNING' });
              lastAlertTimes.set(rigAlertKey, now);
            }
          }
          lastRigStates.set(rigIdKey, currentStatus);

          if (isRented) {
            rentedRigs.push(rig);
            const detailKey = rentalId || String(rig.id || '').trim();
            if (!detailKey) continue;
            harvestedRentalIds.add(detailKey);
            rigLookupByRentalId.set(detailKey, rig);
            rigLookupByRentalId.set(String(rig.id), rig);
          }
          if (isAvailable) availableCount++;
          if (isOffline) offlineCount++;
          if (isDisabled) disabledCount++;
          if (isWarning) warningCount++;
          if (onlineFlag) {
            onlineCount++;
            const algoName = (rig.algo || rig.type || 'N/A').toUpperCase();
            globalOnlineAlgos.set(algoName, (globalOnlineAlgos.get(algoName) || 0) + 1);
          }
        }

        // High warning count alert
        if (warningCount >= WARNING_RIG_THRESHOLD) {
          const alertKeyWarn = `${acct}_warn`;
          const lastWarnAlert = lastAlertTimes.get(alertKeyWarn) || 0;
          if (now - lastWarnAlert > ALERT_COOLDOWN_MS) {
            const warnMsg = TelegramTemplates.highWarningCount(acct, warningCount);
            queueTelegramMessage(warnMsg, {
              type: 'SYSTEM ALERT',
              label: `High warning count ${acct}`,
              onFailure: (e) => console.error(`[monitor] Warn alert failed: ${e.message}`)
            });
            lastAlertTimes.set(alertKeyWarn, now);
          }
        }

        metric.total = rigList.length;
        metric.online = onlineCount;
        metric.offline = offlineCount;
        metric.disabled = disabledCount;
        metric.warning = warningCount;

        totalAll += rigList.length;
        availableAll += availableCount;
        offlineAll += offlineCount;
        disabledAll += disabledCount;
        warningAll += warningCount;
        onlineAll += onlineCount;
        allRentedRigs.push(...rentedRigs.map(r => ({ ...r, acct })));
        successfulAccts.push(acct);
      } else if (rigsRes.data) {
        const errMsg = rigsRes.data.data?.message || rigsRes.data.message || rigsRes.data.error || 'Unknown';
        console.warn(`[${new Date().toLocaleTimeString()}] Account ${acct} rig list failed: ${errMsg}`);
        metric.error = true;
      }

      const soldRentalsRaw = extractArray(soldRes.data || {}).map(r => ({ ...r, __rentalSide: 'sold' }));
      const boughtRentalsRaw = extractArray(boughtRes.data || {}).map(r => ({ ...r, __rentalSide: 'bought' }));
      // Correctly combine both bought and sold rentals for a complete picture.
      const allRentalsRaw = [...boughtRentalsRaw, ...soldRentalsRaw];
      console.log(`[monitor:${acct}] rentals fetched: sold=${soldRentalsRaw.length}, bought=${boughtRentalsRaw.length}, rig-rented-flags=${harvestedRentalIds.size}`);

      if (boughtRentalsRaw.length > 0) {
        console.log(`[monitor:${acct}] Ignoring ${boughtRentalsRaw.length} bought rental(s) for seller heartbeat; only sold rentals affect ROI/active detail.`);
      }

      const rentalsMap = new Map();
      allRentalsRaw.forEach(r => {
        if (r && r.id) {
          rentalsMap.set(String(r.id), r);
          globalRentalsMap.set(String(r.id), r);
          for (const key of getRigLookupKeys(r)) {
            if (!rentalsMap.has(key)) rentalsMap.set(key, r);
            if (!globalRentalsMap.has(key)) globalRentalsMap.set(key, r);
          }
        }
      });

      // Harvest missing rental details
      const missingIds = Array.from(harvestedRentalIds).filter(hid => !rentalsMap.has(hid));
      if (missingIds.length > 0) {
        await Promise.all(missingIds.map(async (hid) => {
          try {
            const hRes = await mrrApiCall({ endpoint: `/rental/${hid}`, clientNameRaw: acct });
            const hData = hRes.data?.data || hRes.data;
            if (hRes.statusCode === 200 && hData && !hData.error) {
              if (!hData.id) hData.id = hid;
              rentalsMap.set(hid, hData);
              globalRentalsMap.set(hid, hData);
            }
          } catch (err) {}
        }));
      }

      // Enrich with rig data where rental details are missing
      for (const [rid, rig] of rigLookupByRentalId.entries()) {
        if (!rentalsMap.has(rid)) {
          rentalsMap.set(rid, {
            id: rid,
            name: rig.name,
            status: rig.status,
            hashrate: { current: rig.hashrate || 0 },
            rig: { id: rig.id, type: rig.algo || rig.type }
          });
          globalRentalsMap.set(rid, rentalsMap.get(rid));
        }
      }

      const rentals = Array.from(new Map(
        Array.from(rentalsMap.values()).map(r => [String(r?.id || r?.rentalid || r?.rental_id || ''), r])
      ).values()).filter(r => r && (r.id || r.rentalid || r.rental_id));

      // 3) Process each rental (alerts, DB update)
      for (const r of rentals) {
      // Inject current hashrate and rig name from live rig data
      const liveRig = getRigLookupKeys(r).map(key => rigLookupByRentalId.get(key)).find(Boolean);
      if (liveRig) {
        // ALWAYS use the rig name, never the rental order description
        r.name = liveRig.name || r.name;

        // Merge live rig hashrate into rental for better accuracy
        if (!r.hashrate || typeof r.hashrate !== 'object') r.hashrate = {};
        const liveVal = parseFloat(liveRig.hashrate || liveRig.status?.hashrate || 0);
        if (liveVal > 0) {
          r.hashrate.current = liveVal;
          // If rental has no detailed hashrate, promote the simple value as current
          if (!r.hashrate.last_15min) {
            r.hashrate.last_15min = { hash: liveVal, nice: `${liveVal.toFixed(2)} ${liveRig.hashrate_suffix || ''}` };
          }
        }

        // Merge rig algo if rental algo is missing
        if ((!r.algo || r.algo === 'Unknown') && liveRig.algo) {
          r.algo = liveRig.algo;
        }
      }

        const info = extractRentalInfo(r);
        const rawStart = info.startTime;
        const rawEnd = info.endTime;

        const parseUtc = (d) => {
          if (!d) return 0;
          const s = String(d);
          const hasSuffix = s.endsWith('UTC') || s.endsWith('Z') || s.includes('+');
          return new Date(hasSuffix ? s : s + ' UTC').getTime();
        };

        const startT = parseUtc(rawStart);
        const endT = parseUtc(rawEnd);
        
        const totalDurationMs = (startT > 0 && endT > 0) ? endT - startT : 0;
        const elapsedMs = startT > 0 ? Math.max(0, Math.min(now - startT, totalDurationMs)) : 0;
        const remainingMs = endT > 0 ? Math.max(0, endT - now) : 0;
        const isCurrentRental = isLiveRigCurrentlyRented(liveRig) && isRentalActive(now, endT, liveRig, r);

        if (!isCurrentRental) {
          await dbRunAsync(`DELETE FROM rentals WHERE id = ?`, [String(r.id)]).catch(() => {});
          continue;
        }

        const activeRentalId = String(r.id || r.rentalid || r.rental_id || '').trim();
        if (activeRentalId) currentActiveRentalIds.add(activeRentalId);

        const advertised = parseFloat(info.hashrate.advertised);
        const average = parseFloat(info.hashrate.average);
        const totalExpectedHashes = advertised * (totalDurationMs / 1000);
        const actualHashesDone = average * (elapsedMs / 1000);
        const remainingHashesNeeded = totalExpectedHashes - actualHashesDone;
        const requiredHashrate = remainingMs > 0 ? (remainingHashesNeeded / (remainingMs / 1000)) : 0;
        const displayTarget = (Number.isFinite(requiredHashrate) && requiredHashrate > 0) ? requiredHashrate : 0;
        const efficiency = parseFloat(info.percent || 0);
        const currentHash = info.hashrate.current;

        // Calculate Price ROI (ROI = (MarketPrice - YourPrice) / MarketPrice)
        let priceRoi = null;
        try {
          const nhAlgo = normalizeAlgoForNiceHash(info.algo);
          if (!nhAlgo || nhAlgo === 'UNKNOWN' || nhAlgo === 'N/A') throw new Error('Unsupported algorithm');

          const cacheKey = `${nhAlgo}:${acct}`;
          const cachedError = monitorNhPriceErrorCache.get(cacheKey);
          if (cachedError && now - cachedError.ts < 10 * 60 * 1000) {
            throw new Error(cachedError.message);
          }

          let nhP = monitorNhPriceCache.get(cacheKey);
          
          if (!nhP) {
            const cfg = nhConfigs[acct];
            if (!cfg?.apiKey || !cfg?.apiSecret || !cfg?.orgId) {
              throw new Error(`NiceHash client "${acct}" is not configured`);
            }

            const activeOrders = await getMonitorNhActiveOrders(acct);
            const matchedOrder = activeOrders.find(order => normalizeAlgoForNiceHash(order?.algorithm || order?.algo || order?.type) === nhAlgo);
            if (!matchedOrder) {
              throw new Error(`No active NiceHash order found for ${nhAlgo}`);
            }

            nhP = {
              price: parseFloat(matchedOrder?.price ?? matchedOrder?.marketPrice ?? matchedOrder?.fixedPrice ?? 0) || 0,
              unit: getMonitorNhAlgoPriceUnit(matchedOrder, nhAlgo)
            };
            if (nhP.price <= 0) throw new Error('NiceHash price unavailable');
            monitorNhPriceCache.set(cacheKey, nhP);
            monitorNhPriceErrorCache.delete(cacheKey);
          }

          const mrrBtcData = getBtcPriceData(r.price || info.price);
          const mrrUnit = getMrrAlgorithmUnit(info.algo);
          const advertisedInMrrUnit = convertHashrateValue(advertised, info.hashrate.suffix || mrrUnit, mrrUnit);
          const durationHours = Number.parseFloat(info.duration) || 0;
          const mrrPriceNorm =
            Number.isFinite(advertisedInMrrUnit) && advertisedInMrrUnit > 0 && Number.isFinite(durationHours) && durationHours > 0
              ? mrrBtcData.value / (durationHours / 24) / advertisedInMrrUnit
              : mrrBtcData.value;

          if (nhP.price > 0 && mrrPriceNorm > 0) {
            priceRoi = calculatePriceComparison(mrrPriceNorm, mrrUnit, nhP.price, nhP.unit);
          }
        } 
        catch (err) {
          const nhAlgoForLog = normalizeAlgoForNiceHash(info.algo);
          const cacheKey = `${nhAlgoForLog}:${acct}`;
          const cachedError = monitorNhPriceErrorCache.get(cacheKey);
          if (!cachedError || cachedError.message !== err.message || now - cachedError.ts >= 10 * 60 * 1000) {
            monitorNhPriceErrorCache.set(cacheKey, { message: err.message, ts: now });
            console.warn(`[monitor] ROI price skipped for ${cacheKey}: ${err.message}`);
          }
        }

        const orderDiff = (priceRoi !== null && !isNaN(priceRoi)) ? priceRoi : (100 - (parseFloat(efficiency) || 0)).toFixed(1);

        // Get current DB state (promisified)
        let row;
        try {
          row = await dbGetAsync(`SELECT last_notified, low_hashrate_start, zero_hashrate_start FROM rentals WHERE id = ?`, [String(r.id)]);
        } catch (err) {
          console.error(`[monitor:db] Failed to fetch rental ${r.id}: ${err.message}`);
          row = null;
        }

        let lowHashStart = row?.low_hashrate_start || 0;
        let zeroHashStart = row?.zero_hashrate_start || 0;
        let lastNotified = row?.last_notified || 0;

        // Serialize DB writes to prevent locking issues
        await new Promise((resolve, reject) => {
          db.serialize(() => {
            // Update database immediately to ensure row exists and status is tracked before notification checks
            db.run(
              `INSERT INTO rentals (
                 id, name, client, start_time, end_time, algo, 
                 target_100, order_diff, last_updated, low_hashrate_start, zero_hashrate_start,
                 current_hashrate, average_hashrate, advertised_hashrate, price_paid, last_notified
               ) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET 
                 name=excluded.name, client=excluded.client, algo=excluded.algo, order_diff=excluded.order_diff,
                 start_time=excluded.start_time, end_time=excluded.end_time, target_100=excluded.target_100, last_updated=excluded.last_updated,
                 low_hashrate_start=excluded.low_hashrate_start, zero_hashrate_start=excluded.zero_hashrate_start,
                 current_hashrate=excluded.current_hashrate, average_hashrate=excluded.average_hashrate,
                 advertised_hashrate=excluded.advertised_hashrate, price_paid=excluded.price_paid`,
              [
                String(r.id), r.name || r.id, acct, startT, endT, info.algo, displayTarget, orderDiff, now, lowHashStart, zeroHashStart,
                currentHash, average, advertised, info.price.paid, lastNotified
              ], (err) => { if (err) console.error(`[${new Date().toLocaleTimeString()}] [monitor:db] Upsert error for ${r.id}: ${err.message}`); }
            );
            // Record in history to maintain count even after the rental ends
            if (startT > 0) db.run("INSERT OR IGNORE INTO rental_history (id, start_time) VALUES (?, ?)", [String(r.id), startT]);
            resolve();
          });
        });

        // Efficiency < 50% for 15 minutes
        if (efficiency < 50) {
          if (lowHashStart === 0) lowHashStart = now;
          if (now - lowHashStart >= 900000) {
            const alertKey = `${r.id}_low_50`;
            const lastAlert = lastAlertTimes.get(alertKey) || 0;
            if (now - lastAlert > ALERT_COOLDOWN_MS) {
              const msg = TelegramTemplates.efficiency(acct, r, info, efficiency, displayTarget, resolveRentalAlgo(r, info));
              queueTelegramMessage(msg, {
                type: 'LOW EFFICIENCY',
                label: `Low efficiency ${acct} ${r.id}`,
                onFailure: (e) => console.error(`[monitor] Low hashrate alert failed: ${e.message}`)
              });
              lastAlertTimes.set(alertKey, now);
            }
          }
        } else {
          lowHashStart = 0;
        }

        // Zero hashrate for 10 minutes
        if (currentHash === 0) {
          if (zeroHashStart === 0) zeroHashStart = now;
          if (now - zeroHashStart >= 600000) {
            const alertKey = `${r.id}_zero_10m`;
            const lastAlert = lastAlertTimes.get(alertKey) || 0;
            if (now - lastAlert > ALERT_COOLDOWN_MS) {
              const msg = TelegramTemplates.zeroHashrate(acct, r, info, resolveRentalAlgo(r, info));
              queueTelegramMessage(msg, {
                type: 'ZERO HASHRATE',
                label: `Zero hashrate ${acct} ${r.id}`,
                onFailure: (e) => console.error(`[monitor] Zero hashrate alert failed: ${e.message}`)
              });
              lastAlertTimes.set(alertKey, now);
            }
          }
        } else {
          zeroHashStart = 0;
        }

        // Startup alert (first hour, efficiency <70%)
        if (elapsedMs > 0 && elapsedMs < 3600000 && efficiency < 50) {
          const startupKey = `${r.id}_startup_50`;
          const lastAlert = lastAlertTimes.get(startupKey) || 0;
          if (now - lastAlert > ALERT_COOLDOWN_MS) {
            const msg = TelegramTemplates.startup(acct, r, info, efficiency, displayTarget, resolveRentalAlgo(r, info));
            queueTelegramMessage(msg, {
              type: 'STARTUP ALERT',
              label: `Startup alert ${acct} ${r.id}`,
              onFailure: (e) => console.error(`[monitor] Startup alert failed: ${e.message}`)
            });
            lastAlertTimes.set(startupKey, now);
          }
        }

        // Completion alert (last hour, efficiency <70%)
        if (remainingMs > 0 && remainingMs < 3600000 && efficiency < 70) {
          const completionKey = `${r.id}_completion_70`;
          const lastAlert = lastAlertTimes.get(completionKey) || 0;
          if (now - lastAlert > ALERT_COOLDOWN_MS) {
            const msg = TelegramTemplates.completionAlert(acct, r, info, efficiency, displayTarget, resolveRentalAlgo(r, info));
            queueTelegramMessage(msg, {
              type: 'ALMOST COMPLETE',
              label: `Completion alert ${acct} ${r.id}`,
              onFailure: (e) => console.error(`[monitor] Completion alert failed: ${e.message}`)
            });
            lastAlertTimes.set(completionKey, now);
          }
        }

        // High efficiency completion (last 10 min, efficiency >95%)
        if (remainingMs > 0 && remainingMs < 600000 && efficiency >= 95) {
          const successKey = `${r.id}_success_95`;
          const lastAlert = lastAlertTimes.get(successKey) || 0;
          if (now - lastAlert > ALERT_COOLDOWN_MS) {
            const msg = TelegramTemplates.completionSuccess(
              acct,
              r,
              info,
              efficiency,
              info.niceAdvertisedHashrate,
              info.niceAverageHashrate,
              info.hashrate.suffix,
              resolveRentalAlgo(r, info)
            );
            queueTelegramMessage(msg, {
              type: 'RENTAL SUCCESS',
              label: `Completion success ${acct} ${r.id}`,
              onFailure: (e) => console.error(`[monitor] Success alert failed: ${e.message}`)
            });
            lastAlertTimes.set(successKey, now);
          }
        }

        // Perfect Efficiency rule: Notice every 1 hour if 100%
        if (efficiency >= 100) {
          const perfectKey = `perfect_100_${r.id}`;
          const lastPerfect = lastAlertTimes.get(perfectKey) || 0;
          if (now - lastPerfect >= 3600000) { // Every 1 hour
            const msg = TelegramTemplates.perfectEfficiency(acct, r, efficiency, `${info.price.paid} ${info.price.currency}`, remainingMs, resolveRentalAlgo(r, info));
            queueTelegramMessage(msg, {
              type: 'PERFECT 100%',
              label: `Perfect efficiency ${acct} ${r.id}`,
              onFailure: (e) => console.error(`[monitor] Perfect efficiency alert failed: ${e.message}`)
            });
            lastAlertTimes.set(perfectKey, now);  
          }
        }

        // Build line for summary heartbeat
        const hasEndTime = endT > 0;
        const isFinished_s = !isLiveRigCurrentlyRented(liveRig) || !isRentalActive(now, endT, liveRig, r);
        const remD_s = Math.floor(remainingMs / 86400000);
        const remH_s = Math.floor((remainingMs % 86400000) / 3600000);
        const remM_s = Math.floor((remainingMs % 3600000) / 60000);

        const remStr_s = isFinished_s ? 'Finished' : (hasEndTime ? (remD_s > 0 ? `${remD_s}d ${remH_s}h` : `${remH_s}h ${remM_s}m`) : 'Active');
        const perfEmoji = efficiency >= 100 ? '💯' : (efficiency >= 90 ? '🟢' : (efficiency >= 70 ? '🔵' : (efficiency >= 50 ? '🟡' : '🔴')));
        const divider = '━━━━━━━━━━━━━━━━━';  

        // Include all active rentals in the summary list regardless of speed to match the "Rented" count
        if (isLiveRigCurrentlyRented(liveRig)) {
          accountRentedActive++;
          const currentSpeedVal = parseFloat(info.hashrate.current || 0);
          const speedStatus = currentSpeedVal > 0 ? `<b>${info.niceHashrate}H</b>` : '⚠️ <b>0 H/s</b>';
          const algo = resolveRentalAlgo(r, info);

          activeRentalLines.push(TelegramTemplates.activeRentalLine(
            perfEmoji,
            getAlgoDisplayName(algo),
            r.name || r.id,
            remStr_s,
            info.percent,
            orderDiff,
            info.niceAverageHashrate,
            info.niceAdvertisedHashrate,
            speedStatus,
            displayTarget,
            '', // extra
            acct, // client
            info // Pass the whole info object
          ));
        }

        // Send "rented" notification if new rental (first sighting)
        const isNewToMonitor = lastNotified === 0;
        const withinReasonableStart = startT > 0 && elapsedMs < (10 * 60 * 1000);
        // Guard against both cross-account parallel duplicates and forceNotify re-sending
        const alreadyNotifiedThisRun = notifiedRentalIdsThisRun.has(String(r.id));
        const shouldNotify = !alreadyNotifiedThisRun && (forceNotify || (isNewToMonitor && withinReasonableStart));

        if (shouldNotify) {
          notifiedRentalIdsThisRun.add(String(r.id));
          const hbType = forceNotify ? 'MONITOR' : 'RENTING';
          const timeProgress = totalDurationMs > 0 ? Math.floor((elapsedMs / totalDurationMs) * 100) : 0;

          const displayRemN = Math.max(0, remainingMs);
          const remD = Math.floor(displayRemN / 86400000);
          const remH = Math.floor((displayRemN % 86400000) / 3600000);
          const remM = Math.floor((displayRemN % 3600000) / 60000);
          const remStr = displayRemN <= 0 ? 'Finished' : (remD > 0 ? `${remD}d ${remH}h` : `${remH}h ${remM}m`);

          const msg = TelegramTemplates.rentedNotice(hbType, r, info, acct, orderDiff, remStr, resolveRentalAlgo(r, info));

          queueTelegramMessage(msg, {
            type: hbType,
            label: `${hbType} ${acct} ${r.id}`,
            onSuccess: async () => {
              await dbRunAsync(`UPDATE rentals SET last_notified = ? WHERE id = ?`, [now, String(r.id)]);
              notifications.push({ id: r.id, client: acct, status: 'Sent', telegram: 'ok' });
            },
            onFailure: (tgErr) => {
              notifications.push({ id: r.id, client: acct, status: 'Failed', error: tgErr.message });
            }
          });
        } else {
          notifications.push({ id: r.id, client: acct, status: 'Skipped', reason: 'Already notified' });
        }
      }
    } catch (err) {
      console.error(`[${new Date().toLocaleTimeString()}] [monitor:error] Client ${acct}: ${err.message}`);
      metric.error = true;
    }
    metric.rented = accountRentedActive;
    accountMetrics.push(metric);
    if (!metric.error) successfulAccts.push(acct);
  }));

  const successfulAcctList = Array.from(new Set(successfulAccts));

  if (currentActiveRentalIds.size > 0 && successfulAcctList.length > 0) {
    const activePlaceholders = Array.from(currentActiveRentalIds).map(() => '?').join(',');
    const clientPlaceholders = successfulAcctList.map(() => '?').join(',');
    await dbRunAsync(
      `DELETE FROM rentals WHERE client IN (${clientPlaceholders}) AND id NOT IN (${activePlaceholders})`,
      [...successfulAcctList, ...Array.from(currentActiveRentalIds)]
    ).catch((err) => console.warn(`[monitor:db] Failed to prune stale rentals: ${err.message}`));
  } else if (successfulAcctList.length > 0) {
    const placeholders = successfulAcctList.map(() => '?').join(',');
    await dbRunAsync(
      `DELETE FROM rentals WHERE client IN (${placeholders})`,
      successfulAcctList
    ).catch((err) => console.warn(`[monitor:db] Failed to clear stale rentals: ${err.message}`));
  }

  const rented24hRow = await dbGetAsync(
    "SELECT COUNT(*) as count FROM rental_history WHERE start_time >= ?",
    [todayStartTs]
  );
  const rented24hCount = rented24hRow ? rented24hRow.count : 0;

  // ------------------------------------------------------------------
  //  Detect and notify finished rentals (no longer present in API)
  // ------------------------------------------------------------------
  if (successfulAcctList.length > 0) {
    // Parameterised query to prevent SQL injection
    const placeholders = successfulAcctList.map(() => '?').join(',');
    const finishedRentals = await dbAllAsync(
      `SELECT * FROM rentals WHERE last_updated < ? AND client IN (${placeholders})`,
      [now, ...successfulAcctList]
    );

    for (const fr of finishedRentals) {
      const endTs = Number(fr.end_time || 0);
      const lastUpdatedTs = Number(fr.last_updated || 0);
      const hadRealEndTime = endTs > 0;
      const endedRecently = hadRealEndTime && endTs <= now && now - endTs < 6 * 60 * 60 * 1000;
      const wentMissingRecently = lastUpdatedTs > 0 && now - lastUpdatedTs < 10 * 60 * 1000;

      if (!endedRecently && !wentMissingRecently) {
        await dbRunAsync(`DELETE FROM rentals WHERE id = ?`, [fr.id]);
        continue;
      }

      let enriched = { ...fr };
      try {
        const res = await mrrApiCall({ endpoint: `/rental/${fr.id}`, clientNameRaw: fr.client, silent: true });
        if (res && res.statusCode === 200 && res.data) {
          const d = res.data.data || res.data;
          if (d && typeof d === 'object') enriched = { ...enriched, ...d };
        }
      } catch (e) {
        // ignore API enrichment errors; still notify with DB info
      }

      const info = extractRentalInfo(enriched);
      const finishAds = info.niceAdvertisedHashrate || info.hashrate?.advertised?.nice || info.hashrate?.advertised || info.hashrate?.suffix || 'N/A';
      const finishMsg = TelegramTemplates.finished(enriched, info, resolveRentalAlgo(enriched, info), finishAds);
      queueTelegramMessage(finishMsg, {
        type: 'RENTAL FINISHED',
        label: `Finished ${fr.client} ${fr.id}`,
        summary: {
          account: fr.client,
          rig: enriched.name || enriched.id,
          algo: resolveRentalAlgo(enriched, info),
          paid: `${info.price.paid} ${info.price.currency}`,
          avg: info.niceAverageHashrate,
          ads: finishAds,
          eff: `${parseFloat(info.percent || 0).toFixed(2)}%`,
        },
        onSuccess: async () => {
          notifications.push({ id: fr.id, client: fr.client, status: 'Sent', type: 'Finished', telegram: 'ok' });
          await dbRunAsync(`DELETE FROM rentals WHERE id = ?`, [fr.id]);
        },
        onFailure: async (e) => {
          console.warn(`[${new Date().toLocaleTimeString()}] [monitor] Finish notice failed for ${fr.id}: ${e.message}`);
          notifications.push({ id: fr.id, client: fr.client, status: 'Failed', type: 'Finished', error: e.message });
          await dbRunAsync(`DELETE FROM rentals WHERE id = ?`, [fr.id]);
        }
      });
    }
  }

  await flushQueuedTelegramMessages();

  // ------------------------------------------------------------------
  //  Send combined summary heartbeat
  // ------------------------------------------------------------------
  const shouldSendCombinedSummary = forceNotify || (now - (lastAlertTimes.get('global_summary') || 0) >= RENTED_HEARTBEAT_MS);
  rentedAll = currentActiveRentalIds.size || activeRentalLines.length || accountMetrics.reduce((sum, metric) => sum + (Number(metric.rented) || 0), 0);
  if (shouldSendCombinedSummary && (accountMetrics.length > 0 || activeRentalLines.length > 0)) {
    const maxBarLen = 30;
    const barChart = accountMetrics.map(am => {
      const ratio = totalAll > 0 ? am.total / totalAll : 0;
      const filled = Math.max(1, Math.round(ratio * maxBarLen));
      const bar = '█'.repeat(filled);
      const statusNote = am.error ? ' [ERROR]' : am.total;
      return `<code>${am.name.padEnd(4)}${bar.padEnd(maxBarLen + 1)}${statusNote}</code>`;
    }).join('\n');

    const finishTime = new Date().toLocaleTimeString();
    const onlineAlgoLines = Array.from(globalOnlineAlgos.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([algo, count]) => `• ${getAlgoDisplayName(algo)}: <b>${count}</b>`);

    try {
      const summaryBase = (linesSubset) => TelegramTemplates.heartbeatSummary(
        barChart,
        onlineAll,
        rentedAll,
        offlineAll,
        disabledAll,
        totalAll,
        linesSubset,
        finishTime,
        rented24hCount,
        onlineAlgoLines
      );

      const summaryChunks = [];
      let currentLines = [];
      for (const line of activeRentalLines) {
        const nextLines = [...currentLines, line];
        const nextMsg = summaryBase(nextLines);
        if (currentLines.length > 0 && nextMsg.length > 3600) {
          summaryChunks.push(summaryBase(currentLines));
          currentLines = [line];
        } else {
          currentLines = nextLines;
        }
      }
      if (currentLines.length > 0 || activeRentalLines.length === 0) {
        summaryChunks.push(summaryBase(currentLines));
      }

      for (const msg of summaryChunks) {
        await sendTelegramInternal(msg);
      }
      lastAlertTimes.set('global_summary', now);
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] [monitor] Summary send failed: ${e.message}`);
    }
  }

  return {
    notifications,
    summary: {
      scope: requestedScope,
      accounts: mrrAccts,
      totals: {
        rigs: totalAll,
        available: availableAll,
        rented: rentedAll,
        offline: offlineAll,
        disabled: disabledAll,
        warning: warningAll,
      },
      perAccount: accountMetrics,
      activeRentals: allRentedRigs.map(r => {
        const rentalDetail = globalRentalsMap.get(String(r.id));
        const eff = rentalDetail ? parseFloat(extractRentalInfo(rentalDetail).percent || 0) : 0;
        return { 
          account: r.acct, 
          id: r.id, 
          name: r.name || r.id,
          efficiency: eff,
          orderDiff: (100 - eff).toFixed(1)
        };
      }),
    },
  };
  } finally {
    isMonitorRunning = true;
  }
}
