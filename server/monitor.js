import { request } from 'undici';
import { db } from './db.js';
import { mrrApiCall, mrrConfigs } from './mrr.js';
import { resolveNhClient, getNiceHashApp, isAggregate } from './nh.js';
import { extractRentalInfo, extractRigInfo } from './utils.js';

const ALERT_COOLDOWN_MS = 600000;
const WARNING_RIG_THRESHOLD = 5;
const NEW_RENTAL_WINDOW_MS = 15 * 60 * 1000;
const RENTED_HEARTBEAT_MS = 15 * 60 * 1000;
const lastAlertTimes = new Map();

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
      throw new Error(`Telegram API rejected message: ${reason}`);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 300));
      }
    }
  }

  throw lastError || new Error('Telegram send failed');
}

export async function runRentalMonitor(forceNotify = false, clientScope = 'ALL') {
  const monitorTime = new Date().toLocaleTimeString();
  const requestedScope = String(clientScope || 'ALL').trim().toUpperCase();
  const allConfiguredAccts = Object.keys(mrrConfigs).filter(k => mrrConfigs[k].apiKey && mrrConfigs[k].apiSecret);
  const mrrAccts = isAggregate(requestedScope)
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
  const allRentedRigs = [];

  console.log(`[${monitorTime}] [monitor] Starting check for ${mrrAccts.length} accounts...`);

  for (const acct of mrrAccts) {
    try {
      const rigsRes = await mrrApiCall({ endpoint: '/rig/mine', clientNameRaw: acct });
      if (rigsRes.data?.success) {
        const rigList = Array.isArray(rigsRes.data.data) ? rigsRes.data.data : (rigsRes.data.data?.rigs || []);
        const parseStatus = (rig) => String(typeof rig.status === 'object' ? rig.status.status : rig.status || '').toLowerCase();
        const rentedRigs = [];
        let availableCount = 0;
        let offlineCount = 0;
        let disabledCount = 0;
        let warningCount = 0;

        for (const rig of rigList) {
          const status = parseStatus(rig);
          const rentedFlag = Boolean(rig?.status?.rented);
          const onlineFlag = typeof rig?.status?.online === 'boolean' ? rig.status.online : Boolean(rig?.online);
          const isRented = rentedFlag || status.includes('rented') || status.includes('active');
          const isDisabled = status.includes('disabled');
          const isOffline = status.includes('offline') || !onlineFlag;
          const isWarning = status.includes('warning');
          const isAvailable = !isRented && !isDisabled && onlineFlag && (status.includes('available') || status.includes('online') || status === '');

          if (isRented) rentedRigs.push(rig);
          if (isAvailable) availableCount += 1;
          if (isOffline) offlineCount += 1;
          if (isDisabled) disabledCount += 1;
          if (isWarning) warningCount += 1;
        }

        const alertKeyWarn = `${acct}_warn`;
        const lastWarnAlert = lastAlertTimes.get(alertKeyWarn) || 0;
        if (warningCount >= WARNING_RIG_THRESHOLD && (now - lastWarnAlert > ALERT_COOLDOWN_MS)) {
          const warnMsg = `🚨 <b>[Status Alert: ${acct}]</b>\n\n` +
            `High number of rigs in warning state: <b>${warningCount}</b>\n` +
            `Please check your rig connectivity.`;
          await sendTelegramInternal(warnMsg).catch(e => console.error(`[monitor:error] Failed to send warning alert: ${e.message}`));
          lastAlertTimes.set(alertKeyWarn, now);
        }

        summaryParts.push(`📊 <b>${acct}</b>: ${rigList.length} rigs (Avail: ${availableCount}, Rented: ${rentedRigs.length}, Offline: ${offlineCount}, Disabled: ${disabledCount}, Warn: ${warningCount})`);
        totalAll += rigList.length;
        availableAll += availableCount;
        rentedAll += rentedRigs.length;
        offlineAll += offlineCount;
        disabledAll += disabledCount;
        warningAll += warningCount;
        allRentedRigs.push(...rentedRigs.map(r => ({ ...r, acct })));
      }

      const { data } = await mrrApiCall({ endpoint: '/rental', clientNameRaw: acct });
      if (!data?.success) continue;

      const rentals = Array.isArray(data.data) ? data.data : (data.data?.rentals || []);
      for (const r of rentals) {
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

        if (efficiency < 50 && efficiency > 0) {
          if (lowHashStart === 0) lowHashStart = now;
          if (now - lowHashStart >= 900000) {
            const alertKey = `${r.id}_low_50`;
            const lastAlert = lastAlertTimes.get(alertKey) || 0;
            if (now - lastAlert > ALERT_COOLDOWN_MS) {
              const msg = `⚠️ <b>[Performance Alert: ${acct}]</b>\n\n` +
                `Rig <b>${r.name || r.id}</b> is underperforming!\n` +
                `Efficiency: <b>${efficiency}%</b> (< 50% for 15m)`;
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
              const msg = `🚨 <b>[Critical Alert: ${acct}]</b>\n\n` +
                `Rig <b>${r.name || r.id}</b> has ZERO hashrate!\n` +
                `Duration: <b>> 5 mins</b>`;
              await sendTelegramInternal(msg).catch(e => console.error(`[monitor:error] Zero hashrate alert failed: ${e.message}`));
              console.log(`[${monitorTime}] [monitor] Sending Telegram alert: [Critical Alert] for Rig ${r.id}`);
              lastAlertTimes.set(alertKey, now);
            }
          }
        } else {
          zeroHashStart = 0;
        }

        if (elapsedMs > 0 && elapsedMs < 3600000 && efficiency < 70 && efficiency > 0) {
          const startupKey = `${r.id}_startup_70`;
          const lastAlert = lastAlertTimes.get(startupKey) || 0;
          if (now - lastAlert > ALERT_COOLDOWN_MS) {
            const msg = `🚀 <b>[Startup Alert: ${acct}]</b>\n\n` +
              `Rig <b>${r.name || r.id}</b> startup efficiency is low!\n` +
              `Efficiency: <b>${efficiency}%</b> (< 70% in first hour)\n` +
              `Account: ${acct}`;
            console.log(`[${monitorTime}] [monitor] Sending Telegram alert: [Startup Alert] for Rig ${r.id}`);
            await sendTelegramInternal(msg).catch(e => console.error(`[monitor:error] Startup alert failed: ${e.message}`));
            lastAlertTimes.set(startupKey, now);
          }
        }

        await new Promise((resolve) => {
          db.run(`INSERT INTO rentals (id, name, client, algo, target_100, last_updated, low_hashrate_start, zero_hashrate_start) 
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET 
                  name=excluded.name, client=excluded.client, algo=excluded.algo, 
                  target_100=excluded.target_100, last_updated=excluded.last_updated,
                  low_hashrate_start=excluded.low_hashrate_start, zero_hashrate_start=excluded.zero_hashrate_start`,
            [String(r.id), r.name || r.id, acct, info.algo, displayTarget, now, lowHashStart, zeroHashStart],
            () => resolve());
        });

        const lastNotified = row?.last_notified || 0;
        const isNewRental = lastNotified === 0 && elapsedMs >= 0 && elapsedMs < NEW_RENTAL_WINDOW_MS;
        const shouldNotify = forceNotify || isNewRental;

        if (shouldNotify) {
          const remHours = Math.max(0, remainingMs / 3600000).toFixed(2);
          const hbType = forceNotify ? 'Forced Monitor' : 'New Rental';
          const icon = forceNotify ? '💓' : '🚀';

          const msg = `${icon} <b>[${hbType}]</b>\n\n` +
            `<b>Rig:</b> ${r.name || r.id}` + `<b>Account:</b> ${acct}` + `\n` +
            `<b>Algo:</b> ${info.algo}\n` +
            `<b>Current Avg:</b> ${info.niceAverageHashrate}\n` +
            `<b>Efficiency:</b> ${info.percent}%\n` +
            `<b>Paid:</b> ${info.price.paid} ${info.price.currency}\n` +
            `<b>Remaining:</b> ${remHours}h\n` +
            `<b>Target to 100%:</b> ${displayTarget.toFixed(2)} ${info.hashrate.suffix}\n`;

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

  const shouldSendCombinedSummary = forceNotify || (now - (lastAlertTimes.get('global_summary') || 0) >= RENTED_HEARTBEAT_MS);
  if (shouldSendCombinedSummary && summaryParts.length > 0) {
    const allSummaryMsg = `📊 <b>[Current Rented Heartbeat - 15m]</b>\n\n` +
      summaryParts.join('\n') +
      `\n\n<b>Totals</b>: ${totalAll} rigs | ${availableAll} Avail | ${rentedAll} Rented | ${offlineAll} Offline | ${disabledAll} Disabled | ${warningAll} Warn` +
      (allRentedRigs.length > 0 ? `\n\n<b>Active Rentals:</b>\n${allRentedRigs.map(r => `- [${r.acct}] ${r.name || r.id}`).join('\n')}` : '');

    try {
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
