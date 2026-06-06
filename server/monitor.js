import { db } from './db.js';
import { mrrApiCall, mrrConfigs } from './mrr.js';
import { resolveNhClient, getNiceHashApp, isAggregate } from './nh.js';
import { extractRentalInfo, extractRigInfo } from './utils.js';
import { TELEGRAM_CONFIG, TelegramTemplates } from '../src/shared/telegram.js';

// ==========================
//  Global State (Persisted in DB)
// ==========================

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

  let totalAll = 0;
  let availableAll = 0;
  let rentedAll = 0;
  let offlineAll = 0;
  let disabledAll = 0;
  let warningAll = 0;
  let onlineAll = 0;

  if (mrrAccts.length === 0) {
    console.warn(`[${new Date().toLocaleTimeString()}] No accounts for scope: ${requestedScope}`);
    return { notifications: [], summary: { error: 'No accounts configured' } };
  }

  console.log(`[${new Date().toLocaleTimeString()}] Starting check for ${mrrAccts.length} accounts...`);

  // ------------------------------------------------------------------
  //  Process each MRR account
  // ------------------------------------------------------------------
  for (const acct of mrrAccts) {
    const harvestedRentalIds = new Set();
    const rigLookupByRentalId = new Map();

    // Initialize metrics for this account to ensure it shows in summary even on failure
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
          const rentalId = String(rig?.status?.rentalid || rig?.status?.rental_id || rig?.rentalid || rig?.rental_id || '').trim();
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
              const rigMsg = TelegramTemplates.rigStatusWarning(acct, rig);
              await sendTelegramInternal(rigMsg).catch(() => {});
              lastAlertTimes.set(rigAlertKey, now);
            }
          }
          lastRigStates.set(rigIdKey, currentStatus);

          if (isRented) {
            rentedRigs.push(rig);
            const detailKey = rentalId && rentalId !== '0' ? String(rentalId) : `rig-${rig.id}`;
            harvestedRentalIds.add(detailKey);
            rigLookupByRentalId.set(detailKey, rig);
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
            const warnMsg = TelegramTemplates.highWarningCount(acct, warningCount);
            await sendTelegramInternal(warnMsg).catch(e => console.error(`[monitor] Warn alert failed: ${e.message}`));
            lastAlertTimes.set(alertKeyWarn, now);
          }
        }

        metric.total = rigList.length;
        metric.online = onlineCount;
        metric.rented = rentedRigs.length;
        metric.offline = offlineCount;
        metric.disabled = disabledCount;
        metric.warning = warningCount;

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
        console.warn(`[${new Date().toLocaleTimeString()}] Account ${acct} rig list failed: ${errMsg}`);
        metric.error = true;
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
      const missingIds = Array.from(harvestedRentalIds).filter(hid => !rentalsMap.has(hid));
      if (missingIds.length > 0) {
        await Promise.all(missingIds.map(async (hid) => {
          try {
            const hRes = await mrrApiCall({ endpoint: `/rental/${hid}`, clientNameRaw: acct });
            const hData = hRes.data?.data || hRes.data;
            const logT = new Date().toLocaleTimeString();
            if (hRes.statusCode === 200 && hData && !hData.error && (hData.id || String(hData.rentalid) === String(hid))) {
              console.log(`[${logT}] [mrr:${acct}] Synchronized missing rental details for #${hid}`);
              if (!hData.id) hData.id = hid; // Ensure ID is initialized for downstream processing
              rentalsMap.set(hid, hData);
            } else {
              console.warn(`[${logT}] [mrr:${acct}] Harvest failed for #${hid}: ${hData?.message || 'Status ' + hRes.statusCode}`);
            }
          } catch (err) {
            console.error(`[${new Date().toLocaleTimeString()}] Error harvesting rental #${hid}: ${err.message}`);
          }
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
          if (!r.hashrate || typeof r.hashrate !== 'object') r.hashrate = {};
          const liveVal = parseFloat(liveRig.hashrate || liveRig.status?.hashrate || 0);
          if ((!r.hashrate.current || parseFloat(r.hashrate.current) === 0) && liveVal > 0) {
            r.hashrate.current = liveVal;
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
        const displayTarget = (Number.isFinite(requiredHashrate) && requiredHashrate > 0) ? requiredHashrate : 0;
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
              const msg = TelegramTemplates.efficiency(acct, r, info, efficiency, displayTarget);
              await sendTelegramInternal(msg).catch(e => console.error(`[monitor] Low hashrate alert failed: ${e.message}`));
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
              const msg = TelegramTemplates.zeroHashrate(acct, r, info);
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
            const msg = TelegramTemplates.startup(acct, r, info, efficiency, displayTarget);
            await sendTelegramInternal(msg).catch(e => console.error(`[monitor] Startup alert failed: ${e.message}`));
            lastAlertTimes.set(startupKey, now);
          }
        }

        // Completion alert (last hour, efficiency <70%)
        if (remainingMs > 0 && remainingMs < 3600000 && efficiency < 70) {
          const completionKey = `${r.id}_completion_70`;
          const lastAlert = lastAlertTimes.get(completionKey) || 0;
          if (now - lastAlert > ALERT_COOLDOWN_MS) {
            const msg = TelegramTemplates.completion(acct, r, info, efficiency, displayTarget);
            await sendTelegramInternal(msg).catch(e => console.error(`[monitor] Completion alert failed: ${e.message}`));
            lastAlertTimes.set(completionKey, now);
          }
        }

        // High efficiency completion (last 10 min, efficiency >95%)
        if (remainingMs > 0 && remainingMs < 600000 && efficiency >= 95) {
          const successKey = `${r.id}_success_95`;
          const lastAlert = lastAlertTimes.get(successKey) || 0;
          if (now - lastAlert > ALERT_COOLDOWN_MS) {
            // Use a local string template for the server monitor
            const msg = `🎉 <b>[Success] High Efficiency Completion</b>\n🏢 <b><u>[<code>${escapeHtml(acct)}</code>]</u></b>\n🖥 ${escapeHtml(r.name || r.id)}\n🆔 <code>${r.id}</code>\n📉 Efficiency: <b>${efficiency.toFixed(1)}%</b>`;
            await sendTelegramInternal(msg).catch(e => console.error(`[monitor] Success alert failed: ${e.message}`));
            lastAlertTimes.set(successKey, now);
          }
        }

        // Perfect Efficiency rule: Notice every 1 minute if 100%
        if (efficiency >= 100) {
          const perfectKey = `perfect_100_${r.id}`;
          const lastPerfect = lastAlertTimes.get(perfectKey) || 0;
          if (now - lastPerfect >= 3600000) { // Every 1 hour
            const msg = `💎 <b>[Perfect Performance] 100%</b>\n🏢 
            <b><u>[<code>${escapeHtml(acct)}</code>]</u></b>\n
            🖥 ${escapeHtml(r.name || r.id)}\n
            🆔 <code>${r.id}</code>\n
            📈 Efficiency: <b>${efficiency.toFixed(1)}%</b>\n`;
            await sendTelegramInternal(msg).catch(() => { });
            lastAlertTimes.set(perfectKey, now);  
          }
        }

        // Build line for summary heartbeat
        const hasEndTime = endT > 0;
        const isFinished_s = hasEndTime && now >= endT;
        const remD_s = Math.floor(remainingMs / 86400000);
        const remH_s = Math.floor((remainingMs % 86400000) / 3600000);
        const remM_s = Math.floor((remainingMs % 3600000) / 60000);

        const remStr_s = isFinished_s ? 'Finished' : (hasEndTime ? (remD_s > 0 ? `${remD_s}d ${remH_s}h` : `${remH_s}h ${remM_s}m`) : 'Active');
        const perfEmoji = efficiency >= 100 ? '💯' : (efficiency >= 90 ? '🟢' : (efficiency >= 70 ? '🔵' : (efficiency >= 50 ? '🟡' : '🔴')));
        const divider = '━━━━━━━━━━━━━━━━━';  

        // Filter for active rentals with Algorithm Speed > 0
        const currentSpeedVal = parseFloat(info.hashrate.current || 0);
        if (!isFinished_s && currentSpeedVal > 0) {
          activeRentalLines.push(
            `${perfEmoji} 🧬 <code>${escapeHtml(info.algo).toUpperCase()}</code>\n` +
            `<b>${escapeHtml(r.name || r.id)}</b>\n` +
            `🎯Effect: <b>${info.percent}%</b>\n` +
            `📊Avg: <b>${info.niceAverageHashrate}H | Ads: ${info.niceAdvertisedHashrate}H</b>\n` +
            `🛜Speed: <b>${info.niceHashrate}H</b>\n` +
            `🧲Target: <b>${displayTarget.toFixed(2)} ${info.hashrate.suffix.toUpperCase()}</b>\n` +
            `⏳Remaining: <b>${remStr_s}</b> \n`
          );
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
          console.error(`[${new Date().toLocaleTimeString()}] [monitor:db] Upsert error for ${r.id}: ${err.message}`);
        }

        // Send "rented" notification if new rental (first sighting)
        const lastNotified = row?.last_notified || 0;
        const isNewToMonitor = lastNotified === 0;
        const withinReasonableStart = elapsedMs < (12 * 60 * 60 * 1000);
        const shouldNotify = forceNotify || (isNewToMonitor && withinReasonableStart);

        if (shouldNotify) {
          const hbType = forceNotify ? 'MONITOR' : 'RENTING';
          const roi = (efficiency - 100).toFixed(1);
          const timeProgress = totalDurationMs > 0 ? Math.floor((elapsedMs / totalDurationMs) * 100) : 0;

          const displayRemN = Math.max(0, remainingMs);
          const remD = Math.floor(displayRemN / 86400000);
          const remH = Math.floor((displayRemN % 86400000) / 3600000);
          const remM = Math.floor((displayRemN % 3600000) / 60000);
          const remStr = displayRemN <= 0 ? 'Finished' : (remD > 0 ? `${remD}d ${remH}h` : `${remH}h ${remM}m`);

          const msg = TelegramTemplates.rentedNotice(hbType, r, info, acct, roi, remStr);

          try {
            await sendTelegramInternal(msg);
            await dbRunAsync(`UPDATE rentals SET last_notified = ? WHERE id = ?`, [now, String(r.id)]);
            notifications.push({ id: r.id, client: acct, status: 'Sent', telegram: 'ok' });
          } catch (tgErr) {
            notifications.push({ id: r.id, client: acct, status: 'Failed', error: tgErr.message });
          }
        } else {
          notifications.push({ id: r.id, client: acct, status: 'Skipped', reason: 'Already notified' });
        }
      }
    } catch (err) {
      console.error(`[${new Date().toLocaleTimeString()}] [monitor:error] Client ${acct}: ${err.message}`);
      metric.error = true;
    }

    accountMetrics.push(metric);
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
      let enriched = { ...fr };
      try {
        const res = await mrrApiCall({ endpoint: `/rental/${fr.id}`, clientNameRaw: fr.client });
        if (res && res.statusCode === 200 && res.data) {
          const d = res.data.data || res.data;
          if (d && typeof d === 'object') enriched = { ...enriched, ...d };
        }
      } catch (e) {
        // ignore API enrichment errors; still notify with DB info
      }

      const info = extractRentalInfo(enriched);
      const finishMsg = TelegramTemplates.finished(enriched, info);
      try {
        await sendTelegramInternal(finishMsg);
        notifications.push({ id: fr.id, client: fr.client, status: 'Sent', type: 'Finished', telegram: 'ok' });
      } catch (e) {
        console.warn(`[${new Date().toLocaleTimeString()}] [monitor] Finish notice failed for ${fr.id}: ${e.message}`);
        notifications.push({ id: fr.id, client: fr.client, status: 'Failed', type: 'Finished', error: e.message });
      }
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
      const statusNote = am.error ? ' [ERROR]' : am.total;
      return `<code>${am.name.padEnd(4)}${bar.padEnd(maxBarLen + 1)}${statusNote}</code>`;
    }).join('\n');

    const finishTime = new Date().toLocaleTimeString();
    const allSummaryMsg = TelegramTemplates.heartbeatSummary(barChart, onlineAll, rentedAll, offlineAll, disabledAll, totalAll, activeRentalLines, finishTime);

    try {
      await sendTelegramInternal(allSummaryMsg);
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
      perAccount: accountMetrics,   // FIXED: now populated
      activeRentals: allRentedRigs.map(r => ({ account: r.acct, id: r.id, name: r.name || r.id })),
    },
  };
}
