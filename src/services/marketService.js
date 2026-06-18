import { clamp, config } from "../config.js";
import { query, toNumber, withTransaction } from "../db.js";
import { getBtcPrice, PriceUnavailableError } from "./priceService.js";

const MARKET_SYMBOL = "BTCUSDT";
const WORLD_CUP_EVENT_SLUG = "world-cup-winner";
const WORLD_CUP_SYMBOL_PREFIX = "WCUP:";
const MIN_PRICE = 0.001;
const MAX_PRICE = 0.999;
const BTC_MIN_PRICE = 0.04;
const DEFAULT_FEE_BPS = 200;
const DEFAULT_PROFIT_FEE_BPS = 500;
const DEFAULT_MARKET_MAKER_SPREAD_BPS = 300;
const BUY_IMPACT_MULTIPLIER = 0.85;
const SELL_IMPACT_MULTIPLIER = 1.1;
const REFERRAL_SIGNUP_BONUS = 100;

const BTC_MARKET_DEFS = [
  { key: "5M", symbol: MARKET_SYMBOL, label: "5m", title: "BTC Up or Down 5m", durationMinutes: null },
  { key: "15M", symbol: "BTCUSDT_15M", label: "15m", title: "BTC Up or Down 15m", durationMinutes: 15 },
  { key: "1H", symbol: "BTCUSDT_1H", label: "1h", title: "BTC Up or Down 1h", durationMinutes: 60 },
  { key: "12H", symbol: "BTCUSDT_12H", label: "12h", title: "BTC Up or Down 12h", durationMinutes: 720 },
  { key: "24H", symbol: "BTCUSDT_24H", label: "24h", title: "BTC Up or Down 24h", durationMinutes: 1440 },
  { key: "7D", symbol: "BTCUSDT_7D", label: "7d", title: "BTC Up or Down 7d", durationMinutes: 10080 },
];

const BTC_MARKET_SYMBOLS = BTC_MARKET_DEFS.map((definition) => definition.symbol);

const WORLD_CUP_FALLBACK_MARKETS = [
  { polymarketId: "fallback-france", team: "France", icon: "🇫🇷", yesPrice: 0.171, volume: 54_606_121 },
  { polymarketId: "fallback-spain", team: "Spain", icon: "🇪🇸", yesPrice: 0.146, volume: 48_880_678 },
  { polymarketId: "fallback-portugal", team: "Portugal", icon: "🇵🇹", yesPrice: 0.108, volume: 48_252_376 },
  { polymarketId: "fallback-england", team: "England", icon: "🏴", yesPrice: 0.105, volume: 45_020_000 },
  { polymarketId: "fallback-brazil", team: "Brazil", icon: "🇧🇷", yesPrice: 0.093, volume: 44_500_000 },
  { polymarketId: "fallback-argentina", team: "Argentina", icon: "🇦🇷", yesPrice: 0.084, volume: 43_700_000 },
  { polymarketId: "fallback-germany", team: "Germany", icon: "🇩🇪", yesPrice: 0.061, volume: 38_200_000 },
  { polymarketId: "fallback-netherlands", team: "Netherlands", icon: "🇳🇱", yesPrice: 0.049, volume: 31_900_000 },
  { polymarketId: "fallback-italy", team: "Italy", icon: "🇮🇹", yesPrice: 0.035, volume: 24_700_000 },
  { polymarketId: "fallback-usa", team: "USA", icon: "🇺🇸", yesPrice: 0.026, volume: 21_000_000 },
  { polymarketId: "fallback-mexico", team: "Mexico", icon: "🇲🇽", yesPrice: 0.018, volume: 16_600_000 },
  { polymarketId: "fallback-canada", team: "Canada", icon: "🇨🇦", yesPrice: 0.012, volume: 12_300_000 },
];

function getBtcMarketDef(symbol) {
  return BTC_MARKET_DEFS.find((definition) => definition.symbol === symbol) || null;
}

function isBtcMarketSymbol(symbol) {
  return Boolean(getBtcMarketDef(symbol));
}

function getBtcMarketDurationMinutes(definition) {
  return definition?.durationMinutes ?? config.marketDurationMinutes;
}

function mapMarket(row) {
  if (!row) {
    return null;
  }
  const btcDefinition = getBtcMarketDef(row.symbol);
  const minPrice = btcDefinition ? BTC_MIN_PRICE : MIN_PRICE;
  const yesPrice = roundOutcomePrice(toNumber(row.yes_price), minPrice);
  const noPrice = roundOutcomePrice(1 - yesPrice, minPrice);

  return {
    id: Number(row.id),
    symbol: row.symbol,
    market_type: btcDefinition ? "BTC_UPDOWN" : undefined,
    title: btcDefinition?.title,
    label: btcDefinition?.label,
    question: row.question,
    open_price: toNumber(row.open_price),
    close_price: row.close_price === null ? null : toNumber(row.close_price),
    current_price: row.current_price === null ? null : toNumber(row.current_price),
    yes_price: yesPrice,
    no_price: noPrice,
    yes_volume: toNumber(row.yes_volume),
    no_volume: toNumber(row.no_volume),
    liquidity: toNumber(row.liquidity),
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    winner: row.winner,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
  };
}

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    telegram_id: row.telegram_id,
    username: row.username,
    first_name: row.first_name,
    referred_by_telegram_id: row.referred_by_telegram_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapPosition(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    market_id: Number(row.market_id),
    side: row.side,
    shares: toNumber(row.shares),
    spent: toNumber(row.spent),
    avg_price: toNumber(row.avg_price),
    payout: toNumber(row.payout),
    pnl: toNumber(row.pnl),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    question: row.question,
    winner: row.winner,
    market_status: row.market_status,
    market_end_time: row.market_end_time,
    market_symbol: row.market_symbol,
    team: row.team,
    yes_price: row.yes_price === undefined ? undefined : toNumber(row.yes_price),
    no_price: row.no_price === undefined ? undefined : toNumber(row.no_price),
  };
}

function mapTrade(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    market_id: Number(row.market_id),
    action: row.action || "BUY",
    side: row.side,
    amount: toNumber(row.amount),
    fee: toNumber(row.fee),
    price: toNumber(row.price),
    shares: toNumber(row.shares),
    created_at: row.created_at,
  };
}

function mapMarketActivity(row) {
  return {
    id: Number(row.id),
    market_id: Number(row.market_id),
    market_symbol: row.market_symbol,
    market_question: row.market_question,
    market_status: row.market_status,
    market_winner: row.market_winner,
    team: row.team,
    telegram_id: row.telegram_id,
    username: row.username,
    first_name: row.first_name,
    action: row.action || "BUY",
    side: row.side,
    amount: toNumber(row.amount),
    fee: toNumber(row.fee),
    price: toNumber(row.price),
    shares: toNumber(row.shares),
    created_at: row.created_at,
  };
}

function mapMarketComment(row) {
  const latestBetAmount = row.latest_bet_amount === null || row.latest_bet_amount === undefined
    ? null
    : toNumber(row.latest_bet_amount);
  return {
    id: Number(row.id),
    market_id: Number(row.market_id),
    message: row.message,
    created_at: row.created_at,
    telegram_id: row.telegram_id,
    username: row.username,
    first_name: row.first_name,
    latest_bet: latestBetAmount === null
      ? null
      : {
        action: row.latest_bet_action || "BUY",
        side: row.latest_bet_side,
        amount: latestBetAmount,
        price: toNumber(row.latest_bet_price),
        shares: toNumber(row.latest_bet_shares),
        created_at: row.latest_bet_created_at,
      },
  };
}

function mapWorldCupMarket(row) {
  const yesPrice = toNumber(row.yes_price);
  const localVolume = toNumber(row.yes_volume) + toNumber(row.no_volume);
  const externalVolume = toNumber(row.meta_volume ?? row.volume);
  return {
    id: Number(row.id),
    symbol: row.symbol,
    market_type: "WORLD_CUP_WINNER",
    title: "World Cup Winner",
    team: row.team,
    icon: row.icon || "🏆",
    image: row.icon || null,
    slug: row.slug,
    polymarket_id: row.polymarket_id,
    question: row.question,
    open_price: toNumber(row.open_price),
    current_price: yesPrice,
    yes_price: yesPrice,
    no_price: toNumber(row.no_price, 1 - yesPrice),
    chance_pct: Math.round(yesPrice * 1000) / 10,
    volume: localVolume,
    external_volume: externalVolume,
    yes_volume: toNumber(row.yes_volume),
    no_volume: toNumber(row.no_volume),
    chart: row.chart || [],
    start_time: row.start_time,
    status: row.status,
    end_time: row.end_time,
  };
}

function mapMarketChartPoint(row) {
  return {
    price: toNumber(row.price),
    source: row.source,
    created_at: row.created_at,
  };
}

function mapFireLedgerEvent(row) {
  return {
    id: Number(row.id),
    telegram_id: row.telegram_id,
    username: row.username,
    first_name: row.first_name,
    amount: toNumber(row.amount),
    reason: row.reason,
    source: row.source,
    created_at: row.created_at,
  };
}

