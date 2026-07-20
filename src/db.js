import pg from "pg";

const { Pool } = pg;

let pool = null;

export function buildDatabasePool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  const sslMode = process.env.PGSSLMODE?.toLowerCase();
  const ssl = sslMode === "require"
    ? { rejectUnauthorized: false }
    : undefined;

  return new Pool({
    connectionString,
    ssl,
    max: 6,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function getPool() {
  if (!pool) {
    pool = buildDatabasePool();
  }

  return pool;
}

export function getSafeDatabaseErrorMessage(error) {
  if (!process.env.DATABASE_URL) {
    return "DATABASE_URL is not configured.";
  }

  if (error instanceof Error && error.message) {
    return "PostgreSQL connection failed.";
  }

  return "Database status check failed.";
}

export async function query(sql, params = []) {
  const activePool = getPool();
  if (!activePool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return activePool.query(sql, params);
}

export async function withTransaction(callback) {
  const activePool = getPool();
  if (!activePool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await activePool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runMigrations() {
  await query(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      referred_by_telegram_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS fire_balances (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance NUMERIC(20, 8) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS fire_ledger (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(20, 8) NOT NULL,
      reason TEXT NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usdt_balances (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance NUMERIC(20, 8) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usdt_ledger (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(20, 8) NOT NULL,
      reason TEXT NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usdt_bonus_balances (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance NUMERIC(20, 8) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usdt_bonus_ledger (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(20, 8) NOT NULL,
      reason TEXT NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usdt_bonus_claims (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_key TEXT NOT NULL,
      amount NUMERIC(20, 8) NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, task_key)
    );

    CREATE TABLE IF NOT EXISTS usdt_referral_bonuses (
      id BIGSERIAL PRIMARY KEY,
      inviter_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referred_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      market_id BIGINT,
      amount NUMERIC(20, 8) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(referred_user_id)
    );

    CREATE TABLE IF NOT EXISTS project_economy_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      profit_fee_bps INTEGER NOT NULL DEFAULT 700,
      referral_profit_share_bps INTEGER NOT NULL DEFAULT 100,
      clan_profit_share_bps INTEGER NOT NULL DEFAULT 100,
      updated_by_telegram_id TEXT,
      updated_by_username TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    INSERT INTO project_economy_settings (
      id,
      profit_fee_bps,
      referral_profit_share_bps,
      clan_profit_share_bps
    )
    VALUES (1, 700, 100, 100)
    ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS usdt_loss_refund_offers (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position_id BIGINT REFERENCES positions(id) ON DELETE CASCADE,
      market_id BIGINT REFERENCES markets(id) ON DELETE SET NULL,
      offer_type TEXT NOT NULL,
      amount NUMERIC(20, 8) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      referred_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      day_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      claimed_at TIMESTAMPTZ,
      UNIQUE(user_id, position_id, offer_type)
    );

    CREATE INDEX IF NOT EXISTS idx_usdt_loss_refund_offers_user_status
      ON usdt_loss_refund_offers(user_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS usdt_deposit_intents (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      network TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_amount NUMERIC(20, 8) NOT NULL,
      deposit_amount NUMERIC(20, 8) NOT NULL,
      credited_amount NUMERIC(20, 8),
      to_address TEXT NOT NULL,
      from_address TEXT,
      tx_hash TEXT,
      log_index INTEGER,
      block_number BIGINT,
      confirmations INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      credited_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_usdt_deposit_intents_user_created
      ON usdt_deposit_intents(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_usdt_deposit_intents_status_network
      ON usdt_deposit_intents(status, network, expires_at);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_usdt_deposit_intents_pending_amount
      ON usdt_deposit_intents(network, deposit_amount)
      WHERE status = 'pending';

    CREATE TABLE IF NOT EXISTS usdt_deposit_events (
      id BIGSERIAL PRIMARY KEY,
      network TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      block_number BIGINT NOT NULL,
      from_address TEXT NOT NULL,
      to_address TEXT NOT NULL,
      amount NUMERIC(20, 8) NOT NULL,
      matched_intent_id BIGINT REFERENCES usdt_deposit_intents(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'unmatched',
      chain_timestamp TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(network, tx_hash, log_index)
    );

    CREATE INDEX IF NOT EXISTS idx_usdt_deposit_events_status_created
      ON usdt_deposit_events(status, created_at DESC);


    CREATE TABLE IF NOT EXISTS usdt_deposit_scanner_state (
      network TEXT PRIMARY KEY,
      last_scanned_block BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usdt_withdrawal_requests (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      amount NUMERIC(20, 8) NOT NULL,
      network TEXT NOT NULL,
      to_address TEXT NOT NULL,
      tx_hash TEXT,
      admin_token TEXT UNIQUE NOT NULL,
      admin_telegram_id TEXT,
      admin_username TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      confirmed_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_usdt_withdrawal_requests_user_created
      ON usdt_withdrawal_requests(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_usdt_withdrawal_requests_status_created
      ON usdt_withdrawal_requests(status, created_at DESC);

    INSERT INTO usdt_balances (user_id, balance, updated_at)
    SELECT id, 0, now()
    FROM users
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO usdt_bonus_balances (user_id, balance, updated_at)
    SELECT id, 0, now()
    FROM users
    ON CONFLICT (user_id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS markets (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      question TEXT NOT NULL,
      open_price NUMERIC(20, 8) NOT NULL,
      close_price NUMERIC(20, 8),
      current_price NUMERIC(20, 8),
      yes_price NUMERIC(10, 8) NOT NULL DEFAULT 0.5,
      no_price NUMERIC(10, 8) NOT NULL DEFAULT 0.5,
      yes_volume NUMERIC(20, 8) NOT NULL DEFAULT 0,
      no_volume NUMERIC(20, 8) NOT NULL DEFAULT 0,
      liquidity NUMERIC(20, 8) NOT NULL DEFAULT 10000,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      winner TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_markets_status_end_time
      ON markets(status, end_time);

    CREATE INDEX IF NOT EXISTS idx_markets_symbol_status
      ON markets(symbol, status);

    WITH ranked_open_markets AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY end_time ASC, id ASC) AS rn
      FROM markets
      WHERE status = 'open'
    )
    UPDATE markets
    SET status = 'superseded',
        resolved_at = now()
    FROM ranked_open_markets
    WHERE markets.id = ranked_open_markets.id
      AND ranked_open_markets.rn > 1;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_markets_one_open_per_symbol
      ON markets(symbol)
      WHERE status = 'open';

    CREATE TABLE IF NOT EXISTS world_cup_market_meta (
      symbol TEXT PRIMARY KEY,
      polymarket_id TEXT,
      team TEXT NOT NULL,
      slug TEXT,
      icon TEXT,
      volume NUMERIC(20, 8) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS top_market_meta (
      symbol TEXT PRIMARY KEY,
      polymarket_id TEXT,
      slug TEXT,
      title TEXT NOT NULL,
      icon TEXT,
      volume NUMERIC(20, 8) NOT NULL DEFAULT 0,
      liquidity NUMERIC(20, 8) NOT NULL DEFAULT 0,
      top_rank INTEGER,
      last_seen_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE top_market_meta
      ADD COLUMN IF NOT EXISTS feed_group TEXT NOT NULL DEFAULT 'TOP',
      ADD COLUMN IF NOT EXISTS event_id TEXT,
      ADD COLUMN IF NOT EXISTS event_slug TEXT,
      ADD COLUMN IF NOT EXISTS event_title TEXT,
      ADD COLUMN IF NOT EXISTS sport TEXT,
      ADD COLUMN IF NOT EXISTS yes_label TEXT NOT NULL DEFAULT 'Yes',
      ADD COLUMN IF NOT EXISTS no_label TEXT NOT NULL DEFAULT 'No',
      ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS score TEXT,
      ADD COLUMN IF NOT EXISTS period TEXT,
      ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_top_market_meta_rank
      ON top_market_meta(top_rank);

    CREATE INDEX IF NOT EXISTS idx_top_market_meta_feed_group_rank
      ON top_market_meta(feed_group, top_rank);

    ALTER TABLE top_market_meta
      DROP CONSTRAINT IF EXISTS top_market_meta_polymarket_id_key;

    CREATE INDEX IF NOT EXISTS idx_top_market_meta_polymarket_id
      ON top_market_meta(polymarket_id);

    CREATE TABLE IF NOT EXISTS fire_referral_bonuses (
      id BIGSERIAL PRIMARY KEY,
      inviter_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referred_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      market_id BIGINT REFERENCES markets(id) ON DELETE SET NULL,
      amount NUMERIC(20, 8) NOT NULL,
      day_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(referred_user_id),
      UNIQUE(inviter_user_id, day_key)
    );

    ALTER TABLE fire_referral_bonuses
      DROP CONSTRAINT IF EXISTS fire_referral_bonuses_inviter_user_id_day_key_key;

    CREATE TABLE IF NOT EXISTS fire_task_claims (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_key TEXT NOT NULL,
      amount NUMERIC(20, 8) NOT NULL,
      day_key TEXT NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, task_key, day_key)
    );

    CREATE TABLE IF NOT EXISTS clans (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      channel_url TEXT,
      icon_key TEXT NOT NULL DEFAULT 'bull',
      kind TEXT NOT NULL DEFAULT 'custom',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE clans
      ADD COLUMN IF NOT EXISTS owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS channel_url TEXT,
      ADD COLUMN IF NOT EXISTS icon_key TEXT NOT NULL DEFAULT 'bull',
      ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'custom',
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

    CREATE UNIQUE INDEX IF NOT EXISTS idx_clans_slug_unique
      ON clans(slug);

    CREATE TABLE IF NOT EXISTS clan_members (
      clan_id BIGINT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      contribution_score NUMERIC(20, 8) NOT NULL DEFAULT 0,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id)
    );

    ALTER TABLE clan_members
      ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member',
      ADD COLUMN IF NOT EXISTS contribution_score NUMERIC(20, 8) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ NOT NULL DEFAULT now();

    CREATE INDEX IF NOT EXISTS idx_clan_members_clan
      ON clan_members(clan_id);

    CREATE TABLE IF NOT EXISTS clan_score_events (
      id BIGSERIAL PRIMARY KEY,
      clan_id BIGINT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      market_id BIGINT REFERENCES markets(id) ON DELETE SET NULL,
      points NUMERIC(20, 8) NOT NULL,
      reason TEXT NOT NULL,
      currency TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE clan_score_events
      ADD COLUMN IF NOT EXISTS currency TEXT;

    CREATE INDEX IF NOT EXISTS idx_clan_score_events_clan_created
      ON clan_score_events(clan_id, created_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_clan_score_events_once_per_market_reason
      ON clan_score_events(user_id, market_id, reason)
      WHERE market_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS positions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      market_id BIGINT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
      side TEXT NOT NULL,
      shares NUMERIC(20, 8) NOT NULL DEFAULT 0,
      spent NUMERIC(20, 8) NOT NULL DEFAULT 0,
      avg_price NUMERIC(10, 8) NOT NULL DEFAULT 0,
      payout NUMERIC(20, 8) NOT NULL DEFAULT 0,
      pnl NUMERIC(20, 8) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, market_id, side)
    );

    ALTER TABLE positions
      DROP CONSTRAINT IF EXISTS positions_user_id_market_id_side_key;

    CREATE INDEX IF NOT EXISTS idx_positions_user_status
      ON positions(user_id, status);

    CREATE TABLE IF NOT EXISTS trades (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      market_id BIGINT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
      action TEXT NOT NULL DEFAULT 'BUY',
      side TEXT NOT NULL,
      amount NUMERIC(20, 8) NOT NULL,
      fee NUMERIC(20, 8) NOT NULL DEFAULT 0,
      price NUMERIC(10, 8) NOT NULL,
      shares NUMERIC(20, 8) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_trades_user_created
      ON trades(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_trades_market_created
      ON trades(market_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_trades_user_market_created
      ON trades(user_id, market_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS profit_fee_distributions (
      id BIGSERIAL PRIMARY KEY,
      event_key TEXT UNIQUE NOT NULL,
      position_id BIGINT REFERENCES positions(id) ON DELETE SET NULL,
      trade_id BIGINT REFERENCES trades(id) ON DELETE SET NULL,
      market_id BIGINT REFERENCES markets(id) ON DELETE SET NULL,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      currency TEXT NOT NULL,
      gross_profit NUMERIC(20, 8) NOT NULL DEFAULT 0,
      total_fee NUMERIC(20, 8) NOT NULL DEFAULT 0,
      project_fee NUMERIC(20, 8) NOT NULL DEFAULT 0,
      referral_fee NUMERIC(20, 8) NOT NULL DEFAULT 0,
      clan_fee NUMERIC(20, 8) NOT NULL DEFAULT 0,
      referrer_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      clan_id BIGINT REFERENCES clans(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_profit_fee_distributions_market_created
      ON profit_fee_distributions(market_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_profit_fee_distributions_referrer_currency
      ON profit_fee_distributions(currency, referrer_user_id)
      WHERE referral_fee > 0 AND referrer_user_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS clan_reward_fund_ledger (
      id BIGSERIAL PRIMARY KEY,
      clan_id BIGINT REFERENCES clans(id) ON DELETE SET NULL,
      market_id BIGINT REFERENCES markets(id) ON DELETE SET NULL,
      position_id BIGINT REFERENCES positions(id) ON DELETE SET NULL,
      trade_id BIGINT REFERENCES trades(id) ON DELETE SET NULL,
      currency TEXT NOT NULL,
      amount NUMERIC(20, 8) NOT NULL,
      month_key TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_clan_reward_fund_ledger_month_clan
      ON clan_reward_fund_ledger(month_key, clan_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS clan_reward_payouts (
      id BIGSERIAL PRIMARY KEY,
      month_key TEXT NOT NULL,
      clan_id BIGINT REFERENCES clans(id) ON DELETE SET NULL,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      currency TEXT NOT NULL,
      amount NUMERIC(20, 8) NOT NULL,
      contribution_score NUMERIC(20, 8) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(month_key, clan_id, user_id, currency)
    );

    CREATE INDEX IF NOT EXISTS idx_clan_reward_payouts_user_created
      ON clan_reward_payouts(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS limit_orders (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      market_id BIGINT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
      position_id BIGINT REFERENCES positions(id) ON DELETE SET NULL,
      side TEXT NOT NULL,
      order_side TEXT NOT NULL DEFAULT 'BUY',
      currency TEXT NOT NULL DEFAULT 'STAR',
      limit_price NUMERIC(10, 8) NOT NULL,
      shares NUMERIC(20, 8) NOT NULL,
      remaining_shares NUMERIC(20, 8) NOT NULL,
      reserved_amount NUMERIC(20, 8) NOT NULL,
      remaining_reserved NUMERIC(20, 8) NOT NULL,
      bonus_reserved NUMERIC(20, 8) NOT NULL DEFAULT 0,
      reserved_spent NUMERIC(20, 8) NOT NULL DEFAULT 0,
      remaining_spent NUMERIC(20, 8) NOT NULL DEFAULT 0,
      reserved_bonus_spent NUMERIC(20, 8) NOT NULL DEFAULT 0,
      remaining_bonus_spent NUMERIC(20, 8) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      filled_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_limit_orders_market_status
      ON limit_orders(market_id, status, currency, side, limit_price DESC);

    CREATE INDEX IF NOT EXISTS idx_limit_orders_user_status
      ON limit_orders(user_id, status, created_at DESC);

    ALTER TABLE limit_orders
      ADD COLUMN IF NOT EXISTS position_id BIGINT REFERENCES positions(id) ON DELETE SET NULL;

    ALTER TABLE limit_orders
      ADD COLUMN IF NOT EXISTS reserved_spent NUMERIC(20, 8) NOT NULL DEFAULT 0;

    ALTER TABLE limit_orders
      ADD COLUMN IF NOT EXISTS remaining_spent NUMERIC(20, 8) NOT NULL DEFAULT 0;

    ALTER TABLE limit_orders
      ADD COLUMN IF NOT EXISTS reserved_bonus_spent NUMERIC(20, 8) NOT NULL DEFAULT 0;

    ALTER TABLE limit_orders
      ADD COLUMN IF NOT EXISTS remaining_bonus_spent NUMERIC(20, 8) NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS market_comments (
      id BIGSERIAL PRIMARY KEY,
      market_id BIGINT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_market_comments_market_created
      ON market_comments(market_id, created_at DESC);

    -- Стрик входа «Заряд молнии»: дни подряд + бесплатная заморозка раз в неделю.
    CREATE TABLE IF NOT EXISTS user_streaks (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      current_streak INT NOT NULL DEFAULT 0,
      best_streak INT NOT NULL DEFAULT 0,
      last_day_key TEXT,
      freeze_week_key TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Клиентские события для дейликов (кормление рыбок, просмотры рынков, сторис).
    CREATE TABLE IF NOT EXISTS user_task_events (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day_key TEXT NOT NULL,
      event_key TEXT NOT NULL,
      count INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, day_key, event_key)
    );

    -- Счастливый раунд x2: флаг на рынке, бонус начисляется при резолве.
    ALTER TABLE markets
      ADD COLUMN IF NOT EXISTS is_lucky BOOLEAN NOT NULL DEFAULT false;

    -- Счастливое ОКНО x2: прокает один раз в конце раунда на перекосе и
    -- живёт ~15 секунд; бонус получают только ставки внутри окна.
    ALTER TABLE markets
      ADD COLUMN IF NOT EXISTS lucky_until TIMESTAMPTZ;
    ALTER TABLE markets
      ADD COLUMN IF NOT EXISTS lucky_rolled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE positions
      ADD COLUMN IF NOT EXISTS lucky_spent NUMERIC(20, 8) NOT NULL DEFAULT 0;


    CREATE TABLE IF NOT EXISTS price_ticks (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      price NUMERIC(20, 8) NOT NULL,
      source TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_price_ticks_symbol_created
      ON price_ticks(symbol, created_at DESC);

    ALTER TABLE trades
      ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'BUY';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS referred_by_telegram_id TEXT;

    CREATE INDEX IF NOT EXISTS idx_users_referred_by_telegram_id
      ON users(referred_by_telegram_id)
      WHERE referred_by_telegram_id IS NOT NULL;

    ALTER TABLE positions
      ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'STAR';

    ALTER TABLE positions
      ADD COLUMN IF NOT EXISTS bonus_spent NUMERIC(20, 8) NOT NULL DEFAULT 0;

    ALTER TABLE trades
      ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'STAR';

    ALTER TABLE positions
      DROP CONSTRAINT IF EXISTS positions_user_id_market_id_side_key;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_user_market_side_currency
      ON positions(user_id, market_id, side, currency);

    CREATE INDEX IF NOT EXISTS idx_positions_user_status_currency
      ON positions(user_id, status, currency);

    CREATE INDEX IF NOT EXISTS idx_positions_market_status_currency
      ON positions(market_id, status, currency);

    CREATE INDEX IF NOT EXISTS idx_trades_currency_created
      ON trades(currency, created_at DESC);

    -- A returning account could previously accept a newer user's referral link,
    -- creating A -> B and B -> A. Keep the chronologically valid direction:
    -- the newer account may be referred by the older account, never vice versa.
    WITH reciprocal_referrals AS (
      SELECT older.id
      FROM users older
      JOIN users newer
        ON newer.telegram_id = older.referred_by_telegram_id
       AND newer.referred_by_telegram_id = older.telegram_id
      WHERE older.created_at < newer.created_at
         OR (older.created_at = newer.created_at AND older.id < newer.id)
    )
    UPDATE users
    SET referred_by_telegram_id = NULL,
        updated_at = now()
    FROM reciprocal_referrals
    WHERE users.id = reciprocal_referrals.id;

    -- Polymarket football moneyline contracts settle after regulation time only.
    -- Earlier localized titles dropped that condition, so clarify the affected
    -- Spain - Argentina contracts in every history/statistics data source.
    DO $clarify_spain_argentina_regulation$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM app_migrations
        WHERE key = 'clarify_spain_argentina_regulation_v1'
      ) THEN
        UPDATE top_market_meta
        SET title = CASE polymarket_id
              WHEN '2941974' THEN 'Испания победит в основное время 19.07.2026?'
              WHEN '2941975' THEN 'Ничья в основное время: Испания - Аргентина?'
              WHEN '2941976' THEN 'Аргентина победит в основное время 19.07.2026?'
              ELSE title
            END,
            updated_at = now()
        WHERE feed_group = 'SPORT'
          AND polymarket_id IN ('2941974', '2941975', '2941976');

        UPDATE markets AS market
        SET question = CASE meta.polymarket_id
              WHEN '2941974' THEN 'Испания победит в основное время 19.07.2026?'
              WHEN '2941975' THEN 'Ничья в основное время: Испания - Аргентина?'
              WHEN '2941976' THEN 'Аргентина победит в основное время 19.07.2026?'
              ELSE market.question
            END
        FROM top_market_meta AS meta
        WHERE meta.symbol = market.symbol
          AND meta.feed_group = 'SPORT'
          AND meta.polymarket_id IN ('2941974', '2941975', '2941976');

        UPDATE markets
        SET question = CASE question
              WHEN 'Испания победит 19.07.2026?' THEN 'Испания победит в основное время 19.07.2026?'
              WHEN 'Will Spain win on 2026-07-19?' THEN 'Испания победит в основное время 19.07.2026?'
              WHEN 'Матч Испания - Аргентина закончится вничью?' THEN 'Ничья в основное время: Испания - Аргентина?'
              WHEN 'Will Spain vs. Argentina end in a draw?' THEN 'Ничья в основное время: Испания - Аргентина?'
              WHEN 'Аргентина победит 19.07.2026?' THEN 'Аргентина победит в основное время 19.07.2026?'
              WHEN 'Will Argentina win on 2026-07-19?' THEN 'Аргентина победит в основное время 19.07.2026?'
              ELSE question
            END
        WHERE symbol LIKE 'SPORT:%'
          AND question IN (
            'Испания победит 19.07.2026?',
            'Will Spain win on 2026-07-19?',
            'Матч Испания - Аргентина закончится вничью?',
            'Will Spain vs. Argentina end in a draw?',
            'Аргентина победит 19.07.2026?',
            'Will Argentina win on 2026-07-19?'
          );

        INSERT INTO app_migrations (key)
        VALUES ('clarify_spain_argentina_regulation_v1');
      END IF;
    END
    $clarify_spain_argentina_regulation$;

    -- The Spain YES sports contract was presented without its regulation-time
    -- condition. Return only the two affected $5 stakes to bonus USDT while
    -- preserving the official result and historical PnL.
    DO $refund_spain_regulation_label$
    DECLARE
      refund_row RECORD;
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM app_migrations
        WHERE key = 'refund_spain_regulation_label_v1'
      ) THEN
        FOR refund_row IN
          SELECT
            p.user_id,
            SUM(p.spent) AS amount
          FROM positions AS p
          JOIN markets AS m ON m.id = p.market_id
          JOIN users AS u ON u.id = p.user_id
          WHERE m.symbol = 'SPORT:2941974'
            AND u.telegram_id IN ('7388665721', '411913273')
            AND p.side = 'YES'
            AND p.currency = 'USDT'
            AND p.status = 'resolved'
            AND p.payout = 0
          GROUP BY p.user_id
        LOOP
          INSERT INTO usdt_bonus_balances (user_id, balance, updated_at)
          VALUES (refund_row.user_id, refund_row.amount, now())
          ON CONFLICT (user_id) DO UPDATE SET
            balance = usdt_bonus_balances.balance + EXCLUDED.balance,
            updated_at = now();

          INSERT INTO usdt_bonus_ledger (user_id, amount, reason, source)
          VALUES (
            refund_row.user_id,
            refund_row.amount,
            'market_rule_clarification_refund',
            'market:SPORT:2941974:regulation_label'
          );
        END LOOP;

        INSERT INTO app_migrations (key)
        VALUES ('refund_spain_regulation_label_v1');
      END IF;
    END
    $refund_spain_regulation_label$;
  `);
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
