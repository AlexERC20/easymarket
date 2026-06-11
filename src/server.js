import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { getPool, getSafeDatabaseErrorMessage, query, runMigrations } from "./db.js";
import {
  addFireToUser,
  buyOutcome,
  createBtc5mMarket,
  ensureActiveMarket,
  getActiveMarket,
  getFireLedgerEvents,
  getMarketActivity,
  getMarketChart,
  getRecentMarkets,
  getUserSnapshot,
  resolveExpiredMarkets,
  sellOutcome,
  syncFireBalance,
  updateLiveBtcPrice,
  upsertUser,
} from "./services/marketService.js";
import { PriceUnavailableError } from "./services/priceService.js";

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

function sendApiError(res, error, fallbackStatus = 500) {
  const message = error instanceof Error ? error.message : String(error);
  const publicErrors = new Set([
    "telegram_id_required",
    "telegram_id_missing",
    "amount_must_be_positive",
    "amount_must_be_non_negative",
    "invalid_market_id",
    "invalid_side",
    "user_not_found",
    "market_not_open",
    "market_closed",
    "insufficient_fire",
    "position_not_open",
    "invalid_position_id",
    "invalid_sell_shares",
    "insufficient_shares",
    "invalid_market_price",
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
  });
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
    const market = await getActiveMarket();
    const [activity, chart] = market
      ? await Promise.all([
        getMarketActivity(market.id, 24),
        getMarketChart(market, 260),
      ])
      : [[], []];
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

app.post("/api/market/:marketId/buy", async (req, res) => {
  try {
    const result = await buyOutcome({
      marketId: req.params.marketId,
      telegram_id: req.body?.telegram_id,
      side: req.body?.side,
      amount: req.body?.amount,
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
    console.warn("[EasyMarket] sell failed", {
      telegram_id: req.body?.telegram_id,
      market_id: req.params.marketId,
      position_id: req.body?.position_id,
      side: req.body?.side,
      message: error instanceof Error ? error.message : String(error),
    });
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

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

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
    await updateLiveBtcPrice();
  } catch (error) {
    if (!(error instanceof PriceUnavailableError)) {
      console.warn("[easymarket] price tick failed:", error instanceof Error ? error.message : "unknown error");
    }
  } finally {
    priceEngineBusy = false;
  }
}

async function startMarketEngine() {
  if (marketEngineStarted || !getPool()) {
    return;
  }

  marketEngineStarted = true;
  try {
    await runMigrations();
    await ensureActiveMarket();
  } catch (error) {
    console.warn("[easymarket] startup market check failed:", error instanceof Error ? error.message : "unknown error");
  }

  setInterval(() => {
    void marketTick();
  }, config.marketIntervalSeconds * 1_000);

  setInterval(() => {
    void priceTick();
  }, config.pricePollMs);
}

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Easymarket listening on port ${config.port}`);
  void startMarketEngine();
});