function questionForPrice(price, definition = getBtcMarketDef(MARKET_SYMBOL)) {
  return `BTC будет выше ${Math.round(price).toLocaleString("ru-RU")} через ${definition?.label || "5m"}?`;
}

function getMarketProgress(market) {
  const start = new Date(market.start_time).getTime();
  const end = new Date(market.end_time).getTime();
  const duration = Math.max(1, end - start);
  return clamp((Date.now() - start) / duration, 0, 1);
}

function getMarketMinOutcomePrice(market) {
  return isBtcMarketSymbol(market?.symbol) ? BTC_MIN_PRICE : MIN_PRICE;
}

function isSportsMarket(market) {
  return String(market?.symbol || "").startsWith(WORLD_CUP_SYMBOL_PREFIX);
}

function getMarketMakerYesPrice(market, currentPrice, options = {}) {
  const openPrice = toNumber(market.open_price);
  const minPrice = getMarketMinOutcomePrice(market);
  const maxPrice = 1 - minPrice;
  const previousYesPrice = clamp(toNumber(market.yes_price, 0.5), minPrice, maxPrice);
  if (!openPrice || !currentPrice) {
    return previousYesPrice;
  }

  const progress = getMarketProgress(market);
  const movementPct = ((currentPrice - openPrice) / openPrice) * 100;
  const previousPrice = toNumber(market.current_price, openPrice);
  const momentumPct = ((currentPrice - previousPrice) / openPrice) * 100;

  const signalScalePct = Math.max(0.006, 0.12 - progress * 0.105);
  const directionalSignal = Math.tanh(movementPct / signalScalePct);
  const momentumSignal = Math.tanh(momentumPct / 0.012);
  const deadlineSignal = Math.tanh(movementPct / Math.max(0.004, 0.04 - progress * 0.034));
  const directionalWeight = 0.36 + progress * 0.38;
  const deadlineWeight = Math.max(0, progress - 0.72) * 0.68;
  const priceProbability = 0.5
    + directionalSignal * directionalWeight
    + deadlineSignal * deadlineWeight
    + momentumSignal * (0.04 + progress * 0.035);

  const yesVolume = toNumber(market.yes_volume);
  const noVolume = toNumber(market.no_volume);
  const liquidity = toNumber(market.liquidity, config.marketLiquidity);
  const volumeTotal = yesVolume + noVolume;
  const imbalance = volumeTotal > 0
    ? (yesVolume - noVolume) / (volumeTotal + liquidity * 0.08)
    : 0;
  const orderProbability = 0.5 + clamp(imbalance, -1, 1) * 0.42;

  const target = clamp(priceProbability * 0.86 + orderProbability * 0.14, minPrice, maxPrice);
  const adaptiveInertia = options.fast
    ? 0.24
    : Math.max(0.08, 0.48 - progress * 0.4);
  const panicInertia = Math.abs(target - previousYesPrice) > 0.18 ? 0.08 : adaptiveInertia;
  const tradeShift = Number(options.tradeShift || 0);

  return clamp(previousYesPrice * panicInertia + target * (1 - panicInertia) + tradeShift, minPrice, maxPrice);
}

function ensurePositiveAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("amount_must_be_positive");
  }

  return Math.round(value * 100) / 100;
}

function ensureNonNegativeAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("amount_must_be_non_negative");
  }

  return Math.round(value * 100) / 100;
}

function getFeeBps() {
  return Number.isFinite(config.marketFeeBps) ? config.marketFeeBps : DEFAULT_FEE_BPS;
}

function calculateFee(amount) {
  return Math.round(Number(amount || 0) * (getFeeBps() / 10_000) * 100) / 100;
}

function getProfitFeeBps() {
  return Number.isFinite(config.marketProfitFeeBps) ? config.marketProfitFeeBps : DEFAULT_PROFIT_FEE_BPS;
}

function calculateProfitFee(profit) {
  return Math.round(Math.max(0, Number(profit || 0)) * (getProfitFeeBps() / 10_000) * 100) / 100;
}

function getMarketMakerSpreadBps() {
  return Number.isFinite(config.marketMakerSpreadBps)
    ? config.marketMakerSpreadBps
    : DEFAULT_MARKET_MAKER_SPREAD_BPS;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function roundOutcomePrice(value, minPrice = MIN_PRICE) {
  return Math.round(clamp(Number(value || 0), minPrice, 1 - minPrice) * 100_000_000) / 100_000_000;
}

function getOutcomePriceFromYes(yesPrice, side, minPrice = MIN_PRICE) {
  const normalizedYesPrice = roundOutcomePrice(yesPrice, minPrice);
  return side === "YES" ? normalizedYesPrice : roundOutcomePrice(1 - normalizedYesPrice, minPrice);
}

function getMarketOutcomePrice(market, side) {
  const minPrice = getMarketMinOutcomePrice(market);
  return side === "YES"
    ? roundOutcomePrice(toNumber(market.yes_price), minPrice)
    : roundOutcomePrice(toNumber(market.no_price), minPrice);
}

function getCurrentPriceForMarket(market) {
  return toNumber(market.current_price, toNumber(market.open_price));
}

function getBuyExecutionQuote(market, side, amount) {
  const minPrice = getMarketMinOutcomePrice(market);
  const oldOutcomePrice = getMarketOutcomePrice(market, side);
  const liquidity = toNumber(market.liquidity, config.marketLiquidity);
  const tradeShift = (side === "YES" ? 1 : -1) * (amount / liquidity) * BUY_IMPACT_MULTIPLIER;
  const repricedMarket = {
    ...market,
    yes_volume: toNumber(market.yes_volume) + (side === "YES" ? amount : 0),
    no_volume: toNumber(market.no_volume) + (side === "NO" ? amount : 0),
  };
  const nextYesPrice = roundOutcomePrice(getMarketMakerYesPrice(
    repricedMarket,
    getCurrentPriceForMarket(market),
    { fast: true, tradeShift },
  ), minPrice);
  const nextOutcomePrice = getOutcomePriceFromYes(nextYesPrice, side, minPrice);
  const spread = getMarketMakerSpreadBps() / 10_000;
  const executionPrice = roundOutcomePrice(Math.max(oldOutcomePrice, nextOutcomePrice) * (1 + spread), minPrice);

  return {
    oldOutcomePrice,
    executionPrice,
    nextYesPrice,
    nextNoPrice: roundOutcomePrice(1 - nextYesPrice, minPrice),
  };
}

function getSellExecutionQuote(market, side, sharesToSell) {
  const minPrice = getMarketMinOutcomePrice(market);
  const oldOutcomePrice = getMarketOutcomePrice(market, side);
  const liquidity = toNumber(market.liquidity, config.marketLiquidity);
  const estimatedGross = Math.max(0, sharesToSell * oldOutcomePrice);
  const tradeShift = (side === "YES" ? -1 : 1) * (estimatedGross / liquidity) * SELL_IMPACT_MULTIPLIER;
  const repricedMarket = {
    ...market,
    yes_volume: side === "YES"
      ? Math.max(0, toNumber(market.yes_volume) - estimatedGross)
      : toNumber(market.yes_volume),
    no_volume: side === "NO"
      ? Math.max(0, toNumber(market.no_volume) - estimatedGross)
      : toNumber(market.no_volume),
  };
  const nextYesPrice = roundOutcomePrice(getMarketMakerYesPrice(
    repricedMarket,
    getCurrentPriceForMarket(market),
    { fast: true, tradeShift },
  ), minPrice);
  const nextOutcomePrice = getOutcomePriceFromYes(nextYesPrice, side, minPrice);
  const spread = getMarketMakerSpreadBps() / 10_000;
  const exitPenalty = isSportsMarket(market) ? 0.02 : 0;
  const executionPrice = roundOutcomePrice(Math.min(oldOutcomePrice, nextOutcomePrice) * (1 - spread - exitPenalty), minPrice);
  const gross = roundMoney(sharesToSell * executionPrice);

  return {
    oldOutcomePrice,
    executionPrice,
    gross,
    nextYesPrice,
    nextNoPrice: roundOutcomePrice(1 - nextYesPrice, minPrice),
    nextYesVolume: repricedMarket.yes_volume,
    nextNoVolume: repricedMarket.no_volume,
  };
}

function normalizeWorldCupTeam(question) {
  return String(question || "")
    .replace(/^Will\s+/i, "")
    .replace(/\s+win the 2026 FIFA World Cup\??$/i, "")
    .trim();
}

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  try {
    return JSON.parse(String(value || "[]"));
  } catch {
    return [];
  }
}

function normalizeWorldCupFeedMarket(market) {
  const outcomePrices = parseJsonArray(market.outcomePrices);
  const rawYesPrice = Number(outcomePrices[0]);
  const team = normalizeWorldCupTeam(market.question);
  if (!team || !Number.isFinite(rawYesPrice)) {
    return null;
  }
  const yesPrice = clamp(rawYesPrice, MIN_PRICE, MAX_PRICE);

  return {
    polymarketId: String(market.id || market.slug || team),
    team,
    icon: market.icon || market.image || "",
    slug: market.slug || "",
    yesPrice,
    volume: toNumber(market.volumeNum ?? market.volume),
  };
}

