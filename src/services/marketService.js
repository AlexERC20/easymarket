import { clamp, config } from "../config.js";
import { query, toNumber, withTransaction } from "../db.js";
import { getBtcPrice, PriceUnavailableError } from "./priceService.js";

const MARKET_SYMBOL = "BTCUSDT";
const MIN_PRICE = 0.001;
const MAX_PRICE = 0.999;
const DEFAULT_FEE_BPS = 200;

function mapMarket(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    symbol: row.symbol,
    question: row.question,
    open_price: toNumber(row.open_price),
    close_price: row.close_price === null ? null : toNumber(row.close_price),
    current_price: row.current_price === null ? null : toNumber(row.current_price),
    yes_price: toNumber(row.yes_price),
    no_price: toNumber(row.no_price),
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

function questionForPrice(price) {
  return `BTC будет выше ${Math.round(price).toLocaleString("ru-RU")} через 5 минут?`;
}

function getMarketProgress(market) {
  const start = new Date(market.start_time).getTime();
  const end = new Date(market.end_time).getTime();
  const duration = Math.max(1, end - start);
  return clamp((Date.now() - start) / duration, 0, 1);
}

function getMarketMakerYesPrice(market, currentPrice, options = {}) {
  const openPrice = toNumber(market.open_price);
  const previousYesPrice = clamp(toNumber(market.yes_price, 0.5), MIN_PRICE, MAX_PRICE);
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

  const target = clamp(priceProbability * 0.86 + orderProbability * 0.14, MIN_PRICE, MAX_PRICE);
  const adaptiveInertia = options.fast
    ? 0.24
    : Math.max(0.08, 0.48 - progress * 0.4);
  const panicInertia = Math.abs(target - previousYesPrice) > 0.18 ? 0.08 : adaptiveInertia;
  const tradeShift = Number(options.tradeShift || 0);

  return clamp(previousYesPrice * panicInertia + target * (1 - panicInertia) + tradeShift, MIN_PRICE, MAX_PRICE);
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
          m.yes_price,
          m.no_price
        FROM positions p
        JOIN markets m ON m.id = p.market_id
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

export async function createBtc5mMarket() {
  const btc = await getBtcPrice();
  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + config.marketDurationMinutes * 60_000);

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
      MARKET_SYMBOL,
      questionForPrice(btc.price),
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
    [btc.symbol, btc.price, btc.source],
  );

  return mapMarket(result.rows[0]);
}

export async function getOpenMarket() {
  const result = await query(
    `
      SELECT *
      FROM markets
      WHERE status = 'open'
      ORDER BY end_time ASC
      LIMIT 1
    `,
  );

  return mapMarket(result.rows[0]);
}

