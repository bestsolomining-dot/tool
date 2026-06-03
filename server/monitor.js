import { request } from 'undici';
import { db } from './db.js';
import { mrrApiCall, mrrConfigs } from './mrr.js';
import { resolveNhClient, getNiceHashApp, isAggregate } from './nh.js';
import { extractRentalInfo, extractRigInfo } from './utils.js';

// ==========================
//  Global State (Persisted in DB)
// ==========================

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
export const TelegramManager = {
  CONFIG: {
    ALERT_COOLDOWN_MS: 600000,          // 10 minutes
    WARNING_RIG_THRESHOLD: 5,
    NEW_RENTAL_WINDOW_MS: 15 * 60 * 1000,
    RENTED_HEARTBEAT_MS: 15 * 60 * 1000, // 5 minutes
  },

  Templates: {
    rigStatusWarning: (acct, rig) => `⚠️ <b>[Rig Status: ${escapeHtml(acct)}]</b>\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Rig:</b> ${escapeHtml(rig.name)}\n` +
      `<b>ID:</b> <code>${rig.id}</code>\n` +
      `<b>Status:</b> <b>WARNING</b>\n` +
      `<b>Algo:</b> <code>${escapeHtml(rig.algo || rig.type)}</code>\n` +
      `━━━━━━━━━━━━━━\n` +
      `<i>Please check your local miner connectivity.</i>`,

    highWarningCount: (acct, count) => `🚨 <b>[Status Alert]</b>\n` +
      `<b>Account:</b> <code>${escapeHtml(acct)}</code>\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Issue:</b> High Warning Count\n` +
      `<b>Count:</b> <b>${count}</b> rigs\n` +
      `Please check your rig connectivity.`,

    efficiency: (acct, r, info, efficiency, displayTarget) => `⚠️ <b>[Efficiency Alert]</b>\n` +
      `<b>Account:</b> <code>${escapeHtml(acct)}</code>\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
      `<b>Algo:</b> <code>${escapeHtml(info.algo).toUpperCase()}</code>\n` +
      `<b>Efficiency:</b> <b>${efficiency.toFixed(1)}%</b> (&lt; 50% for 15m)\n` +
      `<b>Target:</b> ${displayTarget.toFixed(2)} ${info.hashrate.suffix}`,

    zeroHashrate: (acct, r, info) => `🚨 <b>[Critical Alert]</b>\n` +
      `<b>Account:</b> <code>${escapeHtml(acct)}</code>\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
      `<b>Algo:</b> <code>${escapeHtml(info.algo).toUpperCase()}</code>\n` +
      `<b>Status:</b> <b>ZERO HASHRATE</b> (> 5m)\n` +
      `<b>Paid:</b> <code>${info.price?.paid || '0.00'} ${info.price?.currency || 'BTC'}</code>`,

    startup: (acct, r, info, efficiency, displayTarget) => `🚀 <b>[Startup Alert]</b>\n` +
      `<b>Account:</b> <code>${escapeHtml(acct)}</code>\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
      `<b>Algo:</b> <code>${escapeHtml(info.algo).toUpperCase()}</code>\n` +
      `<b>Efficiency:</b> <b>${efficiency.toFixed(1)}%</b> (&lt; 70% in 1st hour)\n` +
      `<b>Target:</b> ${displayTarget.toFixed(2)} ${info.hashrate.suffix}`,

    completion: (acct, r, info, efficiency, displayTarget) => `🏁 <b>[Completion Alert]</b>\n` +
      `<b>Account:</b> <code>${escapeHtml(acct)}</code>\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
      `<b>Algo:</b> <code>${escapeHtml(info.algo).toUpperCase()}</code>\n` +
      `<b>Efficiency:</b> <b>${efficiency.toFixed(1)}%</b> (&lt; 70% in last hour)\n` +
      `<b>Target:</b> ${displayTarget.toFixed(2)} ${info.hashrate.suffix}`,

    rentedNotice: (hbType, r, info, acct, roi, remStr) => `💎 <b>[${hbType}] #${r.id}</b>\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Algo:</b> <code>${escapeHtml(info.algo).toUpperCase()}</code>\n` +
      `<b>Acct:</b> <code>${escapeHtml(acct).toUpperCase()}</code>\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Hash:</b> <code>${info.niceAverageHashrate} (AVD: ${info.niceHashrate})</code>\n` +
      `<b>ROI:</b> <code>${roi >= 0 ? '+' : ''}${roi}%</code>\n` +
      `<b>Time:</b> <code>${remStr} left (Eff: ${info.percent}%)</code>\n` +
      `<b>Paid:</b> <code>${info.price?.paid || '0.00'} ${info.price?.currency || 'BTC'}</code>\n` +
      `━━━━━━━━━━━━━━\n` +
      `<a href="https://www.miningrigrentals.com/rentals/view/${r.id}">[Open in MRR]</a>`,

    finished: (fr) => `🏁 <b>[Rental Finished]</b>\n` +
      `<b>Account:</b> <code>${escapeHtml(fr.client)}</code>\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Rig:</b> ${escapeHtml(fr.name || fr.id)} (<code>${fr.id}</code>)\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Algo:</b> <code>${escapeHtml(fr.algo)}</code>\n` +
      `<b>Final Target:</b> ${fr.target_100 ? fr.target_100.toFixed(2) : 'N/A'}`
  }
};

