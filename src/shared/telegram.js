export const TELEGRAM_CONFIG = {
  ALERT_COOLDOWN_MS: 15 * 60 * 1000,
  WARNING_RIG_THRESHOLD: 3,
  RENTED_HEARTBEAT_MS: 15 * 60 * 1000,
};

export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatAccount(account) {
  return escapeHtml(account || 'N/A');
}

function formatRig(r) {
  return `${escapeHtml(r?.name || r?.id || 'N/A')} (<code>${escapeHtml(r?.id || 'N/A')}</code>)`;
}

function formatHashrate(value, suffix) {
  const num = Number.parseFloat(value || 0);
  if (!Number.isFinite(num) || num <= 0) return '0 N/A';
  return `${num.toFixed(2)} ${suffix || ''}`.trim();
}

function formatTimeRange(start, end) {
  return `${start || 'N/A'} - ${end || 'N/A'}`;
}

export const TelegramTemplates = {
  systemStarted(accts) {
    const accounts = accts || 'N/A';
    return `🚀 <b>[System Started]</b>\n` +
      `<b>Accounts:</b> <code>${escapeHtml(accounts)}</code>\n` +
      `All monitoring services are now active.`;
  },

  rigStatusWarning(account, rig) {
    return `⚠️ <b>[Rig Warning]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(account)}</code>\n` +
      `<b>Rig:</b> ${formatRig(rig)}\n` +
      `<i>Rig status changed to WARNING.</i>`;
  },

  highWarningCount(account, warningCount) {
    return `⚠️ <b>[High Warning Count]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(account)}</code>\n` +
      `<b>Warnings:</b> <code>${Number(warningCount || 0)}</code>\n` +
      `<i>Multiple rigs are reporting warnings.</i>`;
  },

  efficiency(account, r, info, efficiency, displayTarget) {
    return `⚠️ <b>[Alert] Low Efficiency</b>\n` +
      `<b>Account:</b> <code>${formatAccount(account)}</code>\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(info?.algo || 'N/A')}</code>\n` +
      `<b>Avg:</b> ${formatHashrate(info?.niceAverageHashrate, info?.hashrate?.suffix)} (<b>${Number(efficiency || 0).toFixed(1)}%</b>)\n` +
      `<b>Target:</b> <code>${displayTarget ? Number(displayTarget).toFixed(2) : '0.00'} ${escapeHtml(info?.hashrate?.suffix || '')}</code>`;
  },

  zeroHashrate(account, r, info) {
    return `🚨 <b>[Critical] Zero Hashrate!</b>\n` +
      `<b>Account:</b> <code>${formatAccount(account)}</code>\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(info?.algo || 'N/A')}</code>\n` +
      `<b>Current:</b> <b>0%</b>`;
  },

  startup(account, r, info, efficiency, displayTarget) {
    return `🚀 <b>[Startup Alert]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(account)}</code>\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(info?.algo || 'N/A')}</code>\n` +
      `<b>Avg:</b> ${formatHashrate(info?.niceAverageHashrate, info?.hashrate?.suffix)} (<b>${Number(efficiency || 0).toFixed(1)}%</b>)\n` +
      `<b>Target:</b> <code>${displayTarget ? Number(displayTarget).toFixed(2) : '0.00'} ${escapeHtml(info?.hashrate?.suffix || '')}</code>`;
  },

  completion(account, r, info, efficiency, displayTarget) {
    return `🏁 <b>[Completion Alert]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(account)}</code>\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(info?.algo || 'N/A')}</code>\n` +
      `<b>Avg:</b> ${formatHashrate(info?.niceAverageHashrate, info?.hashrate?.suffix)} (<b>${Number(efficiency || 0).toFixed(1)}%</b>)\n` +
      `<b>Target:</b> <code>${displayTarget ? Number(displayTarget).toFixed(2) : '0.00'} ${escapeHtml(info?.hashrate?.suffix || '')}</code>`;
  },

  rentedNotice(hbType, r, info, account, roi, remStr) {
    return `💎 <b>[${escapeHtml(hbType || 'RENTED')}] #${escapeHtml(r?.id || 'N/A')}</b>\n` +
      `<b>Account:</b> <code>${formatAccount(account)}</code>\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(info?.algo || r?.algo || r?.rig?.type || 'N/A')}</code>\n` +
      `<b>Hash:</b> <code>${formatHashrate(info?.niceAverageHashrate, info?.hashrate?.suffix)}</code>\n` +
      `<b>ROI:</b> <code>${Number(roi || 0) >= 0 ? '+' : ''}${Number(roi || 0).toFixed(1)}%</code>\n` +
      `<b>Time:</b> <code>${escapeHtml(remStr || 'N/A')} left</code>`;
  },

  finished(enriched, info) {
    return `✅ <b>[Rental Finished]</b>\n` +
      `<b>Rig:</b> ${formatRig(enriched)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(info?.algo || 'N/A')}</code>\n` +
      `<b>Duration:</b> <code>${escapeHtml(info?.duration || 'N/A')}</code>`;
  },

  heartbeatSummary(barChart, onlineAll, rentedAll, offlineAll, disabledAll, totalAll, activeRentalLines, finishTime) {
    const active = Array.isArray(activeRentalLines) ? activeRentalLines.join('\n') : String(activeRentalLines || '');
    const divider = '━━━━━━━━━━━━━━━━━━━';
    return `📊 <b>[Heartbeat Summary]</b>\n` +
      `<b>Time:</b>  <code>${escapeHtml(finishTime || 'N/A')}</code>\n` +
      `${divider}\n` +
      `<b>Total</b>  <code>${Number(totalAll || 0)}</code>`  +
      ` | (<b>Disabled</b>  <code>${Number(disabledAll || 0)}</code>)\n` +
      `<b>Online</b>  <code>${Number(onlineAll || 0)}</code> `  +
      ` | (<b>Offline</b>  <code>${Number(offlineAll || 0)}</code>)\n` +
      `♻️ <b>Rented</b> <code>${Number(rentedAll || 0)}</code>\n` +
      // `${divider}\n` +
      // `${barChart ? `${barChart}\n` : ''}` +
      // `${divider}\n` +
      `${divider}\n` +
      `<b>Active Rentals</b>\n` +
      `${active || '<i>No active rentals</i>'}`;
  },

  newRental(account, r, paid, startStr, endStr) {
    return `🚀 <b>[New Rental]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(account)}</code>\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(r?.algo || r?.rig?.type || 'N/A')}</code>\n` +
      `<b>Time:</b> ${formatTimeRange(startStr, endStr)}\n` +
      `<b>Paid:</b> ${escapeHtml(paid || '0.00')}\n` +
      `<i>Rental has been successfully initialized.</i>`;
  },

  zeroHashrateAlert(account, r, elapsedMs, paid) {
    return `🚨 <b>[Critical] Zero Hashrate!</b>\n` +
      `<b>Account:</b> <code>${formatAccount(account)}</code>\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Duration:</b> ${Math.round(Number(elapsedMs || 0) / 1000)}s\n` +
      `<b>Paid:</b> ${escapeHtml(paid || '0.00')}`;
  },

  lowEfficiency(account, r, avg, suffix, efficiency, remainingMs, paid) {
    return `⚠️ <b>[Alert] Low Efficiency</b>\n` +
      `<b>Account:</b> <code>${formatAccount(account)}</code>\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Avg:</b> ${escapeHtml(avg)} ${escapeHtml(suffix || '')} (<b>${Number(efficiency || 0).toFixed(1)}%</b>)\n` +
      `<b>Left:</b> ${Math.round(Number(remainingMs || 0) / 60000)}m\n` +
      `<b>Paid:</b> ${escapeHtml(paid || '0.00')}`;
  },

  startupNotice(account, r, avg, suffix, efficiency, paid) {
    return `🚀 <b>[Startup Alert]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(account)}</code>\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Avg:</b> ${escapeHtml(avg)} ${escapeHtml(suffix || '')} (<b>${Number(efficiency || 0).toFixed(1)}%</b>)\n` +
      `<b>Paid:</b> ${escapeHtml(paid || '0.00')}`;
  },

  completionNotice(account, r, avg, suffix, efficiency, paid) {
    return `🏁 <b>[Completion Alert]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(account)}</code>\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Avg:</b> ${escapeHtml(avg)} ${escapeHtml(suffix || '')} (<b>${Number(efficiency || 0).toFixed(1)}%</b>)\n` +
      `<b>Paid:</b> ${escapeHtml(paid || '0.00')}`;
  },
};