async function fetchWorldCupMarketsFromPolymarket() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(
      `https://gamma-api.polymarket.com/events/slug/${WORLD_CUP_EVENT_SLUG}`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      throw new Error(`polymarket_${response.status}`);
    }
    const event = await response.json();
    return (event.markets || [])
      .map(normalizeWorldCupFeedMarket)
      .filter(Boolean)
      .sort((a, b) => b.yesPrice - a.yesPrice)
      .slice(0, 60);
  } finally {
    clearTimeout(timeout);
  }
}

function worldCupSymbol(input) {
  return `${WORLD_CUP_SYMBOL_PREFIX}${String(input.polymarketId).replace(/[^a-z0-9_-]/gi, "_")}`;
}

async function getWorldCupFeedMarkets() {
  try {
    const markets = await fetchWorldCupMarketsFromPolymarket();
    if (markets.length) {
      return {
        source: "polymarket",
        markets,
      };
    }
  } catch (error) {
    console.warn("[EasyMarket] Polymarket World Cup fetch failed", error instanceof Error ? error.message : String(error));
  }

  return {
    source: "fallback",
    markets: WORLD_CUP_FALLBACK_MARKETS,
  };
}

function getDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getTaskReason(taskKey) {
  return `task_${String(taskKey || "").replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;
}

async function getDailyBonusRemaining(client, userId) {
  const result = await client.query(
    `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM fire_ledger
      WHERE user_id = $1
        AND amount > 0
        AND reason IN (
          'task_share_friend',
          'task_av_channel',
          'task_av_chat',
          'task_daily_presence',
          'task_daily_bet',
          'referral_bet_bonus'
        )
        AND created_at >= date_trunc('day', now())
    `,
    [userId],
  );
  const used = Math.max(0, toNumber(result.rows[0]?.total));
  return Math.max(0, Math.round((config.taskDailyCapFire - used) * 100) / 100);
}

async function awardBonusWithDailyCap(client, userId, amount, reason, source) {
  const requestedAmount = Math.max(0, Math.round(Number(amount || 0) * 100) / 100);
  const remaining = await getDailyBonusRemaining(client, userId);
  const awarded = Math.min(requestedAmount, remaining);
  if (awarded <= 0) {
    return {
      awarded: 0,
      daily_remaining: remaining,
      cap_reached: true,
    };
  }

  await client.query(
    `
      UPDATE fire_balances
      SET balance = balance + $2,
          updated_at = now()
      WHERE user_id = $1
    `,
    [userId, awarded],
  );
  await client.query(
    `
      INSERT INTO fire_ledger (user_id, amount, reason, source)
      VALUES ($1, $2, $3, $4)
    `,
    [userId, awarded, reason, source],
  );

  return {
    awarded,
    daily_remaining: Math.max(0, Math.round((remaining - awarded) * 100) / 100),
    cap_reached: awarded < requestedAmount,
  };
}

export async function upsertUser(input) {
  const telegramId = String(input.telegram_id ?? "").trim();
  if (!telegramId) {
    throw new Error("telegram_id_required");
  }
  const referredByTelegramId = String(input.referred_by_telegram_id ?? input.ref ?? "")
    .trim()
    .replace(/^ref_/, "");
  const safeReferredBy = referredByTelegramId && referredByTelegramId !== telegramId
    ? referredByTelegramId
    : null;

  return withTransaction(async (client) => {
    const userResult = await client.query(
      `
        INSERT INTO users (telegram_id, username, first_name, referred_by_telegram_id, updated_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (telegram_id) DO UPDATE SET
          username = EXCLUDED.username,
          first_name = EXCLUDED.first_name,
          referred_by_telegram_id = COALESCE(users.referred_by_telegram_id, EXCLUDED.referred_by_telegram_id),
          updated_at = now()
        RETURNING *
      `,
      [
        telegramId,
        input.username ? String(input.username).replace(/^@/, "") : null,
        input.first_name ? String(input.first_name) : null,
        safeReferredBy,
      ],
    );
    const user = userResult.rows[0];

    await client.query(
      `
        INSERT INTO fire_balances (user_id, balance, updated_at)
        VALUES ($1, 0, now())
        ON CONFLICT (user_id) DO NOTHING
      `,
      [user.id],
    );

    if (safeReferredBy) {
      const referralSignupResult = await client.query(
        `
          INSERT INTO fire_task_claims (user_id, task_key, amount, day_key, source)
          VALUES ($1, 'referral_signup', $2, 'once', $3)
          ON CONFLICT DO NOTHING
          RETURNING *
        `,
        [user.id, REFERRAL_SIGNUP_BONUS, `referral:${safeReferredBy}`],
      );
      if (referralSignupResult.rows[0]) {
        await adjustBalance(
          client,
          user.id,
          REFERRAL_SIGNUP_BONUS,
          "referral_signup_bonus",
          `referral:${safeReferredBy}`,
        );
      }
    }

    return mapUser(user);
  });
}

export async function getUserByTelegramId(telegramId) {
  const result = await query(
    `
      SELECT *
      FROM users
      WHERE telegram_id = $1
      LIMIT 1
    `,
    [String(telegramId)],
  );

  return mapUser(result.rows[0]);
}

async function getBalanceByUserId(userId) {
  const result = await query(
    `
      SELECT balance
      FROM fire_balances
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  return toNumber(result.rows[0]?.balance);
}

async function adjustBalance(client, userId, amount, reason, source) {
  const delta = Math.round(Number(amount || 0) * 100) / 100;
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) {
    return;
  }

  await client.query(
    `
      UPDATE fire_balances
      SET balance = balance + $2::numeric,
          updated_at = now()
      WHERE user_id = $1
    `,
    [userId, delta],
  );
  await client.query(
    `
      INSERT INTO fire_ledger (user_id, amount, reason, source)
      VALUES ($1, $2::numeric, $3, $4)
    `,
    [userId, delta, reason, source],
  );
}

export async function getUserSnapshot(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    return null;
  }

  const [balance, positionsResult, tradesResult] = await Promise.all([
    getBalanceByUserId(user.id),
    query(
      `
        SELECT
          p.*,
          m.question,
          m.winner,
          m.status AS market_status,
          m.end_time AS market_end_time,
          m.symbol AS market_symbol,
          meta.team AS team,
          m.yes_price,
          m.no_price
        FROM positions p
        JOIN markets m ON m.id = p.market_id
        LEFT JOIN world_cup_market_meta meta ON meta.symbol = m.symbol
        WHERE p.user_id = $1
        ORDER BY p.updated_at DESC
        LIMIT 20
      `,
      [user.id],
    ),
    query(
      `
        SELECT *
        FROM trades
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `,
      [user.id],
    ),
  ]);

  return {
    user,
    balance,
    positions: positionsResult.rows.map(mapPosition),
    recent_trades: tradesResult.rows.map(mapTrade),
  };
}

export async function addFireToUser(input) {
  const amount = ensurePositiveAmount(input.amount);
  const reason = input.reason || "admin_adjustment";
  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });

  const result = await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE fire_balances
        SET balance = balance + $2,
            updated_at = now()
        WHERE user_id = $1
      `,
      [user.id, amount],
    );
    await client.query(
      `
        INSERT INTO fire_ledger (user_id, amount, reason, source)
        VALUES ($1, $2, $3, $4)
      `,
      [user.id, amount, reason, input.source || "api"],
    );
    const balanceResult = await client.query(
      "SELECT balance FROM fire_balances WHERE user_id = $1",
      [user.id],
    );
    return toNumber(balanceResult.rows[0]?.balance);
  });

  return {
    user,
    balance: result,
  };
}

export async function syncFireBalance(input) {
  const balance = ensureNonNegativeAmount(input.amount ?? input.balance);
  const reason = input.reason || "admin_adjustment";
  const source = input.source || "bridge_sync";
  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });

  const result = await withTransaction(async (client) => {
    const balanceResult = await client.query(
      `
        SELECT balance
        FROM fire_balances
        WHERE user_id = $1
        FOR UPDATE
      `,
      [user.id],
    );
    const previousBalance = toNumber(balanceResult.rows[0]?.balance);
    const delta = Math.round((balance - previousBalance) * 100) / 100;

    await client.query(
      `
        UPDATE fire_balances
        SET balance = $2,
            updated_at = now()
        WHERE user_id = $1
      `,
      [user.id, balance],
    );

    if (Math.abs(delta) >= 0.01) {
      await client.query(
        `
          INSERT INTO fire_ledger (user_id, amount, reason, source)
          VALUES ($1, $2, $3, $4)
        `,
        [user.id, delta, reason, source],
      );
    }

    return {
      balance,
      previous_balance: previousBalance,
      delta,
    };
  });

  return {
    user,
    ...result,
  };
}

export async function syncFireBalanceByUsername(input) {
  const username = String(input.username || "").trim().replace(/^@/, "");
  if (!username) {
    throw new Error("username_required");
  }
  const balance = ensureNonNegativeAmount(input.amount ?? input.balance);
  const reason = input.reason || "admin_adjustment";
  const source = input.source || "bridge_sync";

  return withTransaction(async (client) => {
    const userResult = await client.query(
      `
        SELECT *
        FROM users
        WHERE lower(username) = lower($1)
        ORDER BY updated_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [username],
    );
    const user = userResult.rows[0];
    if (!user) {
      throw new Error("user_not_found");
    }

    const balanceResult = await client.query(
      `
        SELECT balance
        FROM fire_balances
        WHERE user_id = $1
        FOR UPDATE
      `,
      [user.id],
    );
    const previousBalance = toNumber(balanceResult.rows[0]?.balance);
    const delta = Math.round((balance - previousBalance) * 100) / 100;

    await client.query(
      `
        UPDATE fire_balances
        SET balance = $2::numeric,
            updated_at = now()
        WHERE user_id = $1
      `,
      [user.id, balance],
    );

    if (Math.abs(delta) >= 0.01) {
      await client.query(
        `
          INSERT INTO fire_ledger (user_id, amount, reason, source)
          VALUES ($1, $2::numeric, $3, $4)
        `,
        [user.id, delta, reason, source],
      );
    }

    return {
      user: mapUser(user),
      balance,
      previous_balance: previousBalance,
      delta,
    };
  });
}

