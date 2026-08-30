import express from "express";
import compression from "compression";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderStoryCardJpeg, formatStoryAmount } from "./services/shareCardService.js";

import { config } from "./config.js";
import { getPool, getSafeDatabaseErrorMessage, query, runMigrations } from "./db.js";
import {
  addFireToUser,
  addUsdtBonusToUser,
  addUsdtCashToUser,
  addMarketComment,
  buyOutcome,
  cancelLimitOrder,
  checkinStreak,
  claimDailyTask,
  claimDepositBonus,
  claimLossRefundWithStars,
  claimPromoCampaignReward,
  claimShakeFeedBonus,
  ingestShakeFeed,
  claimShareTask,
  auditSubscriptionTasks,
  checkTelegramSubscription,
  completeVerifiedTask,
  correctStarMarketSettlement,
  revokeSubscriptionTask,
  hasStartedTelegramBot,
  getEngagementState,
  expireInactiveBalances,
  ingestTaskEvent,
  createClan,
  createBtc5mMarket,
  createLimitOrder,
  deleteClan,
  distributeDueClanRewardFunds,
  getActiveMarket,
  getAppActivityStats,
  getBtcMarkets,
  getBridgeClans,
  getClans,
  getFireLedgerEvents,
  getLeaderboard,
  getKyivstonerMarket,
  getMarketActivity,
  getMarketComments,
  getMarketMakerAdminState,
  getMarketMakerEconomyAudit,
  getMarketOrderBook,
  getMarketChart,
  getProjectEconomySettings,
  getPromoCampaignStatus,
  getRecentActivity,
  getRecentMarketOutcomes,
  getRecentMarkets,
  getFireIncomeBreakdown,
  getLiveStats,
  listAllUsers,
  getUserRecentTrades,
  getSportsMarkets,
  clearTestStarStrike,
  getStarAbuseDiagnostics,
  getStarStrikePayments,
  getInactivityExpiryAudit,
  claimPendingInactivityNotice,
  issueTestInactivityNotice,
  listInactivityBurnEventsSince,
  applyInactivityRecovery,
  issueTestStarStrike,
  listActiveStarStrikes,
  payStarStrikeWithBalance,
  payStarStrikeWithStars,
  getTopMarkets,
  getUserMarketHistoryDetail,
  getUserSnapshot,
  getUsdtLedgerEvents,
  getWorldCupMarkets,
  finalizeWorldCupMarkets,
  joinClan,
  matchOpenClobLimitOrders,
  resetUserMarketStateByUsername,
  restartMarketMaker,
  applyMarketMakerCollateral,
  unwindMarket,
  purgeClanScoreForUsers,
  resolveExpiredMarkets,
  sellOutcome,
  syncTopMarkets,
  syncSportsMarkets,
  syncFireBalanceByUsername,
  syncFireBalance,
  updateProjectEconomySettings,
  updateMarketMakerBookSettings,
  updateMarketMakerSettings,
  updateLiveBtcPrice,
  upsertPromoCampaign,
  upsertUser,
} from "./services/marketService.js";
import {
  creditTelegramStarsPromoPointPurchase,
  resetTelegramPromoPointPurchaseDay,
} from "./services/promoContestService.js";
import {
  getBonusEconomyAudit,
  getDepositorAudit,
  getEconomyIntegrityAudit,
  getStarConversionReminderTargets,
  markStarConversionRemindersSent,
} from "./services/bonusEconomyService.js";
import { getTreasurySnapshot } from "./services/treasuryService.js";
import { ensureRouletteSchema, getRouletteState, placeRouletteBet, rouletteTick } from "./services/rouletteService.js";
import {
  COMEBACK_WHEEL_SPIN_STARS,
  getComebackWheelStatus,
  resetComebackWheelFreeSpin,
  spinComebackWheelFree,
  spinComebackWheelPaid,
  claimLatestComebackWheelSpin,
  getComebackWheelReminderTargets,
  markComebackWheelRemindersSent,
  getComebackWheelPromoImage,
} from "./services/comebackWheelService.js";
import { PriceUnavailableError, startBtcPriceStream } from "./services/priceService.js";
import { runDatabaseCleanup, runStartupDatabaseRescue } from "./services/databaseCleanupService.js";
import {
  cancelUserDepositIntent,
  checkUserDepositIntent,
  createUsdtDepositIntent,
  creditDepositEventToIntent,
  creditPendingDepositIntentManually,
  dismissDepositEvent,
  auditUserDeposits,
  expirePendingDepositIntents,
  listPendingDepositIntents,
  getDepositReviewQueue,
  getPublicUsdtDepositNetworks,
  getUserDepositIntent,
  getUserDepositIntents,
  revertManualDepositCredit,
  scanUsdtDeposits,
} from "./services/usdtDepositService.js";
import {
  cancelUsdtWithdrawalRequestByBridge,
  confirmUsdtWithdrawalRequest,
  confirmUsdtWithdrawalRequestByBridge,
  createUsdtWithdrawalRequest,
  getPendingUsdtWithdrawals,
  getUserWithdrawals,
  getWalletHistory,
} from "./services/usdtWithdrawalService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

const app = express();

app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "128kb" }));
app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    // Telegram WebView can retain an immutable asset even after its query
    // version changes. Revalidate code and styles on each app open; ETags keep
    // unchanged responses cheap while a deploy becomes visible immediately.
    if (/\.html$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-store, max-age=0");
    } else if (/\.(js|css)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache, max-age=0, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  },
}));

// Verifies a Telegram Mini App initData string per Telegram's documented
// algorithm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// secret_key = HMAC_SHA256(key="WebAppData", data=bot_token); the data-check
// string (every field except hash, sorted, joined with \n) is then HMACed
// with that secret_key and compared to the hash field.
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;
function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) {
    return null;
  }
  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get("hash");
  if (!hash) {
    return null;
  }
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const hashBuf = Buffer.from(hash, "hex");
  const computedBuf = Buffer.from(computedHash, "hex");
  if (hashBuf.length !== computedBuf.length || !timingSafeEqual(hashBuf, computedBuf)) {
    return null;
  }
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SECONDS) {
    return null;
  }
  let user = null;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    user = null;
  }
  const telegramId = String(user?.id ?? "").trim();
  if (!telegramId) {
    return null;
  }
  return {
    telegramId,
    username: user?.username ?? null,
    firstName: user?.first_name ?? null,
  };
}

// Every route so far trusted a bare telegram_id from the request body/query
// with no proof it actually came from that Telegram user - anyone who knew
// (or guessed) a real telegram_id could act as them, including withdrawals.
// This middleware is the single choke point that closes that: a valid,
// freshly-signed X-Telegram-Init-Data header overwrites whatever telegram_id
// the client claimed with the verified one, so every existing route handler
// (which reads req.body.telegram_id / req.query.telegram_id / getTelegramId)
// gets the trustworthy value with no per-route changes. Bridge routes
// (server-to-server, gated by requireBridgeSecret below) and requests
// carrying no identity claim at all (genuinely public routes) pass through
// untouched.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/bridge/")) {
    return next();
  }
  const claimedTelegramId = String(req.body?.telegram_id || req.query?.telegram_id || "").trim();
  const initData = req.get("X-Telegram-Init-Data");
  if (!claimedTelegramId && !initData) {
    return next();
  }
  const verified = verifyTelegramInitData(initData, config.telegramBotToken);
  if (verified) {
    if (req.body && typeof req.body === "object") {
      req.body.telegram_id = verified.telegramId;
      if (verified.username) req.body.username = verified.username;
      if (verified.firstName) req.body.first_name = verified.firstName;
    }
    req.query.telegram_id = verified.telegramId;
    return next();
  }
  if (config.allowDevAuth) {
    // Local/dev only: no real Telegram client to sign initData with.
    return next();
  }
  res.status(401).json({ ok: false, message: "invalid_telegram_auth" });
});

let marketEngineStarted = false;
let marketEngineBusy = false;
let priceEngineBusy = false;
let usdtDepositScannerBusy = false;
let usdtDepositScannerStartedAt = 0;
let usdtDepositExpiryBusy = false;
let databaseCleanupBusy = false;
let clanRewardDistributionBusy = false;
let inactivityExpiryBusy = false;

