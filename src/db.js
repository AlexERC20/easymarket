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
  `);
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