export async function resetUserMarketStateByUsername(input) {
  const username = String(input.username || "").trim().replace(/^@/, "");
  const telegramId = String(input.telegram_id || input.telegramId || "").trim();
  if (!username && !telegramId) {
    throw new Error("username_required");
  }
  const balance = ensureNonNegativeAmount(input.amount ?? input.balance);
  const reason = input.reason || "bug_bounty_reset";
  const source = input.source || "bridge_user_reset";

  return withTransaction(async (client) => {
    const userLookupParams = telegramId && username
      ? [telegramId, username]
      : [telegramId || username];
    const userLookupSql = telegramId && username
      ? `
        SELECT *
        FROM users
        WHERE telegram_id = $1::text
           OR lower(username) = lower($2::text)
        ORDER BY CASE WHEN telegram_id = $1::text THEN 0 ELSE 1 END,
                 updated_at DESC
        LIMIT 1
        FOR UPDATE
      `
      : telegramId
        ? `
          SELECT *
          FROM users
          WHERE telegram_id = $1::text
          ORDER BY updated_at DESC
          LIMIT 1
          FOR UPDATE
        `
        : `
          SELECT *
          FROM users
          WHERE lower(username) = lower($1::text)
          ORDER BY updated_at DESC
          LIMIT 1
          FOR UPDATE
        `;
    const userResult = await client.query(
      userLookupSql,
      userLookupParams,
    );
    const user = userResult.rows[0];
    if (!user) {
      throw new Error("user_not_found");
    }

    const balanceResult = await client.query(
      `
        SELECT balance
        FROM fire_balances
        WHERE user_id = $1::bigint
        FOR UPDATE
      `,
      [user.id],
    );
    const previousBalance = toNumber(balanceResult.rows[0]?.balance);
    const delta = Math.round((balance - previousBalance) * 100) / 100;

    const touchedMarketResult = await client.query(
      `
        SELECT DISTINCT market_id
        FROM (
          SELECT market_id FROM positions WHERE user_id = $1::bigint
          UNION
          SELECT market_id FROM trades WHERE user_id = $1::bigint
        ) touched
      `,
      [user.id],
    );
    const touchedMarketIds = touchedMarketResult.rows
      .map((row) => Number(row.market_id))
      .filter(Number.isSafeInteger);

    const deletedTrades = await client.query(
      `
        DELETE FROM trades
        WHERE user_id = $1::bigint
      `,
      [user.id],
    );
    const deletedPositions = await client.query(
      `
        DELETE FROM positions
        WHERE user_id = $1::bigint
      `,
      [user.id],
    );

    if (touchedMarketIds.length) {
      await client.query(
        `
          WITH rebuilt AS (
            SELECT
              market_id,
              SUM(CASE WHEN side = 'YES' AND status = 'open' THEN spent ELSE 0 END) AS yes_volume,
              SUM(CASE WHEN side = 'NO' AND status = 'open' THEN spent ELSE 0 END) AS no_volume
            FROM positions
            WHERE market_id = ANY($1::bigint[])
            GROUP BY market_id
          )
          UPDATE markets
          SET yes_volume = COALESCE(rebuilt.yes_volume, 0),
              no_volume = COALESCE(rebuilt.no_volume, 0)
          FROM rebuilt
          WHERE markets.id = rebuilt.market_id
            AND markets.status = 'open'
        `,
        [touchedMarketIds],
      );
      await client.query(
        `
          UPDATE markets
          SET yes_volume = 0,
              no_volume = 0
          WHERE id = ANY($1::bigint[])
            AND status = 'open'
            AND NOT EXISTS (
              SELECT 1
              FROM positions
              WHERE positions.market_id = markets.id
                AND positions.status = 'open'
            )
        `,
        [touchedMarketIds],
      );
    }

    await client.query(
      `
        UPDATE fire_balances
        SET balance = $2::numeric,
            updated_at = now()
        WHERE user_id = $1::bigint
      `,
      [user.id, balance],
    );

    if (Math.abs(delta) >= 0.01) {
      await client.query(
        `
          INSERT INTO fire_ledger (user_id, amount, reason, source)
          VALUES ($1::bigint, $2::numeric, $3::text, $4::text)
        `,
        [user.id, delta, reason, source],
      );
    }

    return {
      user: mapUser(user),
      balance,
      previous_balance: previousBalance,
      delta,
      deleted_positions: deletedPositions.rowCount ?? 0,
      deleted_trades: deletedTrades.rowCount ?? 0,
      touched_markets: touchedMarketIds.length,
    };
  });
}

export async function claimShareTask(input) {
  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });
  const taskKey = "share_friend";
  const dayKey = getDayKey();
  const amount = Math.round(Number(config.taskShareFire || 0));

  return withTransaction(async (client) => {
    const claimResult = await client.query(
      `
        INSERT INTO fire_task_claims (user_id, task_key, amount, day_key, source)
        VALUES ($1, $2, $3, $4, 'mini_app')
        ON CONFLICT DO NOTHING
        RETURNING *
      `,
      [user.id, taskKey, amount, dayKey],
    );

    let bonus = {
      awarded: 0,
      daily_remaining: await getDailyBonusRemaining(client, user.id),
      cap_reached: false,
    };
    if (claimResult.rows[0] && amount > 0) {
      bonus = await awardBonusWithDailyCap(
        client,
        user.id,
        amount,
        getTaskReason(taskKey),
        `task:${taskKey}:${dayKey}`,
      );
    }

    const balanceResult = await client.query(
      "SELECT balance FROM fire_balances WHERE user_id = $1",
      [user.id],
    );

    return {
      ok: true,
      user,
      task_key: taskKey,
      already_claimed: !claimResult.rows[0],
      ...bonus,
      balance: toNumber(balanceResult.rows[0]?.balance),
    };
  });
}

export async function completeVerifiedTask(input) {
  const taskKey = String(input.task_key || input.taskKey || "").trim();
  const allowedTasks = new Set(["av_channel", "av_chat", "private_chat"]);
  if (!allowedTasks.has(taskKey)) {
    throw new Error("invalid_task");
  }

  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });
  const defaultAmount = taskKey === "private_chat"
    ? config.taskPrivateChatFire
    : config.taskSubscribeFire;
  const amount = Math.round(Number(input.amount ?? defaultAmount ?? 0));
  const dayKey = "once";

  return withTransaction(async (client) => {
    const claimResult = await client.query(
      `
        INSERT INTO fire_task_claims (user_id, task_key, amount, day_key, source)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
        RETURNING *
      `,
      [user.id, taskKey, amount, dayKey, input.source || "bridge_task"],
    );

    let bonus = {
      awarded: 0,
      daily_remaining: await getDailyBonusRemaining(client, user.id),
      cap_reached: false,
    };
    if (claimResult.rows[0] && amount > 0) {
      if (taskKey === "private_chat") {
        await adjustBalance(
          client,
          user.id,
          amount,
          getTaskReason(taskKey),
          `task:${taskKey}`,
        );
        bonus = {
          awarded: amount,
          daily_remaining: await getDailyBonusRemaining(client, user.id),
          cap_reached: false,
        };
      } else {
        bonus = await awardBonusWithDailyCap(
          client,
          user.id,
          amount,
          getTaskReason(taskKey),
          `task:${taskKey}`,
        );
      }
    }

    const balanceResult = await client.query(
      "SELECT balance FROM fire_balances WHERE user_id = $1",
      [user.id],
    );

    return {
      ok: true,
      user,
      task_key: taskKey,
      already_claimed: !claimResult.rows[0],
      ...bonus,
      balance: toNumber(balanceResult.rows[0]?.balance),
    };
  });
}

