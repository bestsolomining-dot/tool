// server/telegram/telegramClient.js

let logged = false;

export async function sendMineTelegram(message) {
  const botToken = process.env.TELEGRAM_MINE_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GROUP_ID;

  if (!logged) {
    logged = true;
    console.log("[Telegram] Config:", {
      tokenSet: !!botToken,
      tokenLength: botToken ? botToken.length : 0,
      chatIdSet: !!chatId,
      chatIdLength: chatId ? chatId.length : 0,
    });
  }

  if (!botToken || !chatId) {
    console.warn("[Telegram] Missing bot token or chat ID");
    return null;
  }

  const text = String(message || "").trim();
  if (!text) return null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        console.log(`[Telegram] Message sent (attempt ${attempt})`);
        return data;
      }
      if (data?.description?.includes("chat not found")) {
        console.error("[Telegram] Chat ID not found! Check TELEGRAM_GROUP_ID");
        return null;
      }
      if (data?.description?.includes("bot was blocked")) {
        console.error("[Telegram] Bot was blocked by user!");
        return null;
      }
      throw new Error(data?.description || `HTTP ${res.status}`);
    } catch (err) {
      console.warn(`[Telegram] Attempt ${attempt} failed:`, err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  return null;
}