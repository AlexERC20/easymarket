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
  publicWebUrl: (
    process.env.PUBLIC_WEB_URL
      || process.env.EASYMARKET_PUBLIC_URL
      || process.env.RENDER_EXTERNAL_URL
      || "https://easymarket-rcuj.onrender.com"
  ).trim().replace(/\/+$/, ""),
  telegramAdminUserIds: (
    process.env.EASYMARKET_ADMIN_TELEGRAM_IDS
      || process.env.TELEGRAM_ADMIN_USER_IDS
      || ""
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  marketIntervalSeconds: parseNumber(process.env.MARKET_INTERVAL_SECONDS, 2, 1),
  marketDurationMinutes: parseNumber(process.env.MARKET_DURATION_MINUTES, 5, 1),
  marketLiquidity: parseNumber(process.env.MARKET_LIQUIDITY, 10_000, 100),
  marketFeeBps: parseNumber(process.env.MARKET_FEE_BPS, 200, 0),
  marketProfitFeeBps: parseNumber(process.env.MARKET_PROFIT_FEE_BPS, 700, 0),
  marketMakerSpreadBps: parseNumber(process.env.MARKET_MAKER_SPREAD_BPS, 300, 0),
  pricePollMs: parseNumber(process.env.PRICE_POLL_MS, 1_000, 250),
  priceTicksEnabled: !parseBoolean(process.env.PRICE_TICKS_DISABLED, false),
  startupDatabaseRescueEnabled: parseBoolean(process.env.STARTUP_DATABASE_RESCUE_ENABLED, true),
  startupPriceTicksDropAboveMb: parseNumber(process.env.STARTUP_PRICE_TICKS_DROP_ABOVE_MB, 64, 0),
  databaseCleanupEnabled: parseBoolean(process.env.DATABASE_CLEANUP_ENABLED, true),
  databaseCleanupRunOnStart: parseBoolean(process.env.DATABASE_CLEANUP_RUN_ON_START, false),
  databaseCleanupIntervalMs: parseNumber(process.env.DATABASE_CLEANUP_INTERVAL_MS, 86_400_000, 60_000),
  databaseCleanupVacuum: parseBoolean(process.env.DATABASE_CLEANUP_VACUUM, false),
  databaseCleanupBatchSize: parseNumber(process.env.DATABASE_CLEANUP_BATCH_SIZE, 25_000, 100),
  databaseCleanupMaxBatches: parseNumber(process.env.DATABASE_CLEANUP_MAX_BATCHES, 80, 1),
  cleanupPriceTicksHours: parseNumber(process.env.CLEANUP_PRICE_TICKS_HOURS, 24, 1),
  cleanupBtcPriceTicksDays: parseNumber(process.env.CLEANUP_BTC_PRICE_TICKS_DAYS, 7, 1),
  cleanupOtherPriceTicksHours: parseNumber(process.env.CLEANUP_OTHER_PRICE_TICKS_HOURS, 24, 1),
  cleanupPriceTicksTruncateAboveMb: parseNumber(process.env.CLEANUP_PRICE_TICKS_TRUNCATE_ABOVE_MB, 250, 0),
  cleanupMarketCommentsDays: parseNumber(process.env.CLEANUP_MARKET_COMMENTS_DAYS, 3, 1),
  cleanupClosedMarketCommentsMinutes: parseNumber(process.env.CLEANUP_CLOSED_MARKET_COMMENTS_MINUTES, 15, 0),
  marketSellFreezeSeconds: parseNumber(process.env.MARKET_SELL_FREEZE_SECONDS, 7, 0),
  cleanupDepositEventsDays: parseNumber(process.env.CLEANUP_DEPOSIT_EVENTS_DAYS, 30, 1),
  cleanupExpiredDepositIntentsDays: parseNumber(process.env.CLEANUP_EXPIRED_DEPOSIT_INTENTS_DAYS, 30, 1),
  cleanupTaskClaimsDays: parseNumber(process.env.CLEANUP_TASK_CLAIMS_DAYS, 60, 1),
  cleanupEmptyMarketsDays: parseNumber(process.env.CLEANUP_EMPTY_MARKETS_DAYS, 14, 1),
  referralBetBonusFire: parseNumber(process.env.REFERRAL_BET_BONUS_FIRE, 500, 0),
  referralSignupBonusUsdt: parseNumber(process.env.REFERRAL_SIGNUP_BONUS_USDT, 5, 0),
  referralBetBonusUsdt: parseNumber(process.env.REFERRAL_BET_BONUS_USDT, 30, 0),
  taskShareFire: parseNumber(process.env.TASK_SHARE_FIRE, 100, 0),
  taskSubscribeFire: parseNumber(process.env.TASK_SUBSCRIBE_REWARD_FIRE, 300, 0),
  taskPrivateChatFire: parseNumber(process.env.TASK_PRIVATE_CHAT_FIRE, 15_000, 0),
  taskDailyPresenceFire: parseNumber(process.env.TASK_DAILY_PRESENCE_FIRE, 50, 0),
  taskDailyBetFire: parseNumber(process.env.TASK_DAILY_BET_FIRE, 50, 0),
  taskDailyCapFire: parseNumber(process.env.TASK_DAILY_CAP_FIRE, 10_000, 0),
  taskRewardScale: parseNumber(process.env.TASK_REWARD_SCALE, 0.5, 0),
  taskEasyRewardScale: parseNumber(process.env.TASK_EASY_REWARD_SCALE, 0.25, 0),
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
  usdtDepositScanEnabled: parseBoolean(process.env.USDT_DEPOSIT_SCAN_ENABLED, true),
  usdtDepositScanMs: parseNumber(process.env.USDT_DEPOSIT_SCAN_MS, 20_000, 5_000),
  usdtDepositIntentMinutes: parseNumber(process.env.USDT_DEPOSIT_INTENT_MINUTES, 60, 5),
  usdtDepositConfirmations: parseNumber(process.env.USDT_DEPOSIT_CONFIRMATIONS, 6, 1),
  usdtDepositMaxBlockRange: parseNumber(process.env.USDT_DEPOSIT_MAX_BLOCK_RANGE, 300, 10),
  usdtDepositInitialLookbackBlocks: parseNumber(process.env.USDT_DEPOSIT_INITIAL_LOOKBACK_BLOCKS, 2_400, 300),
  usdtDepositBackfillBlocks: parseNumber(process.env.USDT_DEPOSIT_BACKFILL_BLOCKS, 6_000, 300),
  usdtDepositBackfillMs: parseNumber(process.env.USDT_DEPOSIT_BACKFILL_MS, 300_000, 60_000),
  usdtDepositMatchGraceMinutes: parseNumber(process.env.USDT_DEPOSIT_MATCH_GRACE_MINUTES, 10, 0),
  evmScanApiUrl: (
    process.env.EVM_SCAN_API_URL
      || process.env.ETHERSCAN_API_URL
      || process.env.BSCSCAN_API_URL
      || "https://api.etherscan.io/v2/api"
  ).trim(),
  evmScanApiKey: (
    process.env.EVM_SCAN_API_KEY
      || process.env.ETHERSCAN_API_KEY
      || process.env.BSCSCAN_API_KEY
      || process.env.BSC_SCAN_API_KEY
      || ""
  ).trim(),
  evmScanPageSize: parseNumber(process.env.EVM_SCAN_PAGE_SIZE || process.env.BSCSCAN_PAGE_SIZE, 200, 1),
  usdtBscExplorerChainId: (
    process.env.USDT_BSC_EXPLORER_CHAIN_ID
      || process.env.BSCSCAN_CHAIN_ID
      || "56"
  ).trim(),
  usdtEthExplorerChainId: (
    process.env.USDT_ETH_EXPLORER_CHAIN_ID
      || process.env.ETHERSCAN_CHAIN_ID
      || "1"
  ).trim(),
  usdtBscRpcUrl: (
    process.env.USDT_BSC_RPC_URL
      || process.env.BSC_RPC_URL
      || "https://bsc.drpc.org"
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