function sendApiError(res, error, fallbackStatus = 500) {
  const message = error instanceof Error ? error.message : String(error);
  const publicErrors = new Set([
    "telegram_id_required",
    "telegram_id_missing",
    "telegram_id_or_username_required",
    "username_required",
    "amount_must_be_positive",
    "amount_must_be_non_negative",
    "invalid_market_id",
    "invalid_side",
    "amount_below_minimum",
    "invalid_limit_price",
    "invalid_limit_order",
    "invalid_limit_order_id",
    "invalid_limit_order_side",
    "user_not_found",
    "free_spin_already_used",
    "market_not_found",
    "market_not_open",
    "market_closed",
    "market_buy_frozen",
    "market_trading_paused",
    "star_buy_cooldown",
    "star_trading_banned",
    "tasks_blocked_star_strike",
    "withdrawal_blocked_star_strike",
    "star_strike_not_active",
    "star_strike_balance_already_paid",
    "star_strike_stars_not_required",
    "star_strike_stars_already_paid",
    "star_strike_stars_topup_required",
    "price_unavailable",
    "insufficient_market_liquidity",
    "market_maker_unavailable",
    "market_maker_disabled",
    "limit_order_reserve_exhausted",
    "legacy_position_settlement_only",
    "insufficient_fire",
    "invalid_promo_point_package",
    "invalid_telegram_payment",
    "promo_points_telegram_payment_required",
    "promo_point_purchase_conflict",
    "insufficient_usdt",
    "invalid_deposit_amount",
    "invalid_deposit_network",
    "deposit_amount_collision",
    "deposit_intent_not_found",
    "deposit_intent_not_pending",
    "deposit_event_not_found",
    "invalid_withdrawal_amount",
    "withdrawal_amount_below_fee",
    "withdrawal_amount_below_minimum",
    "withdrawal_deposit_required",
    "invalid_withdrawal_network",
    "invalid_withdrawal_address",
    "withdrawal_not_found",
    "withdrawal_not_pending",
    "position_not_open",
    "invalid_position_id",
    "invalid_sell_shares",
    "invalid_task",
    "task_not_ready",
    "task_not_in_rotation",
    "invalid_task_event",
    "share_message_unavailable",
    "invalid_share_url",
    "comment_required",
    "insufficient_shares",
    "invalid_market_price",
    "invoice_failed",
    "invoice_not_configured",
    "sell_failed",
    "sell_frozen",
    "limit_order_not_found",
    "limit_order_not_open",
    "clan_not_found",
    "clan_name_required",
    "invalid_clan_channel",
    "clan_exists",
    "clan_default_locked",
    "invalid_economy_settings",
    "invalid_amm_collateral_usdt",
    "invalid_amm_collateral_bonus",
    "invalid_amm_collateral_star",
    "invalid_amm_spread",
    "invalid_amm_trade_fee",
    "invalid_amm_drawdown",
    "invalid_amm_rapid_loss",
    "invalid_amm_minimum_capital",
    "invalid_amm_quote_levels",
    "invalid_amm_risk_thresholds",
    "invalid_promo_campaign_code",
    "invalid_promo_campaign_start",
    "invalid_promo_campaign_end",
    "invalid_promo_campaign_window",
    "promo_campaign_reward_too_large",
  ]);

  if (message === "DATABASE_URL is not configured.") {
    res.status(500).json({
      ok: false,
      database: "error",
      message,
    });
    return;
  }

  if (error instanceof PriceUnavailableError) {
    res.status(503).json({
      ok: false,
      status: "price_unavailable",
      message: "BTC price is unavailable.",
    });
    return;
  }

  const isKnown = publicErrors.has(message);
  if (!isKnown) {
    // This is the catch-all for ~100 route handlers, several of them
    // money-moving (withdrawals, deposit credits, star-strike payments)
    // with no try/catch of their own further up the stack - an unexpected
    // exception here was the only place it could ever surface, and it
    // wasn't being logged anywhere before this.
    console.error("[api] unhandled error:", error instanceof Error ? error.stack || error.message : error);
  }
  res.status(isKnown ? 400 : fallbackStatus).json({
    ok: false,
    message: isKnown ? message : "Request failed.",
  });
}

// Кэш для GET-эндпоинтов, у которых ответ одинаков для всех пользователей
// (глобальные списки маркетов). Клиенты опрашивают их независимо друг от
// друга каждые 1.5-10с, и при N одновременных пользователей это N одинаковых
// запросов в БД в один и тот же момент. TTL держим короче или вровень с
// кадансом обновления цены на сервере (pricePollMs), поэтому свежесть данных
// не страдает — они и так не могут обновиться быстрее. Плюс single-flight:
// пока идёт загрузка на "промах", параллельные запросы ждут тот же промис,
// а не плодят повторные запросы к БД.
const readThroughCache = new Map();
function cachedJsonRoute(cacheKey, ttlMs, loader) {
  return async (req, res) => {
    try {
      const now = Date.now();
      const resolvedCacheKey = typeof cacheKey === "function" ? cacheKey(req) : cacheKey;
      const entry = readThroughCache.get(resolvedCacheKey);
      if (entry && entry.expiresAt > now) {
        res.status(200).json(entry.payload);
        return;
      }
      if (entry && entry.pending) {
        res.status(200).json(await entry.pending);
        return;
      }
      const pending = loader(req);
      readThroughCache.set(resolvedCacheKey, { expiresAt: entry?.expiresAt ?? 0, payload: entry?.payload, pending });
      const payload = await pending;
      readThroughCache.set(resolvedCacheKey, { expiresAt: Date.now() + ttlMs, payload, pending: null });
      res.status(200).json(payload);
    } catch (error) {
      const resolvedCacheKey = typeof cacheKey === "function" ? cacheKey(req) : cacheKey;
      const entry = readThroughCache.get(resolvedCacheKey);
      if (entry) entry.pending = null;
      sendApiError(res, error);
    }
  };
}

function getSafePublicErrorDetail(message) {
  return String(message || "unknown")
    .replace(process.env.DATABASE_URL || "", "[redacted]")
    .replace(/postgres:\/\/[^\s]+/gi, "[redacted]")
    .slice(0, 180);
}

function requireDevTools(req, res, next) {
  if (!config.allowDevTools) {
    res.status(403).json({
      ok: false,
      message: "Dev tools are disabled.",
    });
    return;
  }

  next();
}

function requireBridgeSecret(req, res, next) {
  if (!config.botBridgeSecret) {
    res.status(403).json({
      ok: false,
      message: "Bridge API is not configured.",
    });
    return;
  }

  const provided = req.header("x-bridge-secret") || "";
  if (provided !== config.botBridgeSecret) {
    res.status(403).json({
      ok: false,
      message: "Bridge access denied.",
    });
    return;
  }

  next();
}

function getTelegramId(req) {
  return String(req.query.telegram_id || req.body?.telegram_id || "").trim();
}

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "easymarket",
  });
});

app.get("/api/status", async (_req, res) => {
  const pool = getPool();
  if (!pool) {
    res.status(500).json({
      ok: false,
      database: "error",
      message: "DATABASE_URL is not configured.",
    });
    return;
  }

  try {
    await query("SELECT 1");
    res.status(200).json({
      ok: true,
      database: "connected",
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      database: "error",
      message: getSafeDatabaseErrorMessage(error),
    });
  }
});

app.get("/api/public/config", async (_req, res) => {
  const scaleTaskReward = (amount, easy = false) => Math.max(
    0,
    Math.round(Number(amount || 0) * Number(easy ? config.taskEasyRewardScale : config.taskRewardScale)),
  );
  let economySettings = {
    profit_fee_bps: config.marketProfitFeeBps,
    star_profit_fee_bps: config.marketStarProfitFeeBps,
  };
  let ammTradeFeeBps = 100;
  try {
    economySettings = await getProjectEconomySettings();
    const ammSettingsResult = await query(
      "SELECT user_trade_fee_bps FROM market_maker_settings WHERE id = 1",
    );
    ammTradeFeeBps = Number(ammSettingsResult.rows[0]?.user_trade_fee_bps || 100);
  } catch {
    // Keep the public config available during a transient database outage.
  }
  res.status(200).json({
    ok: true,
    av_bot_url: config.publicAvBotUrl,
    mini_app_url: config.publicMiniAppUrl,
    referral_bonus_fire: config.referralBetBonusFire,
    task_share_fire: scaleTaskReward(config.taskShareFire),
    task_subscribe_fire: Math.max(0, Math.round(Number(config.taskSubscribeFire || 0))),
    task_private_chat_fire: scaleTaskReward(config.taskPrivateChatFire),
    task_daily_presence_fire: scaleTaskReward(config.taskDailyPresenceFire, true),
    task_daily_bet_fire: scaleTaskReward(config.taskDailyBetFire),
    task_daily_cap_fire: scaleTaskReward(config.taskDailyCapFire),
    market_profit_fee_bps: Number(economySettings.profit_fee_bps || config.marketProfitFeeBps),
    market_star_profit_fee_bps: Number(
      economySettings.star_profit_fee_bps || config.marketStarProfitFeeBps,
    ),
    market_trade_fee_bps: ammTradeFeeBps,
    market_star_max_payout_multiplier: config.marketStarMaxPayoutMultiplier,
    market_usdt_max_payout_multiplier: config.marketUsdtMaxPayoutMultiplier,
    market_usdt_risk_budget: config.marketUsdtRiskBudget,
    market_star_risk_budget: config.marketStarRiskBudget,
    market_buy_freeze_seconds: config.marketBuyFreezeSeconds,
    market_tail_protection_seconds: config.marketTailProtectionSeconds,
    star_usdt_conversion_stars_per_usdt: config.starUsdtConversionStarsPerUsdt,
    star_market_pricing_stars_per_usdt: config.starMarketPricingStarsPerUsdt,
    star_usdt_conversion_rate_bps: config.starUsdtConversionRateBps,
    star_usdt_conversion_lifetime_cap_bps: config.starUsdtConversionLifetimeCapBps,
    usdt_deposit_minimum: config.usdtDepositMinimum,
    usdt_withdrawal_fee: config.usdtWithdrawalFee,
    usdt_withdrawal_minimum: config.usdtWithdrawalMinimum,
    referral_signup_bonus_usdt: config.referralSignupBonusUsdt,
    av_channel_url: config.publicAvChannelUrl,
    av_chat_url: config.publicAvChatUrl,
    private_chat_url: config.publicPrivateChatUrl,
    usdt_deposit_scan_enabled: config.usdtDepositScanEnabled,
    usdt_deposit_networks: getPublicUsdtDepositNetworks(),
    stars_invoice_enabled: Boolean(config.telegramBotToken),
  });
});

