import express from "express";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { getPool, getSafeDatabaseErrorMessage, query, runMigrations } from "./db.js";
import {
  addFireToUser,
  addUsdtToUser,
  addMarketComment,
  buyOutcome,
  claimDailyTask,
  claimShareTask,
  completeVerifiedTask,
  createClan,
  createBtc5mMarket,
  deleteClan,
  ensureActiveMarket,
  getActiveMarket,
  getBtcMarkets,
  getBridgeClans,
  getClans,
  getFireLedgerEvents,
  getLeaderboard,
  getMarketActivity,
  getMarketComments,
  getMarketOnlineCount,
  getMarketChart,
  getRecentActivity,
  getRecentMarkets,
  getUserSnapshot,
  getUsdtLedgerEvents,
  getWorldCupMarkets,
  joinClan,
  resetUserMarketStateByUsername,
  resolveExpiredMarkets,
  sellOutcome,
  syncFireBalanceByUsername,
  syncFireBalance,
  updateLiveBtcPrice,
  upsertUser,
} from "./services/marketService.js";
import { PriceUnavailableError } from "./services/priceService.js";
import { runDatabaseCleanup, runStartupDatabaseRescue } from "./services/databaseCleanupService.js";
import {
  cancelUserDepositIntent,
  checkUserDepositIntent,
  createUsdtDepositIntent,
  getPublicUsdtDepositNetworks,
  getUserDepositIntent,
  getUserDepositIntents,
  scanUsdtDeposits,
} from "./services/usdtDepositService.js";
import {
  confirmUsdtWithdrawalRequest,
  confirmUsdtWithdrawalRequestByBridge,
  createUsdtWithdrawalRequest,
  getUserWithdrawals,
  getWalletHistory,
} from "./services/usdtWithdrawalService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));
app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-store, max-age=0");
    }
  },
}));

let marketEngineStarted = false;
let marketEngineBusy = false;
let priceEngineBusy = false;
let usdtDepositScannerBusy = false;
let databaseCleanupBusy = false;

