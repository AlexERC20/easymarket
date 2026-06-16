function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseNumber(value, fallback, min = Number.NEGATIVE_INFINITY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, parsed);
}

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  allowDevAuth: process.env.NODE_ENV !== "production" || parseBoolean(process.env.ALLOW_DEV_AUTH, false),
  allowDevTools: parseBoolean(process.env.ALLOW_DEV_TOOLS, false),
  botBridgeSecret: process.env.BOT_BRIDGE_SECRET || "",
  telegramBotToken: (
    process.env.TELEGRAM_BOT_TOKEN
      || process.env.BOT_TOKEN
      || ""
  ).trim(),
  publicAvBotUrl: (
    process.env.PUBLIC_AV_BOT_URL
      || process.env.AV_BOT_URL
      || "https://t.me/voit_help_bot?start=buy_stars"
  ).trim(),
  publicMiniAppUrl: (
    process.env.PUBLIC_MINI_APP_URL
      || process.env.TELEGRAM_MINI_APP_URL
      || "https://t.me/voit_help_bot?startapp=easymarket"
  ).trim(),
  marketIntervalSeconds: parseNumber(process.env.MARKET_INTERVAL_SECONDS, 10, 1),
  marketDurationMinutes: parseNumber(process.env.MARKET_DURATION_MINUTES, 5, 1),
  marketLiquidity: parseNumber(process.env.MARKET_LIQUIDITY, 10_000, 100),
  marketFeeBps: parseNumber(process.env.MARKET_FEE_BPS, 200, 0),
  marketProfitFeeBps: parseNumber(process.env.MARKET_PROFIT_FEE_BPS, 500, 0),
  marketMakerSpreadBps: parseNumber(process.env.MARKET_MAKER_SPREAD_BPS, 300, 0),
  pricePollMs: parseNumber(process.env.PRICE_POLL_MS, 1_000, 250),
  referralBetBonusFire: parseNumber(process.env.REFERRAL_BET_BONUS_FIRE, 500, 0),
  taskShareFire: parseNumber(process.env.TASK_SHARE_FIRE, 100, 0),
  taskSubscribeFire: parseNumber(process.env.TASK_SUBSCRIBE_FIRE, 500, 0),
  taskPrivateChatFire: parseNumber(process.env.TASK_PRIVATE_CHAT_FIRE, 15_000, 0),
  taskDailyCapFire: parseNumber(process.env.TASK_DAILY_CAP_FIRE, 10_000, 0),
  publicAvChannelUrl: (
    process.env.PUBLIC_AV_CHANNEL_URL
      || "https://t.me/erc20coin"
  ).trim(),
  publicAvChatUrl: (
    process.env.PUBLIC_AV_CHAT_URL
      || "https://t.me/thedaomaker"
  ).trim(),
  publicPrivateChatUrl: (
    process.env.PUBLIC_PRIVATE_CHAT_URL
      || "https://t.me/tribute/app?startapp=stKL"
  ).trim(),
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