function buildStarsTopupPayload(input) {
  const nonce = randomBytes(4).toString("hex");
  return ["fire_topup", input.telegramId, input.amount, input.amount, nonce].join(":");
}

function buildComebackWheelSpinPayload(input) {
  const nonce = randomBytes(4).toString("hex");
  return ["comeback_wheel_spin", input.telegramId, input.amount, input.wheelType, nonce].join(":");
}

app.post("/api/stars/invoice", async (req, res) => {
  try {
    if (!config.telegramBotToken) {
      throw new Error("invoice_not_configured");
    }

    const telegramId = String(req.body?.telegram_id || "").trim();
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }

    // The comeback-wheel spin price is fixed server-side - never trust a
    // client-supplied amount for something that pays out a random prize.
    const isComebackWheel = req.body?.purpose === "comeback_wheel";
    const wheelType = req.body?.wheel_type === "usd" ? "usd" : "star";
    const amount = isComebackWheel
      ? COMEBACK_WHEEL_SPIN_STARS
      : Math.round(Number(req.body?.amount || 0));
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000) {
      throw new Error("amount_must_be_positive");
    }

    const payload = isComebackWheel
      ? buildComebackWheelSpinPayload({ telegramId, amount, wheelType })
      : buildStarsTopupPayload({ telegramId, amount });
    const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/createInvoiceLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: isComebackWheel ? "Крутить колесо" : `${amount.toLocaleString("ru-RU")} звезд`,
        description: isComebackWheel
          ? `Ещё одна прокрутка колеса удачи за ${amount.toLocaleString("ru-RU")} Telegram Stars`
          : `Пополнение баланса EasyMarket: ${amount.toLocaleString("ru-RU")}⭐`,
        payload,
        provider_token: "",
        currency: "XTR",
        prices: [
          {
            label: isComebackWheel ? "Прокрутка колеса" : `${amount.toLocaleString("ru-RU")}⭐`,
            amount,
          },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok || !data.result) {
      throw new Error("invoice_failed");
    }

    res.status(200).json({
      ok: true,
      invoice_url: data.result,
      amount,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/usdt/deposits/intents", async (req, res) => {
  try {
    const result = await createUsdtDepositIntent({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      amount: req.body?.amount,
      network: req.body?.network,
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/usdt/deposits/intents", async (req, res) => {
  try {
    const telegramId = getTelegramId(req);
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }
    const intents = await getUserDepositIntents(telegramId, req.query.limit);
    res.status(200).json({
      ok: true,
      intents,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/usdt/deposits/intents/:intentId", async (req, res) => {
  try {
    const telegramId = getTelegramId(req);
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }
    const intent = await getUserDepositIntent({
      intentId: req.params.intentId,
      telegram_id: telegramId,
    });
    if (!intent) {
      res.status(404).json({
        ok: false,
        message: "deposit_intent_not_found",
      });
      return;
    }
    res.status(200).json({
      ok: true,
      intent,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/usdt/deposits/intents/:intentId/cancel", async (req, res) => {
  try {
    const telegramId = getTelegramId(req);
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }
    const intent = await cancelUserDepositIntent({
      intentId: req.params.intentId,
      telegram_id: telegramId,
    });
    if (!intent) {
      res.status(404).json({
        ok: false,
        message: "deposit_intent_not_found",
      });
      return;
    }
    res.status(200).json({
      ok: true,
      intent,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/usdt/deposits/intents/:intentId/check", async (req, res) => {
  try {
    const telegramId = getTelegramId(req);
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }
    const result = await checkUserDepositIntent({
      intentId: req.params.intentId,
      telegram_id: telegramId,
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/usdt/withdrawals", async (req, res) => {
  try {
    const result = await createUsdtWithdrawalRequest({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      amount: req.body?.amount,
      network: req.body?.network,
      to_address: req.body?.to_address ?? req.body?.toAddress,
    });
    res.status(200).json({
      ok: true,
      request: result.request,
      usdt_cash_balance: result.cash_balance,
      usdt_bonus_balance: result.bonus_balance,
      usdt_balance: result.balance,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/usdt/withdrawals", async (req, res) => {
  try {
    const telegramId = getTelegramId(req);
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }
    const requests = await getUserWithdrawals(telegramId, req.query.limit);
    res.status(200).json({
      ok: true,
      requests,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/wallet/history", async (req, res) => {
  try {
    const telegramId = getTelegramId(req);
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }
    const history = await getWalletHistory(telegramId, req.query.limit);
    res.status(200).json({
      ok: true,
      history,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/admin/withdrawals/:requestId/confirm", async (req, res) => {
  try {
    const request = await confirmUsdtWithdrawalRequest({
      requestId: req.params.requestId,
      token: req.query.token,
    });
    res.type("html").send(`<!doctype html>
      <html lang="ru">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>EasyMarket withdrawal</title>
          <style>
            body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #080d16; color: #f3f6fb; font-family: Inter, system-ui, sans-serif; }
            main { width: min(420px, calc(100% - 32px)); border: 1px solid rgba(255,255,255,.1); border-radius: 18px; background: #111823; padding: 22px; box-shadow: 0 24px 70px rgba(0,0,0,.5); }
            h1 { margin: 0 0 8px; font-size: 22px; }
            p { margin: 8px 0; color: #9aa5b8; line-height: 1.45; }
            strong { color: #19c37d; }
          </style>
        </head>
        <body>
          <main>
            <h1>Вывод подтвержден</h1>
            <p>Заявка #${request.id} отмечена как выполненная.</p>
            <p><strong>${request.amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} USDT</strong> · ${request.network_label}</p>
          </main>
        </body>
      </html>`);
  } catch (error) {
    res.status(400).type("html").send(`<!doctype html>
      <html lang="ru">
        <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
        <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#080d16;color:#f3f6fb;font-family:system-ui,sans-serif;">
          <main style="width:min(420px,calc(100% - 32px));border:1px solid rgba(255,255,255,.1);border-radius:18px;background:#111823;padding:22px;">
            <h1 style="margin:0 0 8px;font-size:22px;">Не получилось подтвердить</h1>
            <p style="margin:0;color:#9aa5b8;">Заявка не найдена или ссылка уже недействительна.</p>
          </main>
        </body>
      </html>`);
  }
});

app.post("/api/me/upsert", async (req, res) => {
  try {
    const authSource = String(req.body?.auth_source || "telegram");
    if (authSource === "dev" && !config.allowDevAuth) {
      res.status(403).json({
        ok: false,
        message: "Dev auth is disabled.",
      });
      return;
    }

    const user = await upsertUser({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      referred_by_telegram_id: req.body?.referred_by_telegram_id,
    });
    const campaignCode = String(req.body?.campaign_code || "").trim();
    const promoReward = campaignCode
      ? await claimPromoCampaignReward({
        user_id: user.id,
        campaign_code: campaignCode,
      })
      : null;
    const snapshot = await getUserSnapshot(user.telegram_id);
    res.status(200).json({
      ok: true,
      ...snapshot,
      promo_reward: promoReward,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/me", async (req, res) => {
  try {
    const telegramId = getTelegramId(req);
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }

    const snapshot = await getUserSnapshot(telegramId);
    if (!snapshot) {
      res.status(404).json({
        ok: false,
        message: "user_not_found",
      });
      return;
    }

    const pendingInactivityNotice = await claimPendingInactivityNotice(telegramId);

    res.status(200).json({
      ok: true,
      ...snapshot,
      pending_inactivity_notice: pendingInactivityNotice,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

// Public/unauthenticated on purpose - Telegram's own servers fetch this URL
// directly when rendering sendPhoto, they don't carry a user's initData.
app.get("/api/wheel/comeback/promo-image.jpg", async (req, res) => {
  try {
    const jpeg = await getComebackWheelPromoImage(req.query?.wheel_type);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.status(200).end(jpeg);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/wheel/comeback/status", async (req, res) => {
  try {
    const telegramId = getTelegramId(req);
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }
    const status = await getComebackWheelStatus(telegramId, req.query?.wheel_type);
    res.status(200).json({ ok: true, ...status });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/wheel/comeback/spin-free", async (req, res) => {
  try {
    const telegramId = getTelegramId(req);
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }
    const result = await spinComebackWheelFree(telegramId, req.body?.wheel_type);
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/wheel/comeback/latest-spin", async (req, res) => {
  try {
    const telegramId = getTelegramId(req);
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }
    const spin = await claimLatestComebackWheelSpin(telegramId, req.query?.wheel_type);
    res.status(200).json({ ok: true, spin });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/me/markets/:marketId/history-detail", async (req, res) => {
  try {
    const telegramId = getTelegramId(req);
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }
    const detail = await getUserMarketHistoryDetail(
      telegramId,
      req.params.marketId,
      req.query.currency,
    );
    if (!detail) {
      res.status(404).json({ ok: false, message: "user_not_found" });
      return;
    }
    res.status(200).json({ ok: true, detail });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/market/active", cachedJsonRoute("market/active", config.pricePollMs, async () => {
  const market = await getActiveMarket();
  let activity = [];
  let chart = [];
  let recentOutcomes = [];
  if (market) {
    try {
      [activity, chart, recentOutcomes] = await Promise.all([
        getMarketActivity(market.id, 24),
        getMarketChart(market, 260),
        getRecentMarketOutcomes(market.symbol, 12),
      ]);
    } catch (error) {
      console.warn("[easymarket] active market extras failed:", error instanceof Error ? error.message : "unknown error");
    }
  }
  return { ok: true, market, activity, chart, recentOutcomes };
}));

app.get("/api/market/:marketId/activity", async (req, res) => {
  try {
    const activity = await getMarketActivity(req.params.marketId, req.query.limit);
    res.status(200).json({
      ok: true,
      activity,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/activity/recent", cachedJsonRoute(
  (req) => `activity/recent:${Math.max(1, Math.min(80, Number(req.query.limit) || 30))}`,
  3_000,
  async (req) => ({
    ok: true,
    activity: await getRecentActivity(req.query.limit),
  }),
));

app.get("/api/world-cup/markets", cachedJsonRoute("world-cup/markets", 3_000, async () => {
  const result = await getWorldCupMarkets();
  return { ok: true, ...result };
}));

app.get("/api/top/markets", cachedJsonRoute("top/markets", 3_000, async () => {
  const result = await getTopMarkets();
  return { ok: true, ...result };
}));

app.get("/api/sports/markets", cachedJsonRoute("sports/markets", 3_000, async () => {
  const result = await getSportsMarkets();
  return { ok: true, ...result };
}));

app.get("/api/special/kyivstoner", cachedJsonRoute("special/kyivstoner", 2_000, async () => {
  const result = await getKyivstonerMarket();
  return { ok: true, ...result };
}));

// Состояние круга меняется каждую секунду и зависит от зрителя, поэтому общий
// кеш ответов здесь не годится.
app.get("/api/roulette/state", async (req, res) => {
  try {
    const result = await getRouletteState({
      currency: req.query?.currency,
      telegram_id: req.query?.telegram_id,
    });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/roulette/bet", async (req, res) => {
  try {
    const result = await placeRouletteBet({
      currency: req.body?.currency,
      telegram_id: req.body?.telegram_id,
      amount: req.body?.amount,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/btc/markets", cachedJsonRoute("btc/markets", 2_000, async () => {
  const markets = await getBtcMarkets();
  return { ok: true, markets };
}));

app.get("/api/clans", async (req, res) => {
  try {
    const result = await getClans({
      telegram_id: req.query.telegram_id,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

// Dynamic Story share image with the player's profit baked in, for shareToStory.
// Prefer clean numeric value+currency (URL-safe); the label is built here.
app.get("/api/share/story", async (req, res) => {
  try {
    const label = formatStoryAmount(req.query.value, req.query.currency)
      || String(req.query.amount || "");
    // theme/t — только латинский слаг и цифра, свободный текст не принимаем.
    const language = String(req.query.lang || "").toLowerCase() === "en" ? "en" : "ru";
    const jpeg = await renderStoryCardJpeg(label, req.query.theme, req.query.t, language);
    res.setHeader("Content-Type", "image/jpeg");
    // Картинка детерминирована суммой в query — можно кэшировать надолго.
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.status(200).end(jpeg);
  } catch (error) {
    // Fall back to the static branded card so shareToStory still gets valid media.
    res.sendFile(path.join(publicDir, "share", "story-win.png"), (sendError) => {
      if (sendError && !res.headersSent) {
        sendApiError(res, error);
      }
    });
  }
});

// Шэр карточки в чат настоящим сообщением с картинкой: готовим инлайн-photo
// через Bot API, клиент затем открывает пикер чатов и отправляет её.
app.post("/api/share/prepare-message", async (req, res) => {
  try {
    if (!config.telegramBotToken) {
      throw new Error("share_message_unavailable");
    }
    const telegramId = String(req.body?.telegram_id ?? "").trim();
    if (!/^\d{4,20}$/.test(telegramId)) {
      throw new Error("telegram_id_required");
    }
    const value = Number(req.body?.value);
    const currency = String(req.body?.currency ?? "USDT").toUpperCase() === "STAR" ? "STAR" : "USDT";
    const theme = /^[a-z_]{1,24}$/.test(String(req.body?.theme ?? "")) ? String(req.body.theme) : "btc";
    const taglineIndex = Number(req.body?.tagline_index ?? req.body?.taglineIndex);
    const language = String(req.body?.language || "").toLowerCase() === "en" ? "en" : "ru";
    const caption = String(req.body?.text ?? "").slice(0, 900);
    const linkUrl = String(req.body?.url ?? config.publicMiniAppUrl).slice(0, 400);
    if (!/^https:\/\/t\.me\//.test(linkUrl)) {
      throw new Error("invalid_share_url");
    }

    const params = new URLSearchParams({ currency, theme, lang: language, v: "4" });
    if (Number.isFinite(value) && value > 0) {
      params.set("value", String(value));
    }
    if (Number.isInteger(taglineIndex)) {
      params.set("t", String(taglineIndex));
    }
    const photoUrl = `${config.publicWebUrl}/api/share/story?${params.toString()}`;

    const response = await fetch(
      `https://api.telegram.org/bot${config.telegramBotToken}/savePreparedInlineMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: Number(telegramId),
          allow_user_chats: true,
          allow_group_chats: true,
          allow_channel_chats: true,
          result: {
            type: "photo",
            id: `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            photo_url: photoUrl,
            thumbnail_url: photoUrl,
            photo_width: 1080,
            photo_height: 1920,
            caption,
            reply_markup: {
              inline_keyboard: [[{ text: "🚀 Играть в EasyMarket", url: linkUrl }]],
            },
          },
        }),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true || !body?.result?.id) {
      console.warn("[EasyMarket] savePreparedInlineMessage failed", {
        status: response.status,
        description: body?.description,
      });
      throw new Error("share_message_unavailable");
    }

    res.status(200).json({
      ok: true,
      prepared_message_id: body.result.id,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/clans/join", async (req, res) => {
  try {
    const result = await joinClan({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      clan_id: req.body?.clan_id,
      clan_slug: req.body?.clan_slug,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/clans/create", async (req, res) => {
  try {
    const result = await createClan({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      name: req.body?.name,
      channel_url: req.body?.channel_url,
      icon_key: req.body?.icon_key,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/market/:marketId/comments", async (req, res) => {
  try {
    const [comments, appStats] = await Promise.all([
      getMarketComments(req.params.marketId, req.query.limit),
      getAppActivityStats(),
    ]);
    res.status(200).json({
      ok: true,
      comments,
      online_count: appStats.online_count,
      total_bets: appStats.total_bets,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/market/:marketId/comments", async (req, res) => {
  try {
    const comment = await addMarketComment({
      marketId: req.params.marketId,
      telegram_id: req.body?.telegram_id,
      message: req.body?.message,
    });
    res.status(200).json({
      ok: true,
      comment,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/market/:marketId/buy", async (req, res) => {
  try {
    const result = await buyOutcome({
      marketId: req.params.marketId,
      telegram_id: req.body?.telegram_id,
      side: req.body?.side,
      amount: req.body?.amount,
      currency: req.body?.currency,
      book_type: req.body?.book_type ?? req.body?.bookType,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/market/:marketId/orderbook", async (req, res) => {
  try {
    const result = await getMarketOrderBook({
      marketId: req.params.marketId,
      telegram_id: req.query?.telegram_id,
      currency: req.query?.currency,
      book_type: req.query?.book_type ?? req.query?.bookType,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/market/:marketId/limit-orders", async (req, res) => {
  try {
    const result = await createLimitOrder({
      marketId: req.params.marketId,
      telegram_id: req.body?.telegram_id,
      side: req.body?.side,
      order_side: req.body?.order_side ?? req.body?.orderSide,
      amount: req.body?.amount,
      limit_price: req.body?.limit_price ?? req.body?.price,
      currency: req.body?.currency,
      book_type: req.body?.book_type ?? req.body?.bookType,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/limit-orders/:orderId/cancel", async (req, res) => {
  try {
    const result = await cancelLimitOrder({
      orderId: req.params.orderId,
      telegram_id: req.body?.telegram_id,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/market/:marketId/sell", async (req, res) => {
  try {
    const result = await sellOutcome({
      marketId: req.params.marketId,
      telegram_id: req.body?.telegram_id,
      positionId: req.body?.position_id,
      side: req.body?.side,
      shares: req.body?.shares,
      currency: req.body?.currency,
    });
    console.log("[EasyMarket] sell ok", {
      telegram_id: req.body?.telegram_id,
      market_id: req.params.marketId,
      position_id: req.body?.position_id || result.position?.id,
      side: result.sale?.side,
      proceeds: result.sale?.proceeds,
    });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[EasyMarket] sell failed", {
      telegram_id: req.body?.telegram_id,
      market_id: req.params.marketId,
      position_id: req.body?.position_id,
      side: req.body?.side,
      message,
    });
    const sellPublicErrors = new Set([
      "invalid_market_id",
      "invalid_side",
      "user_not_found",
      "market_not_open",
      "market_closed",
      "position_not_open",
      "invalid_position_id",
      "invalid_sell_shares",
      "insufficient_shares",
      "invalid_market_price",
      "sell_failed",
      "sell_frozen",
    ]);
    if (!(error instanceof PriceUnavailableError) && message !== "DATABASE_URL is not configured." && !sellPublicErrors.has(message)) {
      res.status(500).json({
        ok: false,
        message: "sell_failed",
        detail: getSafePublicErrorDetail(message),
      });
      return;
    }
    sendApiError(res, error);
  }
});

app.get("/api/bridge/star-conversion/reminder-targets", requireBridgeSecret, async (req, res) => {
  try {
    const targets = await getStarConversionReminderTargets({
      limit: req.query.limit,
      minStars: req.query.min_stars,
    });
    res.status(200).json({
      ok: true,
      targets,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/star-conversion/reminders/mark", requireBridgeSecret, async (req, res) => {
  try {
    const result = await markStarConversionRemindersSent(
      Array.isArray(req.body?.telegram_ids) ? req.body.telegram_ids : [],
    );
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/comeback-wheel/reminder-targets", requireBridgeSecret, async (req, res) => {
  try {
    const targets = await getComebackWheelReminderTargets({ limit: req.query.limit });
    res.status(200).json({ ok: true, targets });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/comeback-wheel/reminders/mark", requireBridgeSecret, async (req, res) => {
  try {
    const result = await markComebackWheelRemindersSent(
      Array.isArray(req.body?.telegram_ids) ? req.body.telegram_ids : [],
    );
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/wheel/comeback/spin-paid", requireBridgeSecret, async (req, res) => {
  try {
    const result = await spinComebackWheelPaid({
      telegram_id: req.body?.telegram_id,
      stars_amount: req.body?.stars_amount,
      telegram_payment_charge_id: req.body?.telegram_payment_charge_id,
      wheel_type: req.body?.wheel_type,
    });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/withdrawals/pending", requireBridgeSecret, async (req, res) => {
  try {
    const requests = await getPendingUsdtWithdrawals(req.query.limit);
    res.status(200).json({
      ok: true,
      requests,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/withdrawals/:requestId/confirm", requireBridgeSecret, async (req, res) => {
  try {
    const token = String(req.body?.token ?? "").trim();
    const request = token
      ? await confirmUsdtWithdrawalRequest({
        requestId: req.params.requestId,
        token,
      })
      : await confirmUsdtWithdrawalRequestByBridge({
        requestId: req.params.requestId,
      });
    res.status(200).json({
      ok: true,
      request,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/withdrawals/:requestId/cancel", requireBridgeSecret, async (req, res) => {
  try {
    const result = await cancelUsdtWithdrawalRequestByBridge({
      requestId: req.params.requestId,
      adminTelegramId: req.body?.admin_telegram_id ?? req.body?.adminTelegramId,
      adminUsername: req.body?.admin_username ?? req.body?.adminUsername,
    });
    res.status(200).json({
      ok: true,
      request: result.request,
      usdt_cash_balance: result.cash_balance,
      refunded: result.refunded,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/markets/recent", async (req, res) => {
  try {
    const markets = await getRecentMarkets(req.query.limit);
    res.status(200).json({
      ok: true,
      markets,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const result = await getLeaderboard({
      limit: req.query.limit,
      currency: req.query.currency,
      mode: req.query.mode,
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/tasks/share", async (req, res) => {
  try {
    const result = await claimShareTask({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/star-strike/status", async (req, res) => {
  try {
    const diagnostics = await getStarAbuseDiagnostics({
      telegram_id: req.query.telegram_id,
    });
    // unlock_at is only ever non-null once required payment(s) are made and
    // the escalating timer has actually started - before that, no countdown
    // is shown, only the strike level.
    res.status(200).json({
      ok: true,
      strike_count: diagnostics.strike_count,
      actively_banned: diagnostics.actively_banned,
      unlock_at: diagnostics.unlock_at,
      last_ban_reason: diagnostics.last_ban_reason,
      unban: diagnostics.unban,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/star-strike/pay-balance", async (req, res) => {
  try {
    const result = await payStarStrikeWithBalance({
      telegram_id: req.body?.telegram_id,
    });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/star-strike/pay-stars", async (req, res) => {
  try {
    const result = await payStarStrikeWithStars({
      telegram_id: req.body?.telegram_id,
    });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/tasks/daily", async (req, res) => {
  try {
    const result = await claimDailyTask({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      task_key: req.body?.task_key ?? req.body?.taskKey,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

// Задание «Запусти бота»: награда только после проверки у Telegram, что бот
// действительно получил /start от этого пользователя.
app.post("/api/tasks/verify-bot-start", async (req, res) => {
  try {
    const telegramId = req.body?.telegram_id;
    const started = await hasStartedTelegramBot(telegramId);
    if (!started) {
      res.status(200).json({ ok: true, verified: false });
      return;
    }
    const result = await completeVerifiedTask({
      telegram_id: telegramId,
      username: req.body?.username,
      first_name: req.body?.first_name,
      task_key: "bot_start",
      source: "mini_app_task",
    });
    res.status(200).json({ ok: true, verified: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/tasks/claim", async (req, res) => {
  try {
    const taskKey = String(req.body?.task_key ?? req.body?.taskKey ?? "");
    if (!["av_channel", "av_chat"].includes(taskKey)) {
      throw new Error("invalid_task");
    }
    // Награда только за реальную подписку. Если проверить не удалось (бот не
    // админ в канале, Telegram недоступен) — не наказываем пользователя.
    const subscription = await checkTelegramSubscription(
      taskKey === "av_channel" ? config.avChannelChatId : config.avChatChatId,
      req.body?.telegram_id,
    );
    if (subscription.checked && !subscription.subscribed) {
      res.status(200).json({ ok: true, verified: false, subscribed: false });
      return;
    }
    const result = await completeVerifiedTask({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      task_key: taskKey,
      source: "mini_app_task",
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

// Бонусы за суммарный депозит: забирает все достигнутые уровни разом.
app.post("/api/deposit-bonus/claim", async (req, res) => {
  try {
    const result = await claimDepositBonus({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

// «Шейк, шейк!»: пачка встрясок (кормлений) с клиента + сбор бонусов.
app.post("/api/shake-feed/ingest", async (req, res) => {
  try {
    const result = await ingestShakeFeed({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      count: req.body?.count,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/shake-feed/claim", async (req, res) => {
  try {
    const result = await claimShakeFeedBonus({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

// Стрик «Заряд молнии»: отметка входа за сегодня (+лутбокс на 7-й день).
app.post("/api/streak/checkin", async (req, res) => {
  try {
    const result = await checkinStreak({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

// Клиентские события прогресса дейликов (кормление рыбок, просмотры, сторис).
app.post("/api/tasks/event", async (req, res) => {
  try {
    const result = await ingestTaskEvent({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      event_key: req.body?.event_key ?? req.body?.eventKey,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

// Состояние заданий дня: ротация 3 дейликов, лестница присутствия, разовые, стрик.
app.get("/api/tasks/state", async (req, res) => {
  try {
    const result = await getEngagementState({
      telegram_id: req.query?.telegram_id,
      username: req.query?.username,
      first_name: req.query?.first_name,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/loss-refund/:offerId/claim-stars", async (req, res) => {
  try {
    const result = await claimLossRefundWithStars({
      offer_id: req.params.offerId,
      telegram_id: req.body?.telegram_id,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/dev/fire/add", requireDevTools, async (req, res) => {
  try {
    const result = await addFireToUser({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      amount: req.body?.amount,
      reason: req.body?.reason || "dev_topup",
      source: "dev",
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/dev/usdt/add", requireDevTools, async (req, res) => {
  try {
    const result = await addUsdtBonusToUser({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      amount: req.body?.amount,
      reason: req.body?.reason || "dev_usdt_bonus_topup",
      source: "dev",
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/dev/usdt/deposits/scan", requireDevTools, async (_req, res) => {
  try {
    const result = await scanUsdtDeposits();
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/dev/market/create", requireDevTools, async (_req, res) => {
  try {
    const market = await createBtc5mMarket();
    res.status(200).json({
      ok: true,
      market,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/cleanup/run", requireBridgeSecret, async (_req, res) => {
  try {
    const summary = await databaseCleanupTick("bridge");
    res.status(200).json({
      ok: true,
      skipped: !summary,
      summary,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/users/upsert", requireBridgeSecret, async (req, res) => {
  try {
    const user = await upsertUser({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
    });
    res.status(200).json({
      ok: true,
      user,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/promo-campaigns", requireBridgeSecret, async (req, res) => {
  try {
    const campaign = await upsertPromoCampaign({
      code: req.body?.code,
      reward_usdt: req.body?.reward_usdt,
      starts_at: req.body?.starts_at,
      ends_at: req.body?.ends_at,
      is_active: req.body?.is_active,
    });
    res.status(200).json({
      ok: true,
      campaign,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "promo_campaign_create_failed";
    console.warn(`[easymarket] promo campaign create failed: ${message}`);
    res.status(400).json({ ok: false, message });
  }
});

app.get("/api/bridge/promo-campaigns/:code", requireBridgeSecret, async (req, res) => {
  try {
    const campaign = await getPromoCampaignStatus(req.params.code);
    if (!campaign) {
      res.status(404).json({ ok: false, message: "promo_campaign_not_found" });
      return;
    }
    res.status(200).json({
      ok: true,
      campaign,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/fire/add", requireBridgeSecret, async (req, res) => {
  try {
    const result = await addFireToUser({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      amount: req.body?.amount,
      reason: req.body?.reason || "admin_adjustment",
      source: "bridge",
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/usdt/add", requireBridgeSecret, async (req, res) => {
  try {
    const result = await addUsdtBonusToUser({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      amount: req.body?.amount,
      reason: req.body?.reason || "admin_usdt_bonus_adjustment",
      source: "bridge",
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/deposits/credit-pending", requireBridgeSecret, async (req, res) => {
  try {
    const result = await creditPendingDepositIntentManually({
      telegram_id: req.body?.telegram_id,
      amount: req.body?.amount,
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/deposits/scan", requireBridgeSecret, async (_req, res) => {
  try {
    res.status(200).json(await scanUsdtDeposits());
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/deposits/audit", requireBridgeSecret, async (req, res) => {
  try {
    res.status(200).json(await auditUserDeposits({
      telegram_id: req.query.telegram_id ?? req.query.telegramId,
      username: req.query.username,
    }));
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/deposits/pending", requireBridgeSecret, async (req, res) => {
  try {
    res.status(200).json(await listPendingDepositIntents({
      max_age_hours: req.query.max_age_hours,
      limit: req.query.limit,
    }));
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/deposits/review", requireBridgeSecret, async (req, res) => {
  try {
    const events = await getDepositReviewQueue({
      limit: req.query.limit,
      max_age_hours: req.query.max_age_hours,
    });
    res.status(200).json({
      ok: true,
      events,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/deposits/review/credit", requireBridgeSecret, async (req, res) => {
  try {
    const result = await creditDepositEventToIntent({
      event_id: req.body?.event_id ?? req.body?.eventId,
      intent_id: req.body?.intent_id ?? req.body?.intentId,
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/deposits/review/dismiss", requireBridgeSecret, async (req, res) => {
  try {
    const result = await dismissDepositEvent({
      event_id: req.body?.event_id ?? req.body?.eventId,
      intent_id: req.body?.intent_id ?? req.body?.intentId,
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/deposits/revert-credit", requireBridgeSecret, async (req, res) => {
  try {
    const result = await revertManualDepositCredit({
      telegram_id: req.body?.telegram_id,
      intent_id: req.body?.intent_id ?? req.body?.intentId,
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/usdt/cash/add", requireBridgeSecret, async (req, res) => {
  try {
    const result = await addUsdtCashToUser({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      amount: req.body?.amount,
      reason: req.body?.reason || "admin_usdt_cash_adjustment",
      event_key: req.body?.event_key ?? req.body?.eventKey,
      source: "bridge",
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/fire/sync", requireBridgeSecret, async (req, res) => {
  try {
    const result = await syncFireBalance({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      amount: req.body?.amount ?? req.body?.balance,
      reason: req.body?.reason || "admin_adjustment",
      source: "bridge_sync",
      allow_decrease: req.body?.allow_decrease === true || req.body?.allowDecrease === true,
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/fire/sync-username", requireBridgeSecret, async (req, res) => {
  try {
    const result = await syncFireBalanceByUsername({
      username: req.body?.username,
      amount: req.body?.amount ?? req.body?.balance,
      reason: req.body?.reason || "admin_adjustment",
      source: "bridge_sync_username",
      allow_decrease: req.body?.allow_decrease === true || req.body?.allowDecrease === true,
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/users/reset-market-state", requireBridgeSecret, async (req, res) => {
  try {
    const result = await resetUserMarketStateByUsername({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      amount: req.body?.amount ?? req.body?.balance,
      reason: req.body?.reason || "bug_bounty_reset",
      source: "bridge_user_reset",
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/clans", requireBridgeSecret, async (_req, res) => {
  try {
    const result = await getBridgeClans();
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/clans/:clanId/delete", requireBridgeSecret, async (req, res) => {
  try {
    const result = await deleteClan({
      clan_id: req.params.clanId,
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/settings", requireBridgeSecret, async (_req, res) => {
  try {
    const settings = await getProjectEconomySettings();
    res.status(200).json({
      ok: true,
      settings,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/economy/settings", requireBridgeSecret, async (req, res) => {
  try {
    const settings = await updateProjectEconomySettings({
      profit_fee_pct: req.body?.profit_fee_pct ?? req.body?.profitFeePct,
      profit_fee_bps: req.body?.profit_fee_bps ?? req.body?.profitFeeBps,
      star_profit_fee_pct: req.body?.star_profit_fee_pct ?? req.body?.starProfitFeePct,
      star_profit_fee_bps: req.body?.star_profit_fee_bps ?? req.body?.starProfitFeeBps,
      referral_profit_share_pct: req.body?.referral_profit_share_pct ?? req.body?.referralProfitSharePct,
      referral_profit_share_bps: req.body?.referral_profit_share_bps ?? req.body?.referralProfitShareBps,
      clan_profit_share_pct: req.body?.clan_profit_share_pct ?? req.body?.clanProfitSharePct,
      clan_profit_share_bps: req.body?.clan_profit_share_bps ?? req.body?.clanProfitShareBps,
      bonus_unlock_share_pct: req.body?.bonus_unlock_share_pct ?? req.body?.bonusUnlockSharePct,
      bonus_unlock_share_bps: req.body?.bonus_unlock_share_bps ?? req.body?.bonusUnlockShareBps,
      admin_telegram_id: req.body?.admin_telegram_id ?? req.body?.adminTelegramId,
      admin_username: req.body?.admin_username ?? req.body?.adminUsername,
    });
    res.status(200).json({
      ok: true,
      settings,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/amm", requireBridgeSecret, async (_req, res) => {
  try {
    res.status(200).json(await getMarketMakerAdminState());
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/amm/settings", requireBridgeSecret, async (req, res) => {
  try {
    const result = await updateMarketMakerSettings({
      enabled: req.body?.enabled,
      collateral_usdt: req.body?.collateral_usdt ?? req.body?.collateralUsdt,
      collateral_bonus: req.body?.collateral_bonus ?? req.body?.collateralBonus,
      collateral_star: req.body?.collateral_star ?? req.body?.collateralStar,
      spread_bps: req.body?.spread_bps ?? req.body?.spreadBps,
      user_trade_fee_bps: req.body?.user_trade_fee_bps ?? req.body?.userTradeFeeBps,
      max_drawdown_bps: req.body?.max_drawdown_bps ?? req.body?.maxDrawdownBps,
      rapid_loss_bps: req.body?.rapid_loss_bps ?? req.body?.rapidLossBps,
      minimum_quote_capital: req.body?.minimum_quote_capital ?? req.body?.minimumQuoteCapital,
      quote_levels: req.body?.quote_levels ?? req.body?.quoteLevels,
      auto_risk_enabled: req.body?.auto_risk_enabled ?? req.body?.autoRiskEnabled,
      gamma_guard_seconds: req.body?.gamma_guard_seconds ?? req.body?.gammaGuardSeconds,
      max_level_loss_bps: req.body?.max_level_loss_bps ?? req.body?.maxLevelLossBps,
      momentum_guard_seconds: req.body?.momentum_guard_seconds ?? req.body?.momentumGuardSeconds,
      tail_band_seconds: req.body?.tail_band_seconds ?? req.body?.tailBandSeconds,
      tail_band_floor_bps: req.body?.tail_band_floor_bps ?? req.body?.tailBandFloorBps,
      bid_floor_bps: req.body?.bid_floor_bps ?? req.body?.bidFloorBps,
      admin_telegram_id: req.body?.admin_telegram_id ?? req.body?.adminTelegramId,
      admin_username: req.body?.admin_username ?? req.body?.adminUsername,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/amm/book-settings", requireBridgeSecret, async (req, res) => {
  try {
    res.status(200).json(await updateMarketMakerBookSettings({
      book_type: req.body?.book_type ?? req.body?.bookType,
      spread_bps: req.body?.spread_bps,
      max_level_loss_bps: req.body?.max_level_loss_bps,
      tail_band_seconds: req.body?.tail_band_seconds,
      tail_band_floor_bps: req.body?.tail_band_floor_bps,
      bid_floor_bps: req.body?.bid_floor_bps,
      gamma_guard_seconds: req.body?.gamma_guard_seconds,
      momentum_guard_seconds: req.body?.momentum_guard_seconds,
      admin_telegram_id: req.body?.admin_telegram_id ?? req.body?.adminTelegramId,
    }));
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/amm/restart", requireBridgeSecret, async (req, res) => {
  try {
    const result = await restartMarketMaker({
      market_id: req.body?.market_id ?? req.body?.marketId,
      admin_telegram_id: req.body?.admin_telegram_id ?? req.body?.adminTelegramId,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/amm/collateral", requireBridgeSecret, async (req, res) => {
  try {
    const result = await applyMarketMakerCollateral({
      book_types: req.body?.book_types ?? req.body?.bookTypes,
      admin_telegram_id: req.body?.admin_telegram_id ?? req.body?.adminTelegramId,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/admin/unwind-market", requireBridgeSecret, async (req, res) => {
  try {
    const result = await unwindMarket({
      market_id: req.body?.market_id ?? req.body?.marketId,
      dry_run: req.body?.dry_run ?? req.body?.dryRun,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/admin/purge-clan-score", requireBridgeSecret, async (req, res) => {
  try {
    const result = await purgeClanScoreForUsers({
      telegram_ids: req.body?.telegram_ids ?? req.body?.telegramIds,
      dry_run: req.body?.dry_run ?? req.body?.dryRun,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/economy/correct-star-settlement", requireBridgeSecret, async (req, res) => {
  try {
    const result = await correctStarMarketSettlement(req.body || {});
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Settlement correction failed.",
      detail: getSafePublicErrorDetail(error instanceof Error ? error.message : error),
    });
  }
});

app.get("/api/bridge/tasks/subscription-audit", requireBridgeSecret, async (req, res) => {
  try {
    const audit = await auditSubscriptionTasks({ limit: req.query.limit });
    res.status(200).json({
      ok: true,
      ...audit,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/tasks/subscription-revoke", requireBridgeSecret, async (req, res) => {
  try {
    const result = await revokeSubscriptionTask({
      telegram_id: req.body?.telegram_id,
      task_key: req.body?.task_key ?? req.body?.taskKey,
    });
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/depositor-audit", requireBridgeSecret, async (req, res) => {
  try {
    const audit = await getDepositorAudit({
      limit: req.query.limit,
      exclude: req.query.exclude,
    });
    res.status(200).json({
      ok: true,
      ...audit,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/treasury", requireBridgeSecret, async (_req, res) => {
  try {
    res.status(200).json({ ok: true, treasury: await getTreasurySnapshot() });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/bonus-audit", requireBridgeSecret, async (_req, res) => {
  try {
    const audit = await getBonusEconomyAudit();
    res.status(200).json({
      ok: true,
      audit,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/integrity-audit", requireBridgeSecret, async (_req, res) => {
  try {
    const audit = await getEconomyIntegrityAudit();
    res.status(200).json({
      ok: true,
      audit,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/market-maker-audit", requireBridgeSecret, async (req, res) => {
  try {
    const audit = await getMarketMakerEconomyAudit({
      hours: req.query.hours,
      limit: req.query.limit,
    });
    res.status(200).json({
      ok: true,
      audit,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/star-abuse-check", requireBridgeSecret, async (req, res) => {
  try {
    const diagnostics = await getStarAbuseDiagnostics({
      telegram_id: req.query.telegram_id ?? req.query.telegramId,
      username: req.query.username,
    });
    res.status(200).json({
      ok: true,
      ...diagnostics,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/economy/star-strike/test", requireBridgeSecret, async (req, res) => {
  try {
    const result = await issueTestStarStrike({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      strike: req.body?.strike,
    });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/economy/inactivity-notice/test", requireBridgeSecret, async (req, res) => {
  try {
    const result = await issueTestInactivityNotice({
      telegram_id: req.body?.telegram_id,
      stage: req.body?.stage,
      star_burned: req.body?.star_burned,
      usdt_bonus_burned: req.body?.usdt_bonus_burned,
      clan_points_burned: req.body?.clan_points_burned,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/wheel/comeback/reset-free-spin", requireBridgeSecret, async (req, res) => {
  try {
    const result = await resetComebackWheelFreeSpin(req.body?.telegram_id, req.body?.wheel_type);
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/inactivity-burn-events", requireBridgeSecret, async (req, res) => {
  try {
    const events = await listInactivityBurnEventsSince(req.query?.since_id, req.query?.limit);
    res.status(200).json({ ok: true, events });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/economy/inactivity-notice/recover", requireBridgeSecret, async (req, res) => {
  try {
    const result = await applyInactivityRecovery(req.body?.telegram_id, req.body?.stars_amount);
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/economy/star-strike/clear", requireBridgeSecret, async (req, res) => {
  try {
    const result = await clearTestStarStrike({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
    });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/star-strike/active", requireBridgeSecret, async (_req, res) => {
  try {
    const result = await listActiveStarStrikes();
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/inactivity-expiry-audit", requireBridgeSecret, async (req, res) => {
  try {
    const result = await getInactivityExpiryAudit({ since_hours: req.query?.since_hours });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/star-strike/payments", requireBridgeSecret, async (req, res) => {
  try {
    const result = await getStarStrikePayments({
      telegram_id: req.query?.telegram_id,
      all: req.query?.all === "true",
    });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/user-recent-trades", requireBridgeSecret, async (req, res) => {
  try {
    const result = await getUserRecentTrades({
      telegram_id: req.query.telegram_id ?? req.query.telegramId,
      username: req.query.username,
      limit: req.query.limit,
      since_hours: req.query.since_hours,
    });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/live-stats", requireBridgeSecret, async (req, res) => {
  try {
    const result = await getLiveStats({ online_window_minutes: req.query.online_window_minutes });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/users", requireBridgeSecret, async (req, res) => {
  try {
    const result = await listAllUsers({ limit: req.query.limit });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/economy/fire-income-breakdown", requireBridgeSecret, async (req, res) => {
  try {
    const breakdown = await getFireIncomeBreakdown({
      telegram_id: req.query.telegram_id ?? req.query.telegramId,
      username: req.query.username,
      reasons: req.query.reasons,
      recent_limit: req.query.recent_limit,
    });
    res.status(200).json({
      ok: true,
      ...breakdown,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/fire/balance", requireBridgeSecret, async (req, res) => {
  try {
    const telegramId = getTelegramId(req);
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }

    const snapshot = await getUserSnapshot(telegramId);
    res.status(200).json({
      ok: true,
      user: snapshot?.user ?? null,
      balance: snapshot?.balance ?? 0,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/fire/ledger", requireBridgeSecret, async (req, res) => {
  try {
    const events = await getFireLedgerEvents({
      after_id: req.query.after_id ?? req.query.afterId,
      limit: req.query.limit,
    });
    res.status(200).json({
      ok: true,
      events,
      last_id: events.length > 0 ? events[events.length - 1].id : Number(req.query.after_id ?? req.query.afterId ?? 0) || 0,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/usdt/ledger", requireBridgeSecret, async (req, res) => {
  try {
    const events = await getUsdtLedgerEvents({
      after_ts: req.query.after_ts ?? req.query.afterTs,
      limit: req.query.limit,
    });
    res.status(200).json({
      ok: true,
      events,
      last_ts: events.length > 0
        ? events[events.length - 1].created_at
        : (req.query.after_ts ?? req.query.afterTs ?? null),
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/bridge/tasks/state", requireBridgeSecret, async (req, res) => {
  try {
    const result = await getEngagementState({
      telegram_id: req.query?.telegram_id,
      username: req.query?.username,
      first_name: req.query?.first_name,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/promo/contest-snapshot", requireBridgeSecret, async (req, res) => {
  try {
    const telegramIds = [
      ...new Set(
        (Array.isArray(req.body?.telegram_ids) ? req.body.telegram_ids : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ].slice(0, 500);
    // Reuses the same per-user engagement computation as the on-demand
    // /api/bridge/tasks/state path (getEngagementState) instead of the old
    // lightweight SQL snapshot, which only ever covered the 4 balance-hold
    // tasks and silently never credited the other ~15 easymarket-sourced
    // promo tasks (daily bets, topups, referrals, promo_usdt_play, etc.)
    // for anyone relying on the bot's periodic bulk sync.
    const users = (
      await Promise.all(
        telegramIds.map(async (telegram_id) => {
          try {
            const state = await getEngagementState({ telegram_id, skip_activity_touch: true });
            return {
              telegram_id,
              username: null,
              first_name: null,
              progress: state.progress,
              once: state.once,
              promo_contest: state.promo_contest,
            };
          } catch (error) {
            return null;
          }
        }),
      )
    ).filter(Boolean);
    res.status(200).json({ ok: true, users });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/promo/points/buy", requireBridgeSecret, async (req, res) => {
  res.status(400).json({
    ok: false,
    message: "promo_points_telegram_payment_required",
  });
});

app.post("/api/bridge/promo/points/credit", requireBridgeSecret, async (req, res) => {
  try {
    const user = await upsertUser({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
    });
    const purchase = await creditTelegramStarsPromoPointPurchase({
      userId: user.id,
      stars: req.body?.stars,
      dayKey: req.body?.day_key,
      telegramPaymentChargeId: req.body?.telegram_payment_charge_id,
    });
    res.status(200).json({
      ok: true,
      purchase: {
        day_key: purchase.day_key,
        stars_spent: Number(purchase.stars_spent),
        points: Number(purchase.points),
        payment_source: purchase.payment_source,
        already_credited: Boolean(purchase.already_credited),
      },
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/admin/promo/points/reset-day", requireBridgeSecret, async (req, res) => {
  try {
    const result = await resetTelegramPromoPointPurchaseDay({
      telegramId: req.body?.telegram_id ?? req.body?.telegramId,
      dayKey: req.body?.day_key ?? req.body?.dayKey,
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.post("/api/bridge/tasks/complete", requireBridgeSecret, async (req, res) => {
  try {
    const result = await completeVerifiedTask({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      task_key: req.body?.task_key ?? req.body?.taskKey,
      amount: req.body?.amount,
      source: "bridge_task",
    });
    res.status(200).json(result);
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(publicDir, "index.html"));
});

async function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function marketTick() {
  if (marketEngineBusy) {
    return;
  }

  marketEngineBusy = true;
  try {
    await resolveExpiredMarkets();
    await syncSportsMarkets();
    await syncTopMarkets();
  } catch (error) {
    console.warn("[easymarket] market tick failed:", error instanceof Error ? error.message : "unknown error");
  } finally {
    marketEngineBusy = false;
  }
}

async function priceTick() {
  if (priceEngineBusy) {
    return;
  }

  priceEngineBusy = true;
  try {
    const timeoutMs = Math.max(3_000, Math.min(10_000, config.pricePollMs * 4));
    await withTimeout(updateLiveBtcPrice(), timeoutMs, "BTC price tick timed out.");
    await withTimeout(matchOpenClobLimitOrders(), timeoutMs, "CLOB matcher timed out.");
  } catch (error) {
    if (!(error instanceof PriceUnavailableError)) {
      console.warn("[easymarket] price tick failed:", error instanceof Error ? error.message : "unknown error");
    }
  } finally {
    priceEngineBusy = false;
  }
}

async function usdtDepositTick() {
  if (!config.usdtDepositScanEnabled) {
    return;
  }

  // The busy latch is only cleared in finally, so anything that hangs rather
  // than throwing would silence the scanner for good - which is exactly how it
  // once went quiet for days without a log line. Past the deadline we assume the
  // previous run is never coming back and start a fresh one.
  if (usdtDepositScannerBusy) {
    const runningMs = Date.now() - (usdtDepositScannerStartedAt || 0);
    if (runningMs < config.usdtDepositScanStuckMs) {
      return;
    }
    console.warn(
      `[easymarket] USDT deposit scan wedged for ${Math.round(runningMs / 1000)}s, restarting it`,
    );
  }

  usdtDepositScannerBusy = true;
  usdtDepositScannerStartedAt = Date.now();
  try {
    await scanUsdtDeposits();
  } catch (error) {
    console.warn("[easymarket] USDT deposit tick failed:", error instanceof Error ? error.message : "unknown error");
  } finally {
    usdtDepositScannerBusy = false;
  }
}

async function usdtDepositExpiryTick() {
  if (usdtDepositExpiryBusy) {
    return;
  }

  usdtDepositExpiryBusy = true;
  try {
    await expirePendingDepositIntents();
  } catch (error) {
    console.warn(
      "[easymarket] USDT deposit expiry failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  } finally {
    usdtDepositExpiryBusy = false;
  }
}

async function inactivityExpiryTick() {
  if (!config.inactivityExpiryEnabled || inactivityExpiryBusy) {
    return;
  }

  inactivityExpiryBusy = true;
  try {
    const summary = await expireInactiveBalances();
    if (summary.processed_users > 0) {
      console.log("[easymarket] inactivity expiry finished", summary);
    }
  } catch (error) {
    console.warn(
      "[easymarket] inactivity expiry failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  } finally {
    inactivityExpiryBusy = false;
  }
}

async function databaseCleanupTick(reason = "scheduled") {
  if (databaseCleanupBusy || !config.databaseCleanupEnabled) {
    return null;
  }

  databaseCleanupBusy = true;
  try {
    const summary = await runDatabaseCleanup();
    console.log("[easymarket] database cleanup finished", {
      reason,
      ...summary,
    });
    return summary;
  } catch (error) {
    console.warn("[easymarket] database cleanup failed:", error instanceof Error ? error.message : "unknown error");
    return null;
  } finally {
    databaseCleanupBusy = false;
  }
}

async function clanRewardDistributionTick(reason = "scheduled") {
  if (clanRewardDistributionBusy) {
    return null;
  }

  clanRewardDistributionBusy = true;
  try {
    const summary = await distributeDueClanRewardFunds();
    if (summary.summaries?.length) {
      console.log("[easymarket] clan reward distribution finished", {
        reason,
        summaries: summary.summaries,
      });
    }
    return summary;
  } catch (error) {
    console.warn("[easymarket] clan reward distribution failed:", error instanceof Error ? error.message : "unknown error");
    return null;
  } finally {
    clanRewardDistributionBusy = false;
  }
}

async function startMarketEngine() {
  if (marketEngineStarted || !getPool()) {
    return;
  }

  marketEngineStarted = true;
  startBtcPriceStream();
  await ensureRouletteSchema();
  try {
    if (config.startupDatabaseRescueEnabled) {
      const rescueSummary = await runStartupDatabaseRescue();
      console.log("[easymarket] startup database rescue finished", rescueSummary);
    }
    await runMigrations();
    await usdtDepositExpiryTick();
    const worldCupResult = await finalizeWorldCupMarkets();
    console.log("[easymarket] World Cup markets finalized", worldCupResult);
    await resolveExpiredMarkets();
    await priceTick();
    await getKyivstonerMarket();
    void clanRewardDistributionTick("startup");
  } catch (error) {
    console.warn("[easymarket] startup market check failed:", error instanceof Error ? error.message : "unknown error");
  }

  const marketTickMs = Math.max(1_000, Math.min(config.marketIntervalSeconds * 1_000, 2_000));
  setInterval(() => {
    void marketTick();
  }, marketTickMs);

  setInterval(() => {
    void priceTick();
  }, config.pricePollMs);

  void rouletteTick();
  setInterval(() => {
    void rouletteTick();
  }, 1_000);

  if (config.usdtDepositScanEnabled) {
    void usdtDepositTick();
    setInterval(() => {
      void usdtDepositTick();
    }, config.usdtDepositScanMs);
  }

  setInterval(() => {
    void usdtDepositExpiryTick();
  }, 60_000);

  setInterval(() => {
    void inactivityExpiryTick();
  }, 15 * 60_000);

  if (config.databaseCleanupEnabled) {
    if (config.databaseCleanupRunOnStart) {
      setTimeout(() => {
        void databaseCleanupTick("startup");
      }, 15_000);
    }
    setInterval(() => {
      void databaseCleanupTick("daily");
    }, config.databaseCleanupIntervalMs);
  }

  setInterval(() => {
    void clanRewardDistributionTick("daily");
  }, 86_400_000);
}

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Easymarket listening on port ${config.port}`);
  void startMarketEngine();
});
