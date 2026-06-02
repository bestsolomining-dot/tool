import { request } from 'undici';
import { db } from './db.js';
import { mrrApiCall, mrrConfigs } from './mrr.js';
import { resolveNhClient, getNiceHashApp, isAggregate } from './nh.js';
import { extractRentalInfo, extractRigInfo } from './utils.js';

const ALERT_COOLDOWN_MS = 600000;
const WARNING_RIG_THRESHOLD = 5;
const NEW_RENTAL_WINDOW_MS = 15 * 60 * 1000;
const RENTED_HEARTBEAT_MS = 5 * 60 * 1000;
const lastAlertTimes = new Map(); // key -> timestamp
const lastRigStates = new Map(); // rigId -> status string

/** Safely escapes HTML special characters for Telegram's HTML parse_mode */
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Safely extracts an array from various MRR API response shapes */
function extractArray(payload, keys = ['rentals', 'rigs', 'list', 'result', 'items', 'data']) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
    // Deep check for payload.data.rentals etc.
    if (payload.data && Array.isArray(payload.data[key])) return payload.data[key];
  }

  // If payload.data contains an array, return it directly
  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  if (payload.rentals && Array.isArray(payload.rentals)) return payload.rentals;

  // If payload.data is an object, recurse once to look for array keys inside the envelope
  if (payload.data && typeof payload.data === 'object') {
    return extractArray(payload.data, keys);
  }

  return [];
}

export async function sendTelegramInternal(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.warn('[telegram] Telegram credentials missing. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env');
    throw new Error('Telegram credentials missing');
  }

  const text = String(message || '').trim();
  if (!text) throw new Error('Telegram message is empty');

  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await request(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        headersTimeout: 8000,
        bodyTimeout: 8000,
      });

      const data = await res.body.json();
      if (res.statusCode >= 200 && res.statusCode < 300 && data?.ok) return data;
      const reason = data?.description || `HTTP ${res.statusCode}`;
      throw new Error(reason);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 300));
      }
    }
  }

  console.error(`[telegram:error] Failed to send message after ${maxAttempts} attempts: ${lastError.message}`);
  throw lastError;
}