async function claimDailyTaskForUser(client, user, taskKey) {
  const normalizedTaskKey = String(taskKey || "").trim();
  const taskAmounts = {
    daily_presence: Math.round(Number(config.taskDailyPresenceFire || 0)),
    daily_bet: Math.round(Number(config.taskDailyBetFire || 0)),
  };
  const amount = taskAmounts[normalizedTaskKey];
  if (!amount) {
    throw new Error("invalid_task");
  }

  const dayKey = getDayKey();
  const claimResult = await client.query(
    `
      INSERT INTO fire_task_claims (user_id, task_key, amount, day_key, source)
      VALUES ($1, $2, $3, $4, 'mini_app')
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [user.id, normalizedTaskKey, amount, dayKey],
  );

  let bonus = {
    awarded: 0,
    daily_remaining: await getDailyBonusRemaining(client, user.id),
    cap_reached: false,
  };
  if (claimResult.rows[0] && amount > 0) {
    bonus = await awardBonusWithDailyCap(
      client,
      user.id,
      amount,
      getTaskReason(normalizedTaskKey),
      `task:${normalizedTaskKey}:${dayKey}`,
    );
  }

  const balanceResult = await client.query(
    "SELECT balance FROM fire_balances WHERE user_id = $1",
    [user.id],
  );

  return {
    ok: true,
    user,
    task_key: normalizedTaskKey,
    already_claimed: !claimResult.rows[0],
    ...bonus,
    balance: toNumber(balanceResult.rows[0]?.balance),
  };
}

export async function claimDailyTask(input) {
  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });

  return withTransaction(async (client) => claimDailyTaskForUser(client, user, input.task_key ?? input.taskKey));
}

export async function getFireLedgerEvents(input = {}) {
  const afterId = Math.max(0, Math.floor(Number(input.after_id ?? input.afterId ?? 0) || 0));
  const limit = Math.max(1, Math.min(250, Math.floor(Number(input.limit ?? 100) || 100)));
  const result = await query(
    `
      SELECT
        ledger.id,
        users.telegram_id,
        users.username,
        users.first_name,
        ledger.amount,
        ledger.reason,
        ledger.source,
        ledger.created_at
      FROM fire_ledger ledger
      JOIN users ON users.id = ledger.user_id
      WHERE ledger.id > $1
      ORDER BY ledger.id ASC
      LIMIT $2
    `,
    [afterId, limit],
  );

  return result.rows.map(mapFireLedgerEvent);
}

export async function createBtcMarket(definition = BTC_MARKET_DEFS[0], btcInput = null) {
  const existing = await getOpenMarket(definition.symbol);
  if (existing) {
    return existing;
  }

  const btc = btcInput || await getBtcPrice();
  const startTime = new Date();
  const durationMinutes = getBtcMarketDurationMinutes(definition);
  const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

  const result = await query(
    `
      INSERT INTO markets (
        symbol,
        question,
        open_price,
        current_price,
        yes_price,
        no_price,
        yes_volume,
        no_volume,
        liquidity,
        start_time,
        end_time,
        status
      )
      VALUES ($1, $2, $3, $3, 0.5, 0.5, 0, 0, $4, $5, $6, 'open')
      RETURNING *
    `,
    [
      definition.symbol,
      questionForPrice(btc.price, definition),
      btc.price,
      config.marketLiquidity,
      startTime,
      endTime,
    ],
  );

  await query(
    `
      INSERT INTO price_ticks (symbol, price, source)
      VALUES ($1, $2, $3)
    `,
    [definition.symbol, btc.price, btc.source],
  );

  return mapMarket(result.rows[0]);
}

export async function createBtc5mMarket() {
  return createBtcMarket(BTC_MARKET_DEFS[0]);
}

export async function getOpenMarket(symbol = MARKET_SYMBOL) {
  const result = await query(
      `
        SELECT *
        FROM markets
        WHERE status = 'open'
          AND symbol = $1
        ORDER BY end_time ASC
        LIMIT 1
      `,
    [symbol],
  );

  return mapMarket(result.rows[0]);
}

export async function ensureActiveBtcMarkets() {
  await resolveExpiredMarkets();
  let btc = null;
  const markets = [];
  for (const definition of BTC_MARKET_DEFS) {
    const existing = await getOpenMarket(definition.symbol);
    if (existing) {
      markets.push(existing);
      continue;
    }
    try {
      btc = btc || await getBtcPrice();
      markets.push(await createBtcMarket(definition, btc));
    } catch (error) {
      if (error?.code === "23505") {
        const duplicateWinner = await getOpenMarket(definition.symbol);
        if (duplicateWinner) {
          markets.push(duplicateWinner);
          continue;
        }
      }
      throw error;
    }
  }

  return markets;
}

export async function ensureActiveMarket() {
  const markets = await ensureActiveBtcMarkets();
  return markets.find((market) => market.symbol === MARKET_SYMBOL) || markets[0] || null;
}

export async function updateLiveBtcPrice() {
  const btc = await getBtcPrice();
  await withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO price_ticks (symbol, price, source)
        VALUES ($1, $2, $3)
      `,
      [btc.symbol, btc.price, btc.source],
    );

    const markets = await client.query(
      `
        SELECT *
        FROM markets
        WHERE status = 'open'
          AND symbol = ANY($1)
      `,
      [BTC_MARKET_SYMBOLS],
    );

    for (const market of markets.rows) {
      const yesPrice = getMarketMakerYesPrice(market, btc.price);
      const noPrice = 1 - yesPrice;

      await client.query(
        `
          UPDATE markets
          SET current_price = $2,
              yes_price = $3,
              no_price = $4
          WHERE id = $1
        `,
        [market.id, btc.price, yesPrice, noPrice],
      );

      if (market.symbol !== btc.symbol) {
        await client.query(
          `
            INSERT INTO price_ticks (symbol, price, source)
            VALUES ($1, $2, $3)
          `,
          [market.symbol, btc.price, btc.source],
        );
      }
    }
  });

  return btc;
}

export async function getActiveMarket() {
  const market = await ensureActiveMarket();
  return market;
}

export async function getBtcMarkets() {
  await ensureActiveBtcMarkets();
  const result = await query(
    `
      SELECT *
      FROM markets
      WHERE status = 'open'
        AND symbol = ANY($1)
      ORDER BY array_position($1::text[], symbol)
    `,
    [BTC_MARKET_SYMBOLS],
  );

  const markets = result.rows.map(mapMarket);
  const charts = await Promise.all(markets.map((market) => getMarketChart(market, 260)));
  return markets.map((market, index) => ({
    ...market,
    chart: charts[index],
  }));
}

export async function getMarketActivity(marketId, limit = 20) {
  const result = await query(
    `
      SELECT
        trades.*,
        users.telegram_id,
        users.username,
        users.first_name
      FROM trades
      JOIN users ON users.id = trades.user_id
      WHERE trades.market_id = $1
      ORDER BY trades.created_at DESC
      LIMIT $2
    `,
    [Number(marketId), Math.max(1, Math.min(50, Number(limit) || 20))],
  );

  return result.rows.map(mapMarketActivity);
}

export async function getMarketComments(marketId, limit = 30) {
  const id = Number(marketId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("invalid_market_id");
  }

  const result = await query(
    `
      SELECT
        comments.*,
        users.telegram_id,
        users.username,
        users.first_name,
        latest_trade.action AS latest_bet_action,
        latest_trade.side AS latest_bet_side,
        latest_trade.amount AS latest_bet_amount,
        latest_trade.price AS latest_bet_price,
        latest_trade.shares AS latest_bet_shares,
        latest_trade.created_at AS latest_bet_created_at
      FROM market_comments comments
      JOIN users ON users.id = comments.user_id
      LEFT JOIN LATERAL (
        SELECT action, side, amount, price, shares, created_at
        FROM trades
        WHERE trades.user_id = comments.user_id
          AND trades.market_id = comments.market_id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest_trade ON true
      WHERE comments.market_id = $1
      ORDER BY comments.created_at DESC
      LIMIT $2
    `,
    [id, Math.max(1, Math.min(80, Number(limit) || 30))],
  );

  return result.rows.map(mapMarketComment);
}

export async function addMarketComment(input) {
  const marketId = Number(input.marketId);
  const message = String(input.message || "").trim().slice(0, 240);
  if (!Number.isSafeInteger(marketId) || marketId <= 0) {
    throw new Error("invalid_market_id");
  }
  if (!message) {
    throw new Error("comment_required");
  }

  const user = await getUserByTelegramId(input.telegram_id);
  if (!user) {
    throw new Error("user_not_found");
  }

  const result = await query(
    `
      WITH inserted AS (
        INSERT INTO market_comments (market_id, user_id, message)
        VALUES ($1, $2, $3)
        RETURNING *
      )
      SELECT
        inserted.*,
        users.telegram_id,
        users.username,
        users.first_name,
        latest_trade.action AS latest_bet_action,
        latest_trade.side AS latest_bet_side,
        latest_trade.amount AS latest_bet_amount,
        latest_trade.price AS latest_bet_price,
        latest_trade.shares AS latest_bet_shares,
        latest_trade.created_at AS latest_bet_created_at
      FROM inserted
      JOIN users ON users.id = inserted.user_id
      LEFT JOIN LATERAL (
        SELECT action, side, amount, price, shares, created_at
        FROM trades
        WHERE trades.user_id = inserted.user_id
          AND trades.market_id = inserted.market_id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest_trade ON true
    `,
    [marketId, user.id, message],
  );

  return mapMarketComment(result.rows[0]);
}

