import { clamp, config } from "../config.js";
import { query, toNumber, withTransaction } from "../db.js";
import { getBtcPrice, PriceUnavailableError } from "./priceService.js";

const MARKET_SYMBOL = "BTCUSDT";
const MIN_PRICE = 0.05;
const MAX_PRICE = 0.95;

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
  };
}

function mapTrade(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    market_id: Number(row.market_id),
    side: row.side,
    amount: toNumber(row.amount),
    fee: toNumber(row.fee),
    price: toNumber(row.price),
    shares: toNumber(row.shares),
    created_at: row.created_at,
  };
}

function questionForPrice(price) {
  return `BTC будет выше ${Math.round(price).toLocaleString("ru-RU")} через 5 минут?`;
}

function ensurePositiveAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("amount_must_be_positive");
  }

  return Math.round(value * 100) / 100;
}

export async function upsertUser(input) {
  const telegramId = String(input.telegram_id ?? "").trim();
  if (!telegramId) {
    throw new Error("telegram_id_required");
  }

  return withTransaction(async (client) => {
    const userResult = await client.query(
      `
        INSERT INTO users (telegram_id, username, first_name, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (telegram_id) DO UPDATE SET
          username = EXCLUDED.username,
          first_name = EXCLUDED.first_name,
          updated_at = now()
        RETURNING *
      `,
      [
        telegramId,
        input.username ? String(input.username).replace(/^@/, "") : null,
        input.first_name ? String(input.first_name) : null,
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
        SELECT p.*, m.question, m.winner
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
      const openPrice = toNumber(market.open_price);
      const currentYesPrice = toNumber(market.yes_price, 0.5);
      const movement = openPrice > 0 ? (btc.price - openPrice) / openPrice : 0;
      const btcSignal = clamp(0.5 + movement * 20, MIN_PRICE, MAX_PRICE);
      const yesPrice = clamp(currentYesPrice * 0.92 + btcSignal * 0.08, MIN_PRICE, MAX_PRICE);
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

    const fee = Math.round(amount * (config.marketFeeBps / 10_000) * 100) / 100;
    const netAmount = Math.max(0, amount - fee);
    const shares = netAmount / price;
    const impact = amount / toNumber(market.liquidity, config.marketLiquidity);
    const nextYesPrice = clamp(
      toNumber(market.yes_price) + (side === "YES" ? impact : -impact),
      MIN_PRICE,
      MAX_PRICE,
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
        INSERT INTO trades (user_id, market_id, side, amount, fee, price, shares)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [user.id, marketId, side, amount, fee, price, shares],
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
      position: mapPosition(positionResult.rows[0]),
      trade: mapTrade(tradeResult.rows[0]),
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
