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
  marketIntervalSeconds: parseNumber(process.env.MARKET_INTERVAL_SECONDS, 10, 1),
  marketDurationMinutes: parseNumber(process.env.MARKET_DURATION_MINUTES, 5, 1),
  marketLiquidity: parseNumber(process.env.MARKET_LIQUIDITY, 10_000, 100),
  marketFeeBps: parseNumber(process.env.MARKET_FEE_BPS, 200, 0),
  pricePollMs: parseNumber(process.env.PRICE_POLL_MS, 1_000, 250),
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