export async function getRecentActivity(limit = 30) {
  const result = await query(
    `
      SELECT
        trades.*,
        users.telegram_id,
        users.username,
        users.first_name,
        markets.symbol AS market_symbol,
        markets.question AS market_question,
        markets.status AS market_status,
        markets.winner AS market_winner,
        meta.team AS team
      FROM trades
      JOIN users ON users.id = trades.user_id
      JOIN markets ON markets.id = trades.market_id
      LEFT JOIN world_cup_market_meta meta ON meta.symbol = markets.symbol
      ORDER BY trades.created_at DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(80, Number(limit) || 30))],
  );

  return result.rows.map(mapMarketActivity);
}

export async function getMarketChart(market, limit = 240) {
  if (!market) {
    return [];
  }
  const btcDefinition = getBtcMarketDef(market.symbol);
  const chartSymbol = btcDefinition ? MARKET_SYMBOL : market.symbol;
  const lookbackMs = btcDefinition
    ? Math.min(getBtcMarketDurationMinutes(btcDefinition) * 60_000, 7 * 24 * 60 * 60 * 1_000)
    : 0;
  const since = btcDefinition
    ? new Date(Date.now() - lookbackMs)
    : market.start_time;

  const result = await query(
    `
      SELECT price, source, created_at
      FROM (
        SELECT price, source, created_at
        FROM price_ticks
        WHERE symbol = $1
          AND created_at >= $2
        ORDER BY created_at DESC
        LIMIT $3
      ) recent_ticks
      ORDER BY created_at ASC
    `,
    [chartSymbol, since, Math.max(30, Math.min(600, Number(limit) || 240))],
  );

  return result.rows.map(mapMarketChartPoint);
}

export async function syncWorldCupMarkets() {
  const feed = await getWorldCupFeedMarkets();
  const endTime = new Date("2026-07-20T00:00:00Z");
  const now = new Date();

  await withTransaction(async (client) => {
    for (const feedMarket of feed.markets) {
      const symbol = worldCupSymbol(feedMarket);
      const yesPrice = clamp(feedMarket.yesPrice, MIN_PRICE, MAX_PRICE);
      const noPrice = 1 - yesPrice;
      const question = `Will ${feedMarket.team} win the 2026 FIFA World Cup?`;
      const liquidity = Math.max(1_000, toNumber(feedMarket.volume) || config.marketLiquidity);
      const existingResult = await client.query(
        `
          SELECT *
          FROM markets
          WHERE symbol = $1
            AND status = 'open'
          ORDER BY id DESC
          LIMIT 1
          FOR UPDATE
        `,
        [symbol],
      );
      const existingMarket = existingResult.rows[0];
      const marketResult = existingMarket
        ? await client.query(
          `
            UPDATE markets
            SET question = $2,
                current_price = $3,
                yes_price = (yes_price * 0.70 + $3::numeric * 0.30),
                no_price = 1 - (yes_price * 0.70 + $3::numeric * 0.30),
                liquidity = $4,
                end_time = $5
            WHERE id = $1
            RETURNING *
          `,
          [existingMarket.id, question, yesPrice, liquidity, endTime],
        )
        : await client.query(
          `
            INSERT INTO markets (
              symbol,
              question,
              open_price,
              current_price,
              yes_price,
              no_price,
              yes_volume,
              no_volume,
              liquidity,
              start_time,
              end_time,
              status
            )
            VALUES ($1, $2, $3, $3, $3, $4, 0, 0, $5, $6, $7, 'open')
            RETURNING *
          `,
          [symbol, question, yesPrice, noPrice, liquidity, now, endTime],
        );

      await client.query(
        `
          INSERT INTO world_cup_market_meta (
            symbol,
            polymarket_id,
            team,
            slug,
            icon,
            volume,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, now())
          ON CONFLICT (symbol) DO UPDATE SET
            polymarket_id = EXCLUDED.polymarket_id,
            team = EXCLUDED.team,
            slug = EXCLUDED.slug,
            icon = EXCLUDED.icon,
            volume = EXCLUDED.volume,
            updated_at = now()
        `,
        [
          symbol,
          feedMarket.polymarketId,
          feedMarket.team,
          feedMarket.slug || "",
          feedMarket.icon || "",
          toNumber(feedMarket.volume),
        ],
      );

      const market = marketResult.rows[0];
      await client.query(
        `
          INSERT INTO price_ticks (symbol, price, source)
          VALUES ($1, $2, $3)
        `,
        [symbol, toNumber(market.yes_price), feed.source],
      );
    }
  });

  return feed.source;
}

export async function getWorldCupMarkets() {
  const source = await syncWorldCupMarkets();
  const result = await query(
    `
      SELECT
        markets.*,
        meta.team,
        meta.polymarket_id,
        meta.slug,
        meta.icon,
        meta.volume AS meta_volume
      FROM markets
      JOIN world_cup_market_meta meta ON meta.symbol = markets.symbol
      WHERE markets.status = 'open'
        AND markets.symbol LIKE $1
      ORDER BY markets.yes_price DESC, meta.volume DESC
    `,
    [`${WORLD_CUP_SYMBOL_PREFIX}%`],
  );
  const symbols = result.rows.map((row) => row.symbol);
  let chartBySymbol = new Map();
  if (symbols.length) {
    const chartResult = await query(
      `
        SELECT symbol, price, created_at
        FROM (
          SELECT
            symbol,
            price,
            created_at,
            ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY created_at DESC) AS rn
          FROM price_ticks
          WHERE symbol = ANY($1)
        ) ranked_ticks
        WHERE rn <= 120
        ORDER BY symbol ASC, created_at ASC
      `,
      [symbols],
    );
    chartBySymbol = chartResult.rows.reduce((map, row) => {
      const current = map.get(row.symbol) || [];
      current.push({
        price: toNumber(row.price),
        created_at: row.created_at,
      });
      map.set(row.symbol, current);
      return map;
    }, new Map());
  }

  return {
    source,
    markets: result.rows.map((row) => mapWorldCupMarket({
      ...row,
      chart: chartBySymbol.get(row.symbol) || [],
    })),
  };
}

async function awardReferralBetBonus(client, buyerUser, marketId) {
  const bonusAmount = Math.round(Number(config.referralBetBonusFire || 0));
  const inviterTelegramId = String(buyerUser.referred_by_telegram_id || "").trim();
  if (bonusAmount <= 0 || !inviterTelegramId || inviterTelegramId === String(buyerUser.telegram_id)) {
    return null;
  }

  const inviterResult = await client.query(
    `
      SELECT *
      FROM users
      WHERE telegram_id = $1
      LIMIT 1
    `,
    [inviterTelegramId],
  );
  const inviter = inviterResult.rows[0];
  if (!inviter) {
    return null;
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  const bonusResult = await client.query(
    `
      INSERT INTO fire_referral_bonuses (
        inviter_user_id,
        referred_user_id,
        market_id,
        amount,
        day_key
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [inviter.id, buyerUser.id, marketId, bonusAmount, dayKey],
  );
  if (!bonusResult.rows[0]) {
    return null;
  }

  const bonus = await awardBonusWithDailyCap(
    client,
    inviter.id,
    bonusAmount,
    "referral_bet_bonus",
    `referral:${buyerUser.telegram_id}:market:${marketId}`,
  );

  return {
    inviter: mapUser(inviter),
    referred: mapUser(buyerUser),
    amount: bonus.awarded,
    daily_remaining: bonus.daily_remaining,
    cap_reached: bonus.cap_reached,
    day_key: dayKey,
  };
}

