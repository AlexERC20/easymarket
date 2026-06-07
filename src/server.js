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
  getRecentMarkets,
  getUserSnapshot,
  resolveExpiredMarkets,
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
app.use(express.static(publicDir));

let marketEngineStarted = false;
let marketEngineBusy = false;
let priceEngineBusy = false;

function sendApiError(res, error, fallbackStatus = 500) {
  const message = error instanceof Error ? error.message : String(error);
  const publicErrors = new Set([
    "telegram_id_required",
    "telegram_id_missing",
    "amount_must_be_positive",
    "invalid_market_id",
    "invalid_side",
    "user_not_found",
    "market_not_open",
    "market_closed",
    "insufficient_fire",
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
    res.status(200).json({
      ok: true,
      market,
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
