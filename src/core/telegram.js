export const TELEGRAM_CONFIG = {
  ALERT_COOLDOWN_MS: 10 * 60 * 1000,
  WARNING_RIG_THRESHOLD: 3,
  RENTED_HEARTBEAT_MS: 60 * 60 * 1000,
};

export function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatAccount(account) {
  return escapeHtml(account || "N/A");
}

export function formatRig(r) {
  return `${escapeHtml(r?.name || r?.id || "N/A")} (<code>${escapeHtml(r?.id || "N/A")}</code>)`;
}

export function formatHashrate(value, suffix) {
  const num = Number.parseFloat(value || 0);
  if (!Number.isFinite(num) || num <= 0) return "0 N/A";
  return `${num.toFixed(2)} ${suffix || ""}`.trim();
}

export function formatTimeRange(start, end) {
  return `${start || "N/A"} - ${end || "N/A"}`;
}

const divider = "━━━━━━━━━━━━━━";

/**
 * Shared Telegram Templates
 */
export const TelegramTemplates = {
  divider,

  activeRentalLine: (
    perfEmoji,
    algo,
    name,
    remaining,
    efficiency,
    roi,
    avg,
    ads,
    cur,
    target,
    extra,
    client,
    info = { price: {} },
  ) => {
    return (
      `${perfEmoji} <b>${escapeHtml(algo)}</b> 🔀 <b>${escapeHtml(client)}</b> | ${escapeHtml(name)}\n` +
      `⏱ Remaining: ${remaining}\n` +
      `⚡ Cur: <b>${cur}</b> | ` +
      `📊 Eff: <code>${typeof efficiency === "number" ? efficiency.toFixed(2) : efficiency}%</code>\n` +
      `📈 Avg: <code>${avg}</code> | Adv: <code>${ads}</code>\n` +
      `💰 Paid: <b>${escapeHtml(info.price?.paid)} ${escapeHtml(info.price?.currency)}</b>\n` +
      `${extra}${divider}\n`
    );
  },

  rentedNotice: (type, r, info, acct, diff, rem, algo, ads) => {
    return (
      `🚀 <b>[${type}]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(acct)}</code>\n` +
      `${divider}\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(algo)}</code>\n` +
      `<b>Time:</b> ${formatTimeRange(info.startTime, info.endTime)}\n` +
      `${divider}\n` +
      `<b>Paid:</b> <code>${info.price.paid} ${info.price.currency}</code>\n` +
      `<b>Efficiency:</b> <b>${info.percent}%</b> (Diff: ${diff}%)\n` +
      `Adv: <code>${ads}</code>\n` +
      `<b>Remaining:</b> ${rem}\n` +
      `<b>Target to 100%:</b> ${info.targetHashrate || "N/A"}`
    );
  },

  zeroHashrate: (acct, r, info, algo, ads) => {
    return (
      `⚠️ <b>[ZERO HASHRATE]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(acct)}</code>\n` +
      `${divider}\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(algo)}</code>\n` +
      `<b>Status:</b> 0 H/s (Target: ${info.targetHashrate})\n` +
      `Adv: <code>${ads}</code>\n` +
      `<b>Rental:</b> <code>${r.id}</code>`
    );
  },

  efficiency: (acct, r, info, efficiency, target, algo, ads) => {
    return (
      `📉 <b>[LOW EFFICIENCY]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(acct)}</code>\n` +
      `${divider}\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(algo)}</code>\n` +
      `<b>Efficiency:</b> <b>${efficiency}%</b>\n` +
      `<b>Average:</b> ${info.niceAverageHashrate}\n` +
      `Adv: <code>${ads}</code>\n` +
      `<b>Target to 100%:</b> ${target.toFixed(2)} ${info.hashrate.suffix || ""}`
    );
  },

  startup: (acct, r, info, efficiency, target, algo, ads) => {
    return (
      `⏱ <b>[STARTUP ALERT]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(acct)}</code>\n` +
      `${divider}\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(algo)}</code>\n` +
      `<b>Initial Eff:</b> ${efficiency}%\n` +
      `Adv: <code>${ads}</code>\n` +
      `<b>Paid:</b> ${info.price.paid} ${info.price.currency}\n` +
      `<b>Time:</b> ${formatTimeRange(info.startTime)}\n` +
      `<b>Target:</b> ${target.toFixed(2)} ${info.hashrate.suffix || ""}`
    );
  },

  completionAlert: (acct, ads, r, info, efficiency, target, algo) => {
    return (
      `🏁 <b>[ALMOST COMPLETE]</b>\n` +
      `<b>Algo:</b> <code>${escapeHtml(algo)}</code>\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Account:</b> <code>${formatAccount(acct)}</code>\n` +
      `${divider}\n` +
      `<b>Time:</b> ${formatTimeRange(info.startTime)}\n` +
      `<b>Final Eff:</b> ${efficiency}%\n` +
      `Adv: <code>${ads}</code>\n` +
      `<b>Target:</b> ${target.toFixed(2)}`
    );
  },

  completionSuccess: (
    acct,
    r,
    info = { price: {} },
    efficiency,
    ads,
    avg,
    suffix,
    algo,
  ) => {
    return (
      `✅ <b>[RENTAL SUCCESS]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(acct)}</code>\n` +
      `${divider}\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(algo)}</code>\n` +
      `<b>Avg Speed:</b> ${avg} ${suffix}\n` +
      `<b>Adv:</b> <code>${ads}</code>\n` +
      `<b>Final Efficiency:</b> <b>${parseFloat(efficiency).toFixed(2)}%</b>\n` +
      `<b>Paid:</b> ${escapeHtml(info.price?.paid)} ${escapeHtml(info.price?.currency)}`
    );
  },

  perfectEfficiency: (acct, r, efficiency, info, ads, remainingMs, algo) => {
    const remH = Math.floor(remainingMs / 3600000);
    return (
      `💯 <b>[PERFECT 100%]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(acct)}</code>\n` +
      `${divider}\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(algo)}</code>\n` +
      `<b>Status:</b> Running perfectly at ${efficiency}%\n` +
      `<b>Remaining:</b> ~${remH}h\n` +
      `Adv: <code>${ads}</code>\n` +
      `<b>Cost:</b> ${info.price.paid} ${info.price.currency}`
    );
  },

  finished: (r, info, algo, ads) => {
    return (
      `🏁 <b>[RENTAL FINISHED]</b>\n` +
      `<b>Account:</b> <code>${formatAccount(r.client)}</code>\n` +
      `${divider}\n` +
      `<b>Rig:</b> ${formatRig(r)}\n` +
      `<b>Algo:</b> <code>${escapeHtml(algo)}</code>\n` +
      `<b>Final Avg:</b> ${info.niceAverageHashrate}\n` +
      `Adv: <code>${ads}</code>\n` +
      `<b>Final Eff:</b> <b>${info.percent}%</b>\n` +
      `<b>Total Paid:</b> ${info.price.paid} ${info.price.currency}`
    );
  },

  heartbeatSummary: (
    barChart,
    online,
    rented,
    offline,
    disabled,
    total,
    lines,
    time,
    rented24h,
    algos,
  ) => {
    return (
      `📊 <b>SUMMARY</b> [${time}]\n` +
      `${divider}\n` +
      `🟢 Online: <b>${online}</b> / Renting: <b>${rented}</b>\n` +
      `🔴 Offline: <b>${offline}</b> / Disabled: <b>${disabled}</b>\n` +
      `📦 Total Rigs: <b>${total}</b>\n` +
      `🆕 Rented (24h): <b>${rented24h}</b>\n` +
      `${divider}\n` +
      `<b>Algorithms Online:</b>\n${algos.join("\n")}\n` +
      `${divider}\n` +
      `<b>Active Rentals Detail:</b>\n\n<code>${lines.join("")}</code>`
    );
  },

  rigStatusWarning: (acct, rig, algo, ads) =>
    `⚠️ <b>[RIG WARNING]</b>\n<b>MRR:</b> ${formatAccount(acct)}\n<b>Rig:</b> ${formatRig(rig)}\n<b>Algo:</b> <code>${escapeHtml(algo)}</code>\n Adv: <code>${ads}</code>\n <b>Status:</b> <code>${rig.status?.status || rig.status}</code>`,
  highWarningCount: (acct, count, algo) =>
    `⚠️ <b>[SYSTEM ALERT]</b>\n<b>MRR:</b> ${formatAccount(acct)}\n<b>High Warning Count:</b> <b>${count}</b> rigs in warning state.`,
};