export async function buyOutcome(input) {
  const marketId = Number(input.marketId);
  const side = String(input.side || "").toUpperCase();
  const amount = ensurePositiveAmount(input.amount);

  if (!Number.isSafeInteger(marketId) || marketId <= 0) {
    throw new Error("invalid_market_id");
  }

  if (!["YES", "NO"].includes(side)) {
    throw new Error("invalid_side");
  }

  const user = await getUserByTelegramId(input.telegram_id);
  if (!user) {
    throw new Error("user_not_found");
  }

  return withTransaction(async (client) => {
    const marketResult = await client.query(
      `
        SELECT *
        FROM markets
        WHERE id = $1
        FOR UPDATE
      `,
      [marketId],
    );
    const market = marketResult.rows[0];
    if (!market || market.status !== "open") {
      throw new Error("market_not_open");
    }

    if (new Date(market.end_time).getTime() <= Date.now()) {
      throw new Error("market_closed");
    }

    const balanceResult = await client.query(
      `
        SELECT balance
        FROM fire_balances
        WHERE user_id = $1
        FOR UPDATE
      `,
      [user.id],
    );
    const balance = toNumber(balanceResult.rows[0]?.balance);
    if (amount > balance) {
      throw new Error("insufficient_fire");
    }

    const marketMinPrice = getMarketMinOutcomePrice(market);
    const quote = getBuyExecutionQuote(market, side, amount);
    if (quote.executionPrice < marketMinPrice || quote.executionPrice > 1 - marketMinPrice) {
      throw new Error("invalid_market_price");
    }

    const fee = 0;
    const netAmount = Math.max(0, amount - fee);
    const shares = netAmount / quote.executionPrice;
    const nextYesPrice = quote.nextYesPrice;
    const nextNoPrice = quote.nextNoPrice;

    await client.query(
      `
        UPDATE fire_balances
        SET balance = balance - $2::numeric,
            updated_at = now()
        WHERE user_id = $1
      `,
      [user.id, amount],
    );

    await client.query(
      `
        INSERT INTO fire_ledger (user_id, amount, reason, source)
        VALUES ($1, $2::numeric, $3, $4)
      `,
      [user.id, -amount, side === "YES" ? "buy_yes" : "buy_no", `market:${marketId}`],
    );

    await client.query(
      `
        UPDATE markets
        SET yes_price = $2::numeric,
            no_price = $3::numeric,
            yes_volume = yes_volume + $4::numeric,
            no_volume = no_volume + $5::numeric
        WHERE id = $1
      `,
      [
        marketId,
        nextYesPrice,
        nextNoPrice,
        side === "YES" ? netAmount : 0,
        side === "NO" ? netAmount : 0,
      ],
    );

    const positionResult = await client.query(
      `
        INSERT INTO positions (
          user_id,
          market_id,
          side,
          shares,
          spent,
          avg_price,
          status,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'open', now())
        ON CONFLICT (user_id, market_id, side) DO UPDATE SET
          shares = positions.shares + EXCLUDED.shares,
          spent = positions.spent + EXCLUDED.spent,
          avg_price = (positions.spent + EXCLUDED.spent) / NULLIF(positions.shares + EXCLUDED.shares, 0),
          status = 'open',
          updated_at = now()
        RETURNING *
      `,
      [user.id, marketId, side, shares, amount, quote.executionPrice],
    );

    const tradeResult = await client.query(
      `
        INSERT INTO trades (user_id, market_id, action, side, amount, fee, price, shares)
        VALUES ($1, $2, 'BUY', $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric)
        RETURNING *
      `,
      [user.id, marketId, side, amount, fee, quote.executionPrice, shares],
    );

    const referralBonus = await awardReferralBetBonus(client, user, marketId);
    const dailyBetBonus = await claimDailyTaskForUser(client, user, "daily_bet");

    const finalBalanceResult = await client.query(
      `
        SELECT balance
        FROM fire_balances
        WHERE user_id = $1
      `,
      [user.id],
    );

    return {
      ok: true,
      balance: toNumber(finalBalanceResult.rows[0]?.balance),
      position: mapPosition(positionResult.rows[0]),
      trade: mapTrade(tradeResult.rows[0]),
      referral_bonus: referralBonus,
      daily_bet_bonus: dailyBetBonus,
      market: mapMarket({
        ...market,
        yes_price: nextYesPrice,
        no_price: nextNoPrice,
        yes_volume: toNumber(market.yes_volume) + (side === "YES" ? netAmount : 0),
        no_volume: toNumber(market.no_volume) + (side === "NO" ? netAmount : 0),
      }),
    };
  });
}

export async function sellOutcome(input) {
  const requestedMarketId = Number(input.marketId);
  const requestedSide = String(input.side || "").toUpperCase();
  const positionId = input.positionId === undefined || input.positionId === null
    ? null
    : Number(input.positionId);

  if (positionId === null && (!Number.isSafeInteger(requestedMarketId) || requestedMarketId <= 0)) {
    throw new Error("invalid_market_id");
  }

  if (positionId !== null && (!Number.isSafeInteger(positionId) || positionId <= 0)) {
    throw new Error("invalid_position_id");
  }

  if (positionId === null && !["YES", "NO"].includes(requestedSide)) {
    throw new Error("invalid_side");
  }

  const user = await getUserByTelegramId(input.telegram_id);
  if (!user) {
    throw new Error("user_not_found");
  }

  return withTransaction(async (client) => {
    let positionResult;
    if (positionId !== null) {
      positionResult = await client.query(
        `
          SELECT *
          FROM positions
          WHERE id = $1::bigint
            AND user_id = $2::bigint
            AND status = 'open'
          FOR UPDATE
        `,
        [positionId, user.id],
      );
    } else {
      positionResult = await client.query(
        `
          SELECT *
          FROM positions
          WHERE user_id = $1::bigint
            AND market_id = $2::bigint
            AND side = $3::text
            AND status = 'open'
          FOR UPDATE
        `,
        [user.id, requestedMarketId, requestedSide],
      );
    }
    if (!positionResult.rows[0] && positionId === null) {
      positionResult = await client.query(
        `
          SELECT p.*
          FROM positions p
          JOIN markets m ON m.id = p.market_id
          WHERE p.user_id = $1::bigint
            AND p.side = $2::text
            AND p.status = 'open'
            AND m.status = 'open'
            AND m.end_time > now()
          ORDER BY p.updated_at DESC, p.id DESC
          LIMIT 1
          FOR UPDATE OF p
        `,
        [user.id, requestedSide],
      );
    }
    if (
      !positionResult.rows[0]
      && positionId !== null
      && Number.isSafeInteger(requestedMarketId)
      && requestedMarketId > 0
      && ["YES", "NO"].includes(requestedSide)
    ) {
      positionResult = await client.query(
        `
          SELECT *
          FROM positions
          WHERE user_id = $1::bigint
            AND market_id = $2::bigint
            AND side = $3::text
            AND status = 'open'
          FOR UPDATE
        `,
        [user.id, requestedMarketId, requestedSide],
      );
    }
    const position = positionResult.rows[0];
    if (!position) {
      throw new Error("position_not_open");
    }

    const side = String(position.side || requestedSide).toUpperCase();
    const marketId = Number(position.market_id);
    const marketResult = await client.query(
      `
        SELECT *
        FROM markets
        WHERE id = $1::bigint
        FOR UPDATE
      `,
      [marketId],
    );
    const market = marketResult.rows[0];
    if (!market || market.status !== "open") {
      throw new Error("market_not_open");
    }

    if (new Date(market.end_time).getTime() <= Date.now()) {
      throw new Error("market_closed");
    }

    const positionShares = toNumber(position.shares);
    if (positionShares <= 0) {
      throw new Error("position_not_open");
    }

    const requestedShares = input.shares === undefined || input.shares === null
      ? positionShares
      : Number(input.shares);
    if (!Number.isFinite(requestedShares) || requestedShares <= 0) {
      throw new Error("invalid_sell_shares");
    }
    if (requestedShares > positionShares + 0.00000001) {
      throw new Error("insufficient_shares");
    }

    const sharesToSell = Math.min(positionShares, requestedShares);
    const marketMinPrice = getMarketMinOutcomePrice(market);
    const quote = getSellExecutionQuote(market, side, sharesToSell);
    if (quote.executionPrice < marketMinPrice || quote.executionPrice > 1 - marketMinPrice) {
      throw new Error("invalid_market_price");
    }

    const gross = quote.gross;
    const soldRatio = sharesToSell / positionShares;
    const spentSold = toNumber(position.spent) * soldRatio;
    const fee = calculateProfitFee(gross - spentSold);
    const proceeds = Math.max(0, Math.round((gross - fee) * 100) / 100);
    const realizedPnl = proceeds - spentSold;
    const remainingShares = Math.max(0, positionShares - sharesToSell);
    const remainingSpent = Math.max(0, toNumber(position.spent) - spentSold);
    const isFullExit = remainingShares <= 0.00000001;

    await client.query(
      `
        UPDATE fire_balances
        SET balance = balance + $2::numeric,
            updated_at = now()
        WHERE user_id = $1::bigint
      `,
      [user.id, proceeds],
    );

    await client.query(
      `
        INSERT INTO fire_ledger (user_id, amount, reason, source)
        VALUES ($1::bigint, $2::numeric, $3::text, $4::text)
      `,
      [user.id, proceeds, side === "YES" ? "sell_yes" : "sell_no", `market:${marketId}`],
    );

    const tradeResult = await client.query(
      `
        INSERT INTO trades (user_id, market_id, action, side, amount, fee, price, shares)
        VALUES ($1::bigint, $2::bigint, 'SELL', $3::text, $4::numeric, $5::numeric, $6::numeric, $7::numeric)
        RETURNING *
      `,
      [user.id, marketId, side, proceeds, fee, quote.executionPrice, sharesToSell],
    );

    const positionUpdateResult = await client.query(
      `
        WITH sale_input AS (
          SELECT
            $1::bigint AS position_id,
            $2::numeric AS remaining_shares,
            $3::numeric AS remaining_spent,
            $4::numeric AS proceeds,
            $5::numeric AS realized_pnl,
            $6::text AS next_status
        )
        UPDATE positions
        SET shares = sale_input.remaining_shares,
            spent = sale_input.remaining_spent,
            avg_price = CASE
              WHEN sale_input.remaining_shares > 0
                THEN sale_input.remaining_spent / sale_input.remaining_shares
              ELSE 0::numeric
            END,
            payout = positions.payout + sale_input.proceeds,
            pnl = positions.pnl + sale_input.realized_pnl,
            status = sale_input.next_status,
            updated_at = now()
        FROM sale_input
        WHERE positions.id = sale_input.position_id
        RETURNING positions.*
      `,
      [
        position.id,
        isFullExit ? 0 : remainingShares,
        isFullExit ? 0 : remainingSpent,
        proceeds,
        realizedPnl,
        isFullExit ? "sold" : "open",
      ],
    );

    const nextYesPrice = quote.nextYesPrice;
    const nextNoPrice = quote.nextNoPrice;

    await client.query(
      `
        UPDATE markets
        SET yes_price = $2::numeric,
            no_price = $3::numeric,
            yes_volume = $4::numeric,
            no_volume = $5::numeric
        WHERE id = $1::bigint
      `,
      [
        marketId,
        nextYesPrice,
        nextNoPrice,
        quote.nextYesVolume,
        quote.nextNoVolume,
      ],
    );

    const finalBalanceResult = await client.query(
      `
        SELECT balance
        FROM fire_balances
        WHERE user_id = $1
      `,
      [user.id],
    );

    return {
      ok: true,
      balance: toNumber(finalBalanceResult.rows[0]?.balance),
      position: mapPosition(positionUpdateResult.rows[0]),
      trade: mapTrade(tradeResult.rows[0]),
      market: mapMarket({
        ...market,
        yes_price: nextYesPrice,
        no_price: nextNoPrice,
        yes_volume: quote.nextYesVolume,
        no_volume: quote.nextNoVolume,
      }),
      sale: {
        side,
        price: quote.executionPrice,
        shares: sharesToSell,
        gross,
        fee,
        proceeds,
        pnl: realizedPnl,
      },
    };
  });
}

