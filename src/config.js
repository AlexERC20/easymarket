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
  marketIntervalSeconds: parseNumber(process.env.MARKET_INTERVAL_SECONDS, 2, 1),
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
  taskDailyPresenceFire: parseNumber(process.env.TASK_DAILY_PRESENCE_FIRE, 50, 0),
  taskDailyBetFire: parseNumber(process.env.TASK_DAILY_BET_FIRE, 50, 0),
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
  publicUsdtEvmAddress: (
    process.env.PUBLIC_USDT_EVM_ADDRESS
      || "0x51592e92e48b94f3714c24c7597fb8a4ecfb36cd"
  ).trim(),
  publicUsdtTonAddress: (
    process.env.PUBLIC_USDT_TON_ADDRESS
      || "UQAFrUUrG0-cFLbZDkYA_RuGKSjuaULQPp7B7xxsmbzoaBdh"
  ).trim(),
  usdtDepositScanEnabled: parseBoolean(process.env.USDT_DEPOSIT_SCAN_ENABLED, true),
  usdtDepositScanMs: parseNumber(process.env.USDT_DEPOSIT_SCAN_MS, 20_000, 5_000),
  usdtDepositIntentMinutes: parseNumber(process.env.USDT_DEPOSIT_INTENT_MINUTES, 60, 5),
  usdtDepositConfirmations: parseNumber(process.env.USDT_DEPOSIT_CONFIRMATIONS, 6, 1),
  usdtBscRpcUrl: (
    process.env.USDT_BSC_RPC_URL
      || process.env.BSC_RPC_URL
      || "https://bsc-dataseed.binance.org"
  ).trim(),
  usdtBscTokenAddress: (
    process.env.USDT_BSC_TOKEN_ADDRESS
      || "0x55d398326f99059fF775485246999027B3197955"
  ).trim(),
  usdtBscDecimals: parseNumber(process.env.USDT_BSC_DECIMALS, 18, 0),
  usdtEthRpcUrl: (
    process.env.USDT_ETH_RPC_URL
      || process.env.ETH_RPC_URL
      || "https://ethereum.publicnode.com"
  ).trim(),
  usdtEthTokenAddress: (
    process.env.USDT_ETH_TOKEN_ADDRESS
      || "0xdAC17F958D2ee523a2206206994597C13D831ec7"
  ).trim(),
  usdtEthDecimals: parseNumber(process.env.USDT_ETH_DECIMALS, 6, 0),
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