function sendApiError(res, error, fallbackStatus = 500) {
  const message = error instanceof Error ? error.message : String(error);
  const publicErrors = new Set([
    "telegram_id_required",
    "telegram_id_missing",
    "username_required",
    "amount_must_be_positive",
    "amount_must_be_non_negative",
    "invalid_market_id",
    "invalid_side",
    "user_not_found",
    "market_not_open",
    "market_closed",
    "insufficient_fire",
    "insufficient_usdt",
    "invalid_deposit_amount",
    "invalid_deposit_network",
    "deposit_amount_collision",
    "deposit_intent_not_found",
    "deposit_intent_not_pending",
    "invalid_withdrawal_amount",
    "invalid_withdrawal_network",
    "invalid_withdrawal_address",
    "withdrawal_not_found",
    "withdrawal_not_pending",
    "position_not_open",
    "invalid_position_id",
    "invalid_sell_shares",
    "invalid_task",
    "task_not_ready",
    "comment_required",
    "insufficient_shares",
    "invalid_market_price",
    "invoice_failed",
    "invoice_not_configured",
    "sell_failed",
    "sell_frozen",
    "clan_not_found",
    "clan_name_required",
    "invalid_clan_channel",
    "clan_exists",
    "clan_default_locked",
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

  res.status(publicErrors.has(message) ? 400 : fallbackStatus).json({
    ok: false,
    message: publicErrors.has(message) ? message : "Request failed.",
  });
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

app.get("/api/public/config", (_req, res) => {
  res.status(200).json({
    ok: true,
    av_bot_url: config.publicAvBotUrl,
    mini_app_url: config.publicMiniAppUrl,
    referral_bonus_fire: config.referralBetBonusFire,
    task_share_fire: config.taskShareFire,
    task_subscribe_fire: config.taskSubscribeFire,
    task_private_chat_fire: config.taskPrivateChatFire,
    task_daily_presence_fire: config.taskDailyPresenceFire,
    task_daily_bet_fire: config.taskDailyBetFire,
    task_daily_cap_fire: config.taskDailyCapFire,
    referral_signup_bonus_usdt: config.referralSignupBonusUsdt,
    referral_bet_bonus_usdt: config.referralBetBonusUsdt,
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

app.post("/api/stars/invoice", async (req, res) => {
  try {
    if (!config.telegramBotToken) {
      throw new Error("invoice_not_configured");
    }

    const telegramId = String(req.body?.telegram_id || "").trim();
    const amount = Math.round(Number(req.body?.amount || 0));
    if (!telegramId) {
      throw new Error("telegram_id_missing");
    }
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000) {
      throw new Error("amount_must_be_positive");
    }

    const payload = buildStarsTopupPayload({ telegramId, amount });
    const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/createInvoiceLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${amount.toLocaleString("ru-RU")} звезд`,
        description: `Пополнение баланса Polymarket: ${amount.toLocaleString("ru-RU")}⭐`,
        payload,
        provider_token: "",
        currency: "XTR",
        prices: [
          {
            label: `${amount.toLocaleString("ru-RU")}⭐`,
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
          <title>Polymarket withdrawal</title>
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
    const snapshot = await getUserSnapshot(user.telegram_id);
    res.status(200).json({
      ok: true,
      ...snapshot,
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

    res.status(200).json({
      ok: true,
      ...snapshot,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/market/active", async (_req, res) => {
  try {
    await priceTick();
    const market = await getActiveMarket();
    let activity = [];
    let chart = [];
    if (market) {
      try {
        [activity, chart] = await Promise.all([
          getMarketActivity(market.id, 24),
          getMarketChart(market, 260),
        ]);
      } catch (error) {
        console.warn("[easymarket] active market extras failed:", error instanceof Error ? error.message : "unknown error");
      }
    }
    res.status(200).json({
      ok: true,
      market,
      activity,
      chart,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

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

app.get("/api/activity/recent", async (req, res) => {
  try {
    const activity = await getRecentActivity(req.query.limit);
    res.status(200).json({
      ok: true,
      activity,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/world-cup/markets", async (_req, res) => {
  try {
    const result = await getWorldCupMarkets();
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

app.get("/api/btc/markets", async (_req, res) => {
  try {
    const markets = await getBtcMarkets();
    res.status(200).json({
      ok: true,
      markets,
    });
  } catch (error) {
    sendApiError(res, error);
  }
});

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
    const [comments, onlineCount] = await Promise.all([
      getMarketComments(req.params.marketId, req.query.limit),
      getMarketOnlineCount(req.params.marketId),
    ]);
    res.status(200).json({
      ok: true,
      comments,
      online_count: onlineCount,
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
    const players = await getLeaderboard(req.query.limit, req.query.currency);
    res.status(200).json({
      ok: true,
      currency: String(req.query.currency || "STAR").toUpperCase() === "USDT" ? "USDT" : "STAR",
      players,
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

app.post("/api/tasks/claim", async (req, res) => {
  try {
    const taskKey = req.body?.task_key ?? req.body?.taskKey;
    if (!["av_channel", "av_chat"].includes(String(taskKey || ""))) {
      throw new Error("invalid_task");
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
    const result = await addUsdtToUser({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      amount: req.body?.amount,
      reason: req.body?.reason || "dev_usdt_topup",
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
    const result = await addUsdtToUser({
      telegram_id: req.body?.telegram_id,
      username: req.body?.username,
      first_name: req.body?.first_name,
      amount: req.body?.amount,
      reason: req.body?.reason || "admin_usdt_adjustment",
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
    await ensureActiveMarket();
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
  } catch (error) {
    if (!(error instanceof PriceUnavailableError)) {
      console.warn("[easymarket] price tick failed:", error instanceof Error ? error.message : "unknown error");
    }
  } finally {
    priceEngineBusy = false;
  }
}

async function usdtDepositTick() {
  if (usdtDepositScannerBusy || !config.usdtDepositScanEnabled) {
    return;
  }

  usdtDepositScannerBusy = true;
  try {
    await scanUsdtDeposits();
  } catch (error) {
    console.warn("[easymarket] USDT deposit tick failed:", error instanceof Error ? error.message : "unknown error");
  } finally {
    usdtDepositScannerBusy = false;
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

async function startMarketEngine() {
  if (marketEngineStarted || !getPool()) {
    return;
  }

  marketEngineStarted = true;
  try {
    if (config.startupDatabaseRescueEnabled) {
      const rescueSummary = await runStartupDatabaseRescue();
      console.log("[easymarket] startup database rescue finished", rescueSummary);
    }
    await runMigrations();
    await ensureActiveMarket();
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

  if (config.usdtDepositScanEnabled) {
    void usdtDepositTick();
    setInterval(() => {
      void usdtDepositTick();
    }, config.usdtDepositScanMs);
  }

  if (config.databaseCleanupEnabled) {
    setTimeout(() => {
      void databaseCleanupTick(config.databaseCleanupRunOnStart ? "startup" : "startup-safety");
    }, 15_000);
    setInterval(() => {
      void databaseCleanupTick("daily");
    }, config.databaseCleanupIntervalMs);
  }
}

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Easymarket listening on port ${config.port}`);
  void startMarketEngine();
});