async function refundMarket(client, market, message) {
  const positions = await client.query(
    `
      SELECT *
      FROM positions
      WHERE market_id = $1
        AND status = 'open'
      FOR UPDATE
    `,
    [market.id],
  );

  for (const position of positions.rows) {
    const refund = toNumber(position.spent);
    if (refund > 0) {
      await client.query(
        `
          UPDATE fire_balances
          SET balance = balance + $2,
              updated_at = now()
          WHERE user_id = $1
        `,
        [position.user_id, refund],
      );
      await client.query(
        `
          INSERT INTO fire_ledger (user_id, amount, reason, source)
          VALUES ($1, $2, 'market_refund', $3)
        `,
        [position.user_id, refund, `market:${market.id}:${message}`],
      );
    }
  }

  await client.query(
    `
      UPDATE positions
      SET payout = spent,
          pnl = 0,
          status = 'refunded',
          updated_at = now()
      WHERE market_id = $1
        AND status = 'open'
    `,
    [market.id],
  );
}

export async function resolveExpiredMarkets() {
  const expiredResult = await query(
    `
      SELECT *
      FROM markets
      WHERE status = 'open'
        AND symbol = ANY($1)
        AND end_time <= now()
      ORDER BY end_time ASC
      LIMIT 30
    `,
    [BTC_MARKET_SYMBOLS],
  );

  for (const market of expiredResult.rows) {
    let closePrice = null;
    try {
      closePrice = (await getBtcPrice()).price;
    } catch (error) {
      if (!(error instanceof PriceUnavailableError)) {
        throw error;
      }
    }

    await withTransaction(async (client) => {
      const currentResult = await client.query(
        `
          SELECT *
          FROM markets
          WHERE id = $1
          FOR UPDATE
        `,
        [market.id],
      );
      const currentMarket = currentResult.rows[0];
      if (!currentMarket || currentMarket.status !== "open") {
        return;
      }

      if (!closePrice) {
        await refundMarket(client, currentMarket, "price_error");
        await client.query(
          `
            UPDATE markets
            SET status = 'price_error',
                resolved_at = now()
            WHERE id = $1
          `,
          [currentMarket.id],
        );
        return;
      }

      const winner = closePrice > toNumber(currentMarket.open_price) ? "YES" : "NO";
      await client.query(
        `
          UPDATE markets
          SET close_price = $2,
              current_price = $2,
              status = 'resolved',
              winner = $3,
              resolved_at = now()
          WHERE id = $1
        `,
        [currentMarket.id, closePrice, winner],
      );

      const positions = await client.query(
        `
          SELECT *
          FROM positions
          WHERE market_id = $1
            AND status = 'open'
          FOR UPDATE
        `,
        [currentMarket.id],
      );

      for (const position of positions.rows) {
        const shares = toNumber(position.shares);
        const spent = toNumber(position.spent);
        const grossPayout = position.side === winner ? shares : 0;
        const fee = calculateProfitFee(grossPayout - spent);
        const payout = Math.max(0, Math.round((grossPayout - fee) * 100) / 100);
        const pnl = payout - spent;

        await client.query(
          `
            UPDATE positions
            SET payout = $2,
                pnl = $3,
                status = 'resolved',
                updated_at = now()
            WHERE id = $1
          `,
          [position.id, payout, pnl],
        );

        if (payout > 0) {
          await client.query(
            `
              UPDATE fire_balances
              SET balance = balance + $2,
                  updated_at = now()
              WHERE user_id = $1
            `,
            [position.user_id, payout],
          );
          await client.query(
            `
              INSERT INTO fire_ledger (user_id, amount, reason, source)
              VALUES ($1, $2, 'market_payout', $3)
            `,
            [position.user_id, payout, `market:${currentMarket.id}`],
          );
        }
      }
    });
  }

  let btcForCreation = null;
  for (const definition of BTC_MARKET_DEFS) {
    const currentOpen = await getOpenMarket(definition.symbol);
    if (currentOpen) {
      continue;
    }
    try {
      btcForCreation = btcForCreation || await getBtcPrice();
      await createBtcMarket(definition, btcForCreation);
    } catch (error) {
      if (!(error instanceof PriceUnavailableError) && error?.code !== "23505") {
        throw error;
      }
    }
  }
}

export async function getRecentMarkets(limit = 10) {
  const result = await query(
    `
      SELECT *
      FROM markets
      WHERE status IN ('resolved', 'price_error')
      ORDER BY COALESCE(resolved_at, end_time) DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(25, Number(limit) || 10))],
  );

  return result.rows.map(mapMarket);
}

export async function getLeaderboard(limit = 30) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const result = await query(
    `
      WITH trade_stats AS (
        SELECT
          user_id,
          COUNT(*) FILTER (WHERE action = 'BUY') AS bet_count
        FROM trades
        GROUP BY user_id
      ),
      position_stats AS (
        SELECT
          user_id,
          COUNT(*) FILTER (WHERE status <> 'open') AS settled_count,
          COUNT(*) FILTER (WHERE status <> 'open' AND pnl > 0) AS win_count
        FROM positions
        GROUP BY user_id
      )
      SELECT
        users.telegram_id,
        users.username,
        users.first_name,
        fire_balances.balance,
        COALESCE(trade_stats.bet_count, 0) AS bet_count,
        COALESCE(position_stats.settled_count, 0) AS settled_count,
        COALESCE(position_stats.win_count, 0) AS win_count
      FROM users
      JOIN fire_balances ON fire_balances.user_id = users.id
      LEFT JOIN trade_stats ON trade_stats.user_id = users.id
      LEFT JOIN position_stats ON position_stats.user_id = users.id
      ORDER BY fire_balances.balance DESC, COALESCE(trade_stats.bet_count, 0) DESC, users.updated_at DESC
      LIMIT $1
    `,
    [safeLimit],
  );

  return result.rows.map((row) => {
    const settledCount = Number(row.settled_count || 0);
    const winCount = Number(row.win_count || 0);
    return {
      telegram_id: row.telegram_id,
      username: row.username,
      first_name: row.first_name,
      balance: toNumber(row.balance),
      bet_count: Number(row.bet_count || 0),
      settled_count: settledCount,
      win_count: winCount,
      win_rate_pct: settledCount > 0 ? Math.round((winCount / settledCount) * 1000) / 10 : 0,
    };
  });
}

export async function getUserPositions(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    return [];
  }

  const result = await query(
    `
      SELECT p.*, m.question, m.winner
      FROM positions p
      JOIN markets m ON m.id = p.market_id
      WHERE p.user_id = $1
      ORDER BY p.updated_at DESC
    `,
    [user.id],
  );

  return result.rows.map(mapPosition);
}