// Local aliases for convenience
const { 
  ALERT_COOLDOWN_MS, 
  WARNING_RIG_THRESHOLD, 
  RENTED_HEARTBEAT_MS 
} = TelegramManager.CONFIG;

// In‑memory state
const lastAlertTimes = new Map();   // key → timestamp
const lastRigStates = new Map();    // rigId → status string

// ==========================
//  Helper: HTML escaping
// ==========================
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
      const res = await request(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        headersTimeout: 8000,
        bodyTimeout: 8000,
      });

      const data = await res.body.json();
      if (res.statusCode >= 200 && res.statusCode < 300 && data?.ok) {
        return data;
      }
      throw new Error(data?.description || `HTTP ${res.statusCode}`);
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

/** Sends the initial startup message to Telegram */
export async function initTelegramNotifications() {
  const status = await getTelegramStatus();
  if (!status.enabled) return;

  const accts = Object.keys(mrrConfigs).filter(k => mrrConfigs[k].apiKey).join(', ');
  const message = `🤖 <b>System Started</b>\n` +
    `Time: ${new Date().toLocaleString()}\n` +
    `Monitoring: ${accts || 'None'}\n` +
    `Heartbeat Interval: 5m\n` +
    `Service is now active.`;

  try {
    await sendTelegramInternal(message);
  } catch (err) {
    console.warn('[telegram:init] Startup notice failed (check credentials):', err.message);
  }
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
  const monitorTime = new Date().toLocaleTimeString();
  const requestedScope = String(clientScope || 'ALL').trim().toUpperCase();

  const allConfiguredAccts = Object.keys(mrrConfigs).filter(
    k => mrrConfigs[k].apiKey && mrrConfigs[k].apiSecret
  );

  const mrrAccts = (requestedScope === 'ALL' || requestedScope === 'VN' || isAggregate(requestedScope))
    ? allConfiguredAccts
    : allConfiguredAccts.filter(acct => acct === requestedScope);

  const now = Date.now();
  const notifications = [];
  const activeRentalLines = [];
  const accountMetrics = [];
  const allRentedRigs = [];
  const successfulAccts = [];

  let totalAll = 0;
  let availableAll = 0;
  let rentedAll = 0;
  let offlineAll = 0;
  let disabledAll = 0;
  let warningAll = 0;
  let onlineAll = 0;

  if (mrrAccts.length === 0) {
    console.warn(`[${monitorTime}] No accounts for scope: ${requestedScope}`);
    return { notifications: [], summary: { error: 'No accounts configured' } };
  }

  console.log(`[${monitorTime}] Starting check for ${mrrAccts.length} accounts...`);

  // ------------------------------------------------------------------
  //  Process each MRR account
  // ------------------------------------------------------------------
  for (const acct of mrrAccts) {
    const harvestedRentalIds = new Set();
    const rigLookupByRentalId = new Map();

    try {
      // 1) Fetch rig list
      const rigsRes = await mrrApiCall({ endpoint: '/rig/mine', clientNameRaw: acct });
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
          const rentalId = rig?.status?.rentalid || rig?.status?.rental_id || rig?.rentalid || rig?.rental_id;
          const onlineFlag = typeof rig?.status?.online === 'boolean' ? rig.status.online : Boolean(rig?.online);

          const isRented = rentedFlag || status.includes('rented') || status.includes('active') ||
                           (!!rentalId && rentalId !== '0' && rentalId !== 0);
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

          // Alert only on transition TO warning state (cooldown applied)
          if (isStatusChanged && isCriticalChange) {
            const rigAlertKey = `alert_${rigIdKey}_${currentStatus}`;
            const lastRigAlert = lastAlertTimes.get(rigAlertKey) || 0;

            if (now - lastRigAlert > ALERT_COOLDOWN_MS) {
              const rigMsg = TelegramManager.Templates.rigStatusWarning(acct, rig);
              await sendTelegramInternal(rigMsg).catch(() => {});
              lastAlertTimes.set(rigAlertKey, now);
            }
          }
          lastRigStates.set(rigIdKey, currentStatus);

          if (isRented) {
            rentedRigs.push(rig);
            if (rentalId) harvestedRentalIds.add(String(rentalId));
            if (rentalId) rigLookupByRentalId.set(String(rentalId), rig);
          }
          if (isAvailable) availableCount++;
          if (isOffline) offlineCount++;
          if (isDisabled) disabledCount++;
          if (isWarning) warningCount++;
          if (onlineFlag) onlineCount++;
        }

        // High warning count alert
        if (warningCount >= WARNING_RIG_THRESHOLD) {
          const alertKeyWarn = `${acct}_warn`;
          const lastWarnAlert = lastAlertTimes.get(alertKeyWarn) || 0;
          if (now - lastWarnAlert > ALERT_COOLDOWN_MS) {
            const warnMsg = TelegramManager.Templates.highWarningCount(acct, warningCount);
            await sendTelegramInternal(warnMsg).catch(e => console.error(`[monitor] Warn alert failed: ${e.message}`));
            lastAlertTimes.set(alertKeyWarn, now);
          }
        }

        accountMetrics.push({
          name: acct,
          total: rigList.length,
          online: onlineCount,
          rented: rentedRigs.length,
          offline: offlineCount,
          disabled: disabledCount,
          warning: warningCount
        });

        totalAll += rigList.length;
        availableAll += availableCount;
        rentedAll += rentedRigs.length;
        offlineAll += offlineCount;
        disabledAll += disabledCount;
        warningAll += warningCount;
        onlineAll += onlineCount;
        allRentedRigs.push(...rentedRigs.map(r => ({ ...r, acct })));
        successfulAccts.push(acct);
      } else if (rigsRes.data) {
        const errMsg = rigsRes.data.data?.message || rigsRes.data.message || rigsRes.data.error || 'Unknown';
        console.warn(`[${monitorTime}] Account ${acct} rig list failed: ${errMsg}`);
      }

      // 2) Fetch bought + sold rentals
      const boughtRes = await mrrApiCall({ endpoint: '/rental', query: { type: 'bought' }, clientNameRaw: acct });
      const soldRes = await mrrApiCall({ endpoint: '/rental', query: { type: 'sold' }, clientNameRaw: acct });

      const allRentalsRaw = [
        ...extractArray(boughtRes.data || {}),
        ...extractArray(soldRes.data || {})
      ];

      const rentalsMap = new Map();
      allRentalsRaw.forEach(r => {
        if (r && r.id) rentalsMap.set(String(r.id), r);
      });

      // Harvest missing rental details
      for (const hid of harvestedRentalIds) {
        if (!rentalsMap.has(hid)) {
          console.log(`[${monitorTime}] Harvesting missing rental #${hid} for ${acct}`);
          const hRes = await mrrApiCall({ endpoint: `/rental/${hid}`, clientNameRaw: acct });
          const hData = hRes.data?.data || hRes.data;
          if (hData && !hData.error && (hData.id || hRes.data?.success === true)) {
            rentalsMap.set(hid, hData);
          }
        }
      }

      // Enrich with rig data where rental details are missing
      for (const [rid, rig] of rigLookupByRentalId.entries()) {
        if (!rentalsMap.has(rid)) {
          rentalsMap.set(rid, {
            id: rid,
            name: rig.name,
            status: rig.status,
            hashrate: { current: rig.hashrate || 0 },
            rig: { type: rig.algo || rig.type }
          });
        }
      }

      const rentals = Array.from(rentalsMap.values());

      // 3) Process each rental (alerts, DB update)
      for (const r of rentals) {
        // Inject current hashrate if missing
        const liveRig = rigLookupByRentalId.get(String(r.id));
        if (liveRig) {
          r.hashrate = r.hashrate || {};
          if (!r.hashrate.current || r.hashrate.current === 0) {
            r.hashrate.current = liveRig.hashrate || liveRig.status?.hashrate || 0;
          }
          if (!r.name) r.name = liveRig.name;
        }

        const info = extractRentalInfo(r);
        const rawStart = info.startTime;
        const rawEnd = info.endTime;

        // MRR API provides timestamps in UTC without a suffix. 
        // Forcing 'Z' or ' UTC' ensures cross-platform consistency.
        const parseUtc = (d) => d ? new Date(String(d).endsWith('UTC') || String(d).endsWith('Z') ? d : d + ' UTC').getTime() : 0;

        const startT = parseUtc(rawStart);
        const endT = parseUtc(rawEnd);
        
        const totalDurationMs = (startT > 0 && endT > 0) ? endT - startT : 0;
        const elapsedMs = startT > 0 ? Math.max(0, Math.min(now - startT, totalDurationMs)) : 0;
        const remainingMs = endT > 0 ? Math.max(0, endT - now) : 0;

        const advertised = parseFloat(info.hashrate.advertised);
        const average = parseFloat(info.hashrate.average);
        const totalExpectedHashes = advertised * (totalDurationMs / 1000);
        const actualHashesDone = average * (elapsedMs / 1000);
        const remainingHashesNeeded = totalExpectedHashes - actualHashesDone;
        const requiredHashrate = remainingMs > 0 ? (remainingHashesNeeded / (remainingMs / 1000)) : 0;
        const displayTarget = requiredHashrate < 0 ? 0 : requiredHashrate;
        const efficiency = parseFloat(info.percent || 0);
        const currentHash = info.hashrate.current;

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

        // Efficiency < 50% for 15 minutes
        if (efficiency < 50) {
          if (lowHashStart === 0) lowHashStart = now;
          if (now - lowHashStart >= 900000) {
            const alertKey = `${r.id}_low_50`;
            const lastAlert = lastAlertTimes.get(alertKey) || 0;
            if (now - lastAlert > ALERT_COOLDOWN_MS) {
              const msg = TelegramManager.Templates.efficiency(acct, r, info, efficiency, displayTarget);
              await sendTelegramInternal(msg).catch(e => console.error(`[monitor] Low hashrate alert failed: ${e.message}`));
              lastAlertTimes.set(alertKey, now);
            }
          }
        } else {
          lowHashStart = 0;
        }

        // Zero hashrate for 5 minutes
        if (currentHash === 0) {
          if (zeroHashStart === 0) zeroHashStart = now;
          if (now - zeroHashStart >= 300000) {
            const alertKey = `${r.id}_zero_5m`;
            const lastAlert = lastAlertTimes.get(alertKey) || 0;
            if (now - lastAlert > ALERT_COOLDOWN_MS) {
              const msg = TelegramManager.Templates.zeroHashrate(acct, r, info);
              await sendTelegramInternal(msg).catch(e => console.error(`[monitor] Zero hashrate alert failed: ${e.message}`));
              lastAlertTimes.set(alertKey, now);
            }
          }
        } else {
          zeroHashStart = 0;
        }

        // Startup alert (first hour, efficiency <70%)
        if (elapsedMs > 0 && elapsedMs < 3600000 && efficiency < 70) {
          const startupKey = `${r.id}_startup_70`;
          const lastAlert = lastAlertTimes.get(startupKey) || 0;
          if (now - lastAlert > ALERT_COOLDOWN_MS) {
            const msg = TelegramManager.Templates.startup(acct, r, info, efficiency, displayTarget);
            await sendTelegramInternal(msg).catch(e => console.error(`[monitor] Startup alert failed: ${e.message}`));
            lastAlertTimes.set(startupKey, now);
          }
        }

        // Completion alert (last hour, efficiency <70%)
        if (remainingMs > 0 && remainingMs < 3600000 && efficiency < 70) {
          const completionKey = `${r.id}_completion_70`;
          const lastAlert = lastAlertTimes.get(completionKey) || 0;
          if (now - lastAlert > ALERT_COOLDOWN_MS) {
            const msg = TelegramManager.Templates.completion(acct, r, info, efficiency, displayTarget);
            await sendTelegramInternal(msg).catch(e => console.error(`[monitor] Completion alert failed: ${e.message}`));
            lastAlertTimes.set(completionKey, now);
          }
        }

        // Build line for summary heartbeat
        const isFinished_s = remainingMs <= 0 || (endT > 0 && now >= endT);
        const remD_s = Math.floor(remainingMs / 86400000);
        const remH_s = Math.floor((remainingMs % 86400000) / 3600000);
        const remM_s = Math.floor((remainingMs % 3600000) / 60000);

        const remStr_s = isFinished_s ? 'Finished' : (remD_s > 0 ? `${remD_s}d ${remH_s}h` : `${remH_s}h ${remM_s}m`);
        const perfEmoji = efficiency >= 98 ? '🟢' : (efficiency >= 70 ? '🟡' : '🔴');
        const algoTag = info.algo ? ` <code>${escapeHtml(info.algo).toUpperCase()}</code>` : '';
        // Only include active rentals in the summary list to reduce clutter
        if (!isFinished_s) {
          activeRentalLines.push(`${perfEmoji} [${escapeHtml(acct)}] <b>${escapeHtml(r.name || r.id)}</b>${algoTag}\n    ${info.niceAverageHashrate} | ${remStr_s} left | <b>${info.percent}%</b>`);
        }

        // Update database
        try {
          await dbRunAsync(
            `INSERT INTO rentals (id, name, client, start_time, end_time, algo, target_100, last_updated, low_hashrate_start, zero_hashrate_start) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET 
               name=excluded.name, client=excluded.client, algo=excluded.algo, 
               start_time=excluded.start_time, end_time=excluded.end_time, target_100=excluded.target_100, last_updated=excluded.last_updated,
               low_hashrate_start=excluded.low_hashrate_start, zero_hashrate_start=excluded.zero_hashrate_start`,
            [String(r.id), r.name || r.id, acct, startT, endT, info.algo, displayTarget, now, lowHashStart, zeroHashStart]
          );
        } catch (err) {
          console.error(`[monitor:db] Upsert error for ${r.id}: ${err.message}`);
        }

        // Send "rented" notification if new rental (first sighting)
        const lastNotified = row?.last_notified || 0;
        const isNewToMonitor = lastNotified === 0;
        const withinReasonableStart = elapsedMs < (12 * 60 * 60 * 1000);
        const shouldNotify = forceNotify || (isNewToMonitor && withinReasonableStart);

        if (shouldNotify) {
          const hbType = forceNotify ? 'MONITOR' : 'RENTED';
          const roi = (efficiency - 100).toFixed(1);
          const timeProgress = totalDurationMs > 0 ? Math.floor((elapsedMs / totalDurationMs) * 100) : 0;

          const displayRemN = Math.max(0, remainingMs);
          const remD = Math.floor(displayRemN / 86400000);
          const remH = Math.floor((displayRemN % 86400000) / 3600000);
          const remM = Math.floor((displayRemN % 3600000) / 60000);
          const remStr = displayRemN <= 0 ? 'Finished' : (remD > 0 ? `${remD}d ${remH}h` : `${remH}h ${remM}m`);

          const msg = TelegramManager.Templates.rentedNotice(hbType, r, info, acct, roi, remStr);

          try {
            await sendTelegramInternal(msg);
            await dbRunAsync(`UPDATE rentals SET last_notified = ? WHERE id = ?`, [now, String(r.id)]);
            notifications.push({ id: r.id, status: 'Sent', telegram: 'ok' });
          } catch (tgErr) {
            notifications.push({ id: r.id, status: 'Failed', error: tgErr.message });
          }
        } else {
          notifications.push({ id: r.id, status: 'Skipped', reason: 'Throttle (10m)' });
        }
      }
    } catch (err) {
      console.error(`[monitor:error] Client ${acct}: ${err.message}`);
    }
  }

  // ------------------------------------------------------------------
  //  Detect and notify finished rentals (no longer present in API)
  // ------------------------------------------------------------------
  if (successfulAccts.length > 0) {
    // Parameterised query to prevent SQL injection
    const placeholders = successfulAccts.map(() => '?').join(',');
    const finishedRentals = await dbAllAsync(
      `SELECT * FROM rentals WHERE last_updated < ? AND client IN (${placeholders})`,
      [now, ...successfulAccts]
    );

    for (const fr of finishedRentals) {
      const finishMsg = TelegramManager.Templates.finished(fr);
      await sendTelegramInternal(finishMsg).catch(e => console.warn(`[monitor] Finish notice failed: ${e.message}`));
      await dbRunAsync(`DELETE FROM rentals WHERE id = ?`, [fr.id]);
    }
  }

  // ------------------------------------------------------------------
  //  Send combined summary heartbeat
  // ------------------------------------------------------------------
  const shouldSendCombinedSummary = forceNotify || (now - (lastAlertTimes.get('global_summary') || 0) >= RENTED_HEARTBEAT_MS);
  if (shouldSendCombinedSummary && (accountMetrics.length > 0 || activeRentalLines.length > 0)) {
    const maxBarLen = 14;
    const barChart = accountMetrics.map(am => {
      const ratio = totalAll > 0 ? am.total / totalAll : 0;
      const filled = Math.max(1, Math.round(ratio * maxBarLen));
      const bar = '█'.repeat(filled);
      return `<code>${am.name.padEnd(4)}${bar.padEnd(maxBarLen + 2)}${am.total}</code>`;
    }).join('\n');

    const allSummaryMsg = `🏭 <b>Update Overview</b>\n\n` +
      `${barChart}\n\n` +
      `━━━━━━━━━━━━━━\n\n` +
      `<code>Online   ${String(onlineAll).padStart(4)} (${rentedAll} Rented)</code>\n` +
      `<code>Offline  ${String(offlineAll).padStart(4)} (${disabledAll} Disabled)</code>\n\n` +
      `<b>Fleet Total ${totalAll}</b>\n\n` +
      (activeRentalLines.length > 0 ? `━━━━━━━━━━━━━━\n<b>Active Rentals</b>\n` + activeRentalLines.join('\n') : '') +
      `\n<i>Update at ${monitorTime}</i>`;

    try {
      await sendTelegramInternal(allSummaryMsg);
      lastAlertTimes.set('global_summary', now);
    } catch (e) {
      console.error(`[monitor] Summary send failed: ${e.message}`);
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
      perAccount: accountMetrics,   // FIXED: now populated
      activeRentals: allRentedRigs.map(r => ({ account: r.acct, id: r.id, name: r.name || r.id })),
    },
  };
}