export async function ensureActiveMarket() {
  await resolveExpiredMarkets();
  const existing = await getOpenMarket();
  if (existing) {
    return existing;
  }

  return createBtc5mMarket();
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
      `,
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
    }
  });

  return btc;
}

export async function getActiveMarket() {
  const market = await ensureActiveMarket();
  return market;
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

export async function getMarketChart(market, limit = 240) {
  if (!market) {
    return [];
  }

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
    [market.symbol, market.start_time, Math.max(30, Math.min(600, Number(limit) || 240))],
  );

  return result.rows.map(mapMarketChartPoint);
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

  await client.query(
    `
      UPDATE fire_balances
      SET balance = balance + $2,
          updated_at = now()
      WHERE user_id = $1
    `,
    [inviter.id, bonusAmount],
  );
  await client.query(
    `
      INSERT INTO fire_ledger (user_id, amount, reason, source)
      VALUES ($1, $2, 'referral_bet_bonus', $3)
    `,
    [inviter.id, bonusAmount, `referral:${buyerUser.telegram_id}:market:${marketId}`],
  );

  return {
    inviter: mapUser(inviter),
    referred: mapUser(buyerUser),
    amount: bonusAmount,
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

    const price = side === "YES" ? toNumber(market.yes_price) : toNumber(market.no_price);
    if (price < MIN_PRICE || price > MAX_PRICE) {
      throw new Error("invalid_market_price");
    }

    const fee = calculateFee(amount);
    const netAmount = Math.max(0, amount - fee);
    const shares = netAmount / price;
    const liquidity = toNumber(market.liquidity, config.marketLiquidity);
    const tradeShift = (side === "YES" ? 1 : -1) * (amount / liquidity) * 0.85;
    const repricedMarket = {
      ...market,
      yes_volume: toNumber(market.yes_volume) + (side === "YES" ? netAmount : 0),
      no_volume: toNumber(market.no_volume) + (side === "NO" ? netAmount : 0),
    };
    const nextYesPrice = getMarketMakerYesPrice(
      repricedMarket,
      toNumber(market.current_price, toNumber(market.open_price)),
      { fast: true, tradeShift },
    );
    const nextNoPrice = 1 - nextYesPrice;

    await client.query(
      `
        UPDATE fire_balances
        SET balance = balance - $2,
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
      [user.id, -amount, side === "YES" ? "buy_yes" : "buy_no", `market:${marketId}`],
    );

    await client.query(
      `
        UPDATE markets
        SET yes_price = $2,
            no_price = $3,
            yes_volume = yes_volume + $4,
            no_volume = no_volume + $5
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
      [user.id, marketId, side, shares, amount, amount / shares],
    );

    const tradeResult = await client.query(
      `
        INSERT INTO trades (user_id, market_id, action, side, amount, fee, price, shares)
        VALUES ($1, $2, 'BUY', $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [user.id, marketId, side, amount, fee, price, shares],
    );

    const referralBonus = await awardReferralBetBonus(client, user, marketId);

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

  if (!Number.isSafeInteger(requestedMarketId) || requestedMarketId <= 0) {
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
          WHERE id = $1
            AND user_id = $2
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
          WHERE user_id = $1
            AND market_id = $2
            AND side = $3
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
          WHERE p.user_id = $1
            AND p.side = $2
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

    const price = side === "YES" ? toNumber(market.yes_price) : toNumber(market.no_price);
    if (price < MIN_PRICE || price > MAX_PRICE) {
      throw new Error("invalid_market_price");
    }

    const sharesToSell = Math.min(positionShares, requestedShares);
    const gross = Math.round(sharesToSell * price * 100) / 100;
    const fee = calculateFee(gross);
    const proceeds = Math.max(0, Math.round((gross - fee) * 100) / 100);
    const soldRatio = sharesToSell / positionShares;
    const spentSold = toNumber(position.spent) * soldRatio;
    const realizedPnl = proceeds - spentSold;
    const remainingShares = Math.max(0, positionShares - sharesToSell);
    const remainingSpent = Math.max(0, toNumber(position.spent) - spentSold);
    const isFullExit = remainingShares <= 0.00000001;

    await client.query(
      `
        UPDATE fire_balances
        SET balance = balance + $2,
            updated_at = now()
        WHERE user_id = $1
      `,
      [user.id, proceeds],
    );

    await client.query(
      `
        INSERT INTO fire_ledger (user_id, amount, reason, source)
        VALUES ($1, $2, $3, $4)
      `,
      [user.id, proceeds, side === "YES" ? "sell_yes" : "sell_no", `market:${marketId}`],
    );

    const positionUpdateResult = await client.query(
      `
        UPDATE positions
        SET shares = $2,
            spent = $3,
            avg_price = CASE WHEN $2 > 0 THEN $3 / $2 ELSE 0 END,
            payout = payout + $4,
            pnl = pnl + $5,
            status = $6,
            updated_at = now()
        WHERE id = $1
        RETURNING *
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

    const liquidity = toNumber(market.liquidity, config.marketLiquidity);
    const tradeShift = (side === "YES" ? -1 : 1) * (proceeds / liquidity) * 0.75;
    const repricedMarket = {
      ...market,
      yes_volume: side === "YES"
        ? Math.max(0, toNumber(market.yes_volume) - gross)
        : toNumber(market.yes_volume),
      no_volume: side === "NO"
        ? Math.max(0, toNumber(market.no_volume) - gross)
        : toNumber(market.no_volume),
    };
    const nextYesPrice = getMarketMakerYesPrice(
      repricedMarket,
      toNumber(market.current_price, toNumber(market.open_price)),
      { fast: true, tradeShift },
    );
    const nextNoPrice = 1 - nextYesPrice;

    await client.query(
      `
        UPDATE markets
        SET yes_price = $2,
            no_price = $3,
            yes_volume = $4,
            no_volume = $5
        WHERE id = $1
      `,
      [
        marketId,
        nextYesPrice,
        nextNoPrice,
        repricedMarket.yes_volume,
        repricedMarket.no_volume,
      ],
    );

    const tradeResult = await client.query(
      `
        INSERT INTO trades (user_id, market_id, action, side, amount, fee, price, shares)
        VALUES ($1, $2, 'SELL', $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [user.id, marketId, side, proceeds, fee, price, sharesToSell],
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
        yes_volume: repricedMarket.yes_volume,
        no_volume: repricedMarket.no_volume,
      }),
      sale: {
        side,
        price,
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
        AND end_time <= now()
      ORDER BY end_time ASC
      LIMIT 5
    `,
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
        const payout = position.side === winner ? shares : 0;
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

  const currentOpen = await getOpenMarket();
  if (!currentOpen) {
    try {
      await createBtc5mMarket();
    } catch (error) {
      if (!(error instanceof PriceUnavailableError)) {
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