export async function runRentalMonitor(forceNotify = false, clientScope = 'ALL') {
  const monitorTime = new Date().toLocaleTimeString();
  const requestedScope = String(clientScope || 'ALL').trim().toUpperCase();
  const allConfiguredAccts = Object.keys(mrrConfigs).filter(k => mrrConfigs[k].apiKey && mrrConfigs[k].apiSecret);
  const mrrAccts = (requestedScope === 'ALL' || requestedScope === 'VN' || isAggregate(requestedScope))
    ? allConfiguredAccts
    : allConfiguredAccts.filter(acct => acct === requestedScope);

  const now = Date.now();
  const notifications = [];
  const summaryParts = [];
  let totalAll = 0;
  let availableAll = 0;
  let rentedAll = 0;
  let offlineAll = 0;
  let disabledAll = 0;
  let warningAll = 0;
  let onlineAll = 0;
  const activeRentalLines = [];
  const accountMetrics = [];
  const allRentedRigs = [];
  const rigLookupByRentalId = new Map();
  const harvestedRentalIds = new Set();

  if (mrrAccts.length === 0) {
    console.warn(`[${monitorTime}] [monitor] No configured MRR accounts found for scope: ${requestedScope}`);
    return { notifications: [], summary: { error: 'No accounts configured' } };
  }

  console.log(`[${monitorTime}] [monitor] Starting check for ${mrrAccts.length} accounts...`);

  for (const acct of mrrAccts) {
    try {
      const rigsRes = await mrrApiCall({ endpoint: '/rig/mine', clientNameRaw: acct });
      if (rigsRes.data?.success) {
        const rigList = extractArray(rigsRes.data);
        const parseStatus = (rig) => String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toLowerCase();
        const rentedRigs = [];
        let availableCount = 0;
        let offlineCount = 0;
        let disabledCount = 0;
        let warningCount = 0;
        let onlineCount = 0;

        for (const rig of rigList) {
          const status = parseStatus(rig);
          const rentedFlag = Boolean(rig?.status?.rented);
          const rentalId = rig?.status?.rentalid || rig?.rentalid;
          const onlineFlag = typeof rig?.status?.online === 'boolean' ? rig.status.online : Boolean(rig?.online);
          const isRented = rentedFlag || status.includes('rented') || status.includes('active');
          const isDisabled = status.includes('disabled');
          const isOffline = status.includes('offline') || !onlineFlag;
          const isWarning = status.includes('warning');
          const isAvailable = !isRented && !isDisabled && onlineFlag && (status.includes('available') || status.includes('online') || status === '');

          // TRACK INDIVIDUAL RIG STATUS CHANGES
          const rigIdKey = `rig_state_${rig.id}`;
          const prevStatus = lastRigStates.get(rigIdKey);
          const currentStatus = isOffline ? 'OFFLINE' : (isWarning ? 'WARNING' : (isDisabled ? 'DISABLED' : 'OK'));
          
          if (prevStatus && prevStatus !== currentStatus && currentStatus !== 'OK') {
             const statusEmoji = isOffline ? '🚫' : '⚠️';
             const rigAlertKey = `alert_${rigIdKey}_${currentStatus}`;
             const lastRigAlert = lastAlertTimes.get(rigAlertKey) || 0;
             
             if (now - lastRigAlert > ALERT_COOLDOWN_MS) {
                const rigMsg = `${statusEmoji} <b>[Rig Status: ${escapeHtml(acct)}]</b>\n` +
                  `━━━━━━━━━━━━━━\n` +
                  `<b>Rig:</b> ${escapeHtml(rig.name)}\n` +
                  `<b>ID:</b> <code>${rig.id}</code>\n` +
                  `<b>Status:</b> <b>${currentStatus}</b>\n` +
                  `<b>Algo:</b> <code>${escapeHtml(rig.algo || rig.type)}</code>\n` +
                  `━━━━━━━━━━━━━━\n` +
                  `<i>Please check your local miner connectivity.</i>`;
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
          if (isAvailable) availableCount += 1;
          if (isOffline) offlineCount += 1;
          if (isDisabled) disabledCount += 1;
          if (isWarning) warningCount += 1;
          if (onlineFlag) onlineCount += 1;
        }

        const alertKeyWarn = `${acct}_warn`;
        const lastWarnAlert = lastAlertTimes.get(alertKeyWarn) || 0;
        if (warningCount >= WARNING_RIG_THRESHOLD && (now - lastWarnAlert > ALERT_COOLDOWN_MS)) {
          const warnMsg = `🚨 <b>[Status Alert]</b>\n` +
            `<b>Account:</b> <code>${escapeHtml(acct)}</code>\n` +
            `━━━━━━━━━━━━━━\n` +
            `<b>Issue:</b> High Warning Count\n` +
            `<b>Count:</b> <b>${warningCount}</b> rigs\n` +
            `Please check your rig connectivity.`;
          await sendTelegramInternal(warnMsg).catch(e => console.error(`[monitor:error] Failed to send warning alert: ${e.message}`));
          lastAlertTimes.set(alertKeyWarn, now);
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
      }
      else if (rigsRes.data) {
        console.warn(`[${monitorTime}] [monitor] Account ${acct} rig list failed: ${rigsRes.data.message || 'Unknown'}`);
      }

      // Fetch both bought and sold rentals to ensure full visibility for both providers and renters
      const boughtRes = await mrrApiCall({ endpoint: '/rental', query: { type: 'bought' }, clientNameRaw: acct });
      const soldRes = await mrrApiCall({ endpoint: '/rental', query: { type: 'sold' }, clientNameRaw: acct });

      const allRentalsRaw = [
        ...(boughtRes.data?.success ? extractArray(boughtRes.data) : []),
        ...(soldRes.data?.success ? extractArray(soldRes.data) : [])
      ];

      // De-duplicate by ID in case the same rental appears in both categories or the API defaults change
      const rentalsMap = new Map(allRentalsRaw.map(r => [String(r.id), r]));
      
      // HARVESTER: If we saw a Rental ID in the rig list that isn't in the rental list, fetch it specifically
      for (const hid of harvestedRentalIds) {
        if (!rentalsMap.has(hid)) {
          console.log(`[${monitorTime}] [monitor] Account ${acct}: Harvesting missing rental details for #${hid}`);
          const hRes = await mrrApiCall({ endpoint: `/rental/${hid}`, clientNameRaw: acct });
          const hData = hRes.data?.data || hRes.data;
          if (hData && (hData.id || hRes.data?.success)) {
            rentalsMap.set(hid, hData);
          }
        }
      }
      harvestedRentalIds.clear(); // Clear for next account

      const rentals = Array.from(rentalsMap.values());

      if (!boughtRes.data?.success && !soldRes.data?.success) {
        console.warn(`[${monitorTime}] [monitor] Account ${acct} rental fetch failed.`);
        continue;
      }

      if (rentals.length > 0) {
        console.log(`[${monitorTime}] [monitor] Account ${acct}: Found ${rentals.length} active rentals.`);
      }

      for (const r of rentals) {
        // Fallback: If rental summary is missing hashrate (common for sold rentals), 
        // use the data we just got from the rig list.
        const liveRig = rigLookupByRentalId.get(String(r.id));
        if (liveRig) {
          r.hashrate = r.hashrate || {};
          // Inject current hashrate if missing or zero in the rental object
          if (!r.hashrate.current || r.hashrate.current === 0) {
            r.hashrate.current = liveRig.hashrate || liveRig.status?.hashrate || 0;
          }
          if (!r.name) r.name = liveRig.name;
        }

        const info = extractRentalInfo(r);
        const startTime = new Date(r.start + (String(r.start).endsWith('UTC') ? '' : ' UTC')).getTime();
        const endTime = new Date(r.end + (String(r.end).endsWith('UTC') ? '' : ' UTC')).getTime();
        const elapsedMs = now - startTime;
        const remainingMs = endTime - now;
        const totalDurationMs = endTime - startTime;
        const advertised = parseFloat(info.hashrate.advertised);
        const average = parseFloat(info.hashrate.average);
        const totalExpectedHashes = advertised * (totalDurationMs / 1000);
        const actualHashesDone = average * (elapsedMs / 1000);
        const remainingHashesNeeded = totalExpectedHashes - actualHashesDone;
        const requiredHashrate = remainingMs > 0 ? (remainingHashesNeeded / (remainingMs / 1000)) : 0;
        const displayTarget = requiredHashrate < 0 ? 0 : requiredHashrate;
        const efficiency = parseFloat(info.percent || 0);
        const currentHash = info.hashrate.current;

        const row = await new Promise((resolve) => {
          db.get(`SELECT last_notified, low_hashrate_start, zero_hashrate_start FROM rentals WHERE id = ?`, [String(r.id)], (err, rowData) => resolve(rowData));
        });

        let lowHashStart = row?.low_hashrate_start || 0;
        let zeroHashStart = row?.zero_hashrate_start || 0;

        if (efficiency < 50) {
          if (lowHashStart === 0) lowHashStart = now;
          if (now - lowHashStart >= 900000) {
            const alertKey = `${r.id}_low_50`;
            const lastAlert = lastAlertTimes.get(alertKey) || 0;
            if (now - lastAlert > ALERT_COOLDOWN_MS) {
              const msg = `⚠️ <b>[Efficiency Alert]</b>\n` +
                `<b>Account:</b> <code>${escapeHtml(acct)}</code>\n` +
                `━━━━━━━━━━━━━━\n` +
                `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
                `<b>Efficiency:</b> <b>${efficiency.toFixed(1)}%</b> (< 50% for 15m)\n` +
                `<b>Target:</b> ${displayTarget.toFixed(2)} ${info.hashrate.suffix}`;
              await sendTelegramInternal(msg).catch(e => console.error(`[monitor:error] Low hashrate alert failed: ${e.message}`));
              console.log(`[${monitorTime}] [monitor] Sending Telegram alert: [Performance Alert] for Rig ${r.id}`);
              lastAlertTimes.set(alertKey, now);
            }
          }
        } else {
          lowHashStart = 0;
        }

        if (currentHash === 0) {
          if (zeroHashStart === 0) zeroHashStart = now;
          if (now - zeroHashStart >= 300000) {
            const alertKey = `${r.id}_zero_5m`;
            const lastAlert = lastAlertTimes.get(alertKey) || 0;
            if (now - lastAlert > ALERT_COOLDOWN_MS) {
              const msg = `🚨 <b>[Critical Alert]</b>\n` +
                `<b>Account:</b> <code>${escapeHtml(acct)}</code>\n` +
                `━━━━━━━━━━━━━━\n` +
                `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
                `<b>Status:</b> <b>ZERO HASHRATE</b> (> 5m)\n` +
                `<b>Paid:</b> <code>${info.price.paid} ${info.price.currency}</code>`;
              await sendTelegramInternal(msg).catch(e => console.error(`[monitor:error] Zero hashrate alert failed: ${e.message}`));
              console.log(`[${monitorTime}] [monitor] Sending Telegram alert: [Critical Alert] for Rig ${r.id}`);
              lastAlertTimes.set(alertKey, now);
            }
          }
        } else {
          zeroHashStart = 0;
        }

        if (elapsedMs > 0 && elapsedMs < 3600000 && efficiency < 70) {
          const startupKey = `${r.id}_startup_70`;
          const lastAlert = lastAlertTimes.get(startupKey) || 0;
          if (now - lastAlert > ALERT_COOLDOWN_MS) {
            const msg = `🚀 <b>[Startup Alert]</b>\n` +
              `<b>Account:</b> <code>${escapeHtml(acct)}</code>\n` +
              `━━━━━━━━━━━━━━\n` +
              `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
              `<b>Efficiency:</b> <b>${efficiency.toFixed(1)}%</b> (< 70% in 1st hour)\n` +
              `<b>Target:</b> ${displayTarget.toFixed(2)} ${info.hashrate.suffix}`;
            console.log(`[${monitorTime}] [monitor] Sending Telegram alert: [Startup Alert] for Rig ${r.id}`);
            await sendTelegramInternal(msg).catch(e => console.error(`[monitor:error] Startup alert failed: ${e.message}`));
            lastAlertTimes.set(startupKey, now);
          }
        }

        if (remainingMs > 0 && remainingMs < 3600000 && efficiency < 70) {
          const completionKey = `${r.id}_completion_70`;
          const lastAlert = lastAlertTimes.get(completionKey) || 0;
          if (now - lastAlert > ALERT_COOLDOWN_MS) {
            const msg = `🏁 <b>[Completion Alert]</b>\n` +
              `<b>Account:</b> <code>${escapeHtml(acct)}</code>\n` +
              `━━━━━━━━━━━━━━\n` +
              `<b>Rig:</b> ${escapeHtml(r.name || r.id)} (<code>${r.id}</code>)\n` +
              `<b>Efficiency:</b> <b>${efficiency.toFixed(1)}%</b> (< 70% in last hour)\n` +
              `<b>Target:</b> ${displayTarget.toFixed(2)} ${info.hashrate.suffix}`;
            console.log(`[${monitorTime}] [monitor] Sending Telegram alert: [Completion Alert] for Rig ${r.id}`);
            await sendTelegramInternal(msg).catch(e => console.error(`[monitor:error] Completion alert failed: ${e.message}`));
            lastAlertTimes.set(completionKey, now);
          }
        }

        // Format detailed rental line for the summary heartbeat
        const startStr = String(r.start || '').replace(/:\d{2} UTC/i, '').replace(/^\d{4}-/, '');
        const endStr = String(r.end || '').replace(/:\d{2} UTC/i, '').replace(/^\d{4}-/, '').trim();
        const perfEmoji = efficiency >= 98 ? '🟢' : (efficiency >= 70 ? '🟡' : '🔴');
        activeRentalLines.push(`${perfEmoji} [${escapeHtml(acct)}] <b>${escapeHtml(r.name || r.id)}</b>\n    ${info.niceAverageHashrate} | ${startStr} - ${endStr} | <b>${info.percent}%</b>`);

        await new Promise((resolve) => {
          db.run(`INSERT INTO rentals (id, name, client, algo, target_100, last_updated, low_hashrate_start, zero_hashrate_start) 
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET 
                  name=excluded.name, client=excluded.client, algo=excluded.algo, 
                  target_100=excluded.target_100, last_updated=excluded.last_updated,
                  low_hashrate_start=excluded.low_hashrate_start, zero_hashrate_start=excluded.zero_hashrate_start`,
            [String(r.id), r.name || r.id, acct, info.algo, displayTarget, now, lowHashStart, zeroHashStart],
            (err) => { if (err) console.error(`[monitor:db_error] ${err.message}`); resolve(); });
        });

        const lastNotified = row?.last_notified || 0;
        // FIX: Notify if it's the first time we see it, ignoring clock skew (elapsedMs < 0)
        // and providing a wider window to catch up after downtime.
        const isNewToMonitor = lastNotified === 0;
        const withinReasonableStart = elapsedMs < (12 * 60 * 60 * 1000); 
        const shouldNotify = forceNotify || (isNewToMonitor && withinReasonableStart);

        if (shouldNotify) {
          const hbType = forceNotify ? 'MONITOR' : 'RENTED';
          const roi = (efficiency - 100).toFixed(1);
          const timeProgress = totalDurationMs > 0 ? Math.floor((elapsedMs / totalDurationMs) * 100) : 0;
          
          const remD = Math.floor(remainingMs / 86400000);
          const remH = Math.floor((remainingMs % 86400000) / 3600000);
          const remStr = remD > 0 ? `${remD}d ${remH}h` : `${remH}h`;

          const msg = `<b>#${r.id}</b>\n\n` +
            `[${escapeHtml(info.algo).toUpperCase()}] [${escapeHtml(acct).toUpperCase()}] [${hbType}]\n\n` +
            `<b>Hashrate</b>\n` +
            `${info.niceAverageHashrate}\n\n` +
            `<b>ROI</b>\n` +
            `${roi >= 0 ? '+' : ''}${roi}%\n\n` +
            `<b>Remaining</b>\n` +
            `${remStr}\n\n` +
            `<b>Progress</b>\n` +
            `${timeProgress}%\n\n` +
            `<b>Price</b> ${info.price.paid} ${info.price.currency}\n\n` +
            `<a href="https://www.miningrigrentals.com/rentals/view/${r.id}">[Details]</a>`;

          try {
            console.log(`[${monitorTime}] [monitor] Sending Telegram alert: ${hbType} for Rig ${r.id}`);
            const tgRes = await sendTelegramInternal(msg);
            await new Promise((resolve) => db.run(`UPDATE rentals SET last_notified = ? WHERE id = ?`, [now, String(r.id)], () => resolve()));
            notifications.push({ id: r.id, status: 'Sent', telegram: tgRes });
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

  // Detect finished rentals (those in DB but not seen in this run)
  const accountListStr = mrrAccts.map(a => `'${a}'`).join(',');
  const finishedRentals = await new Promise((resolve) => {
    if (mrrAccts.length === 0) return resolve([]);
    // Only look for missing rentals within the accounts we just scanned
    db.all(`SELECT * FROM rentals WHERE last_updated < ? AND client IN (${accountListStr})`, [now], (err, rows) => resolve(rows || []));
  });
  for (const fr of finishedRentals) {
    const finishMsg = `🏁 <b>[Rental Finished]</b>\n` +
      `<b>Account:</b> <code>${escapeHtml(fr.client)}</code>\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Rig:</b> ${escapeHtml(fr.name || fr.id)} (<code>${fr.id}</code>)\n` +
      `━━━━━━━━━━━━━━\n` +
      `<b>Algo:</b> <code>${escapeHtml(fr.algo)}</code>\n` +
      `<b>Final Target:</b> ${fr.target_100 ? fr.target_100.toFixed(2) : 'N/A'}`;
    console.log(`[${monitorTime}] [monitor] Sending finish notice for ${fr.id}`);
    await sendTelegramInternal(finishMsg).catch(e => console.warn(`[monitor:error] Finish notice failed: ${e.message}`));
    await new Promise((resolve) => db.run(`DELETE FROM rentals WHERE id = ?`, [fr.id], () => resolve()));
  }

  const shouldSendCombinedSummary = forceNotify || (now - (lastAlertTimes.get('global_summary') || 0) >= RENTED_HEARTBEAT_MS);
  if (shouldSendCombinedSummary && (accountMetrics.length > 0 || activeRentalLines.length > 0)) {
    const maxBarLen = 14;
    const barChart = accountMetrics.map(am => {
      const ratio = totalAll > 0 ? am.total / totalAll : 0;
      const filled = Math.max(1, Math.round(ratio * maxBarLen));
      const bar = '█'.repeat(filled);
      return `<code>${am.name.padEnd(4)}${bar.padEnd(maxBarLen + 2)}${am.total}</code>`;
    }).join('\n');

    const allSummaryMsg = `🏭 <b>Infrastructure Overview</b>\n\n` +
      `${barChart}\n\n` +
      `━━━━━━━━━━━━━━\n\n` +
      `<code>Online      ${String(onlineAll).padStart(4)}</code>\n` +
      `<code>Rented      ${String(rentedAll).padStart(4)}</code>\n` +
      `<code>Offline     ${String(offlineAll).padStart(4)}</code>\n` +
      `<code>Disabled    ${String(disabledAll).padStart(4)}</code>\n\n` +
      `<b>Fleet Total ${totalAll}</b>\n\n` +
      (activeRentalLines.length > 0 ? `━━━━━━━━━━━━━━\n<b>Active Rentals</b>\n` + activeRentalLines.join('\n') : '') +
      `\n<i>Refreshed at ${monitorTime}</i>`;

    try {
      console.log(`[${monitorTime}] [monitor] Sending combined summary heartbeat to Telegram (${activeRentalLines.length} active rentals)`);
      await sendTelegramInternal(allSummaryMsg);
      lastAlertTimes.set('global_summary', now);
    } catch (e) {
      console.error(`[monitor:error] Failed to send ALL summary: ${e.message}`);
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
      perAccount: summaryParts,
      activeRentals: allRentedRigs.map(r => ({ account: r.acct, id: r.id, name: r.name || r.id })),
    },
  };
}
