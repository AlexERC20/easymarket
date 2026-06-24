import { config } from "../config.js";
import { query } from "../db.js";

function rowCount(result) {
  return Number(result?.rowCount || 0);
}

async function deleteOldPriceTicks() {
  const result = await query(
    `
      DELETE FROM price_ticks
      WHERE created_at < now() - ($1::int * interval '1 hour')
    `,
    [Math.round(config.cleanupPriceTicksHours)],
  );
  return rowCount(result);
}

async function deleteOldMarketComments() {
  const result = await query(
    `
      DELETE FROM market_comments
      WHERE created_at < now() - ($1::int * interval '1 day')
    `,
    [Math.round(config.cleanupMarketCommentsDays)],
  );
  return rowCount(result);
}

async function deleteOldDepositEvents() {
  const result = await query(
    `
      DELETE FROM usdt_deposit_events
      WHERE created_at < now() - ($1::int * interval '1 day')
    `,
    [Math.round(config.cleanupDepositEventsDays)],
  );
  return rowCount(result);
}

async function deleteOldExpiredDepositIntents() {
  const result = await query(
    `
      DELETE FROM usdt_deposit_intents
      WHERE status IN ('expired', 'cancelled', 'canceled')
        AND updated_at < now() - ($1::int * interval '1 day')
    `,
    [Math.round(config.cleanupExpiredDepositIntentsDays)],
  );
  return rowCount(result);
}

async function deleteOldTaskClaims() {
  const result = await query(
    `
      DELETE FROM fire_task_claims
      WHERE created_at < now() - ($1::int * interval '1 day')
    `,
    [Math.round(config.cleanupTaskClaimsDays)],
  );
  return rowCount(result);
}

async function deleteEmptyOldMarkets() {
  const result = await query(
    `
      DELETE FROM markets m
      WHERE m.status IN ('resolved', 'price_error', 'superseded')
        AND COALESCE(m.resolved_at, m.end_time, m.created_at) < now() - ($1::int * interval '1 day')
        AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.market_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM trades t WHERE t.market_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM market_comments c WHERE c.market_id = m.id)
    `,
    [Math.round(config.cleanupEmptyMarketsDays)],
  );
  return rowCount(result);
}

async function vacuumTouchedTables(summary) {
  if (!config.databaseCleanupVacuum) {
    return [];
  }

  const tables = [
    ["price_ticks", summary.price_ticks],
    ["market_comments", summary.market_comments],
    ["usdt_deposit_events", summary.usdt_deposit_events],
    ["usdt_deposit_intents", summary.usdt_deposit_intents],
    ["fire_task_claims", summary.fire_task_claims],
    ["markets", summary.empty_markets],
  ]
    .filter(([, count]) => count > 0)
    .map(([table]) => table);

  for (const table of tables) {
    await query(`VACUUM (ANALYZE) ${table}`);
  }

  return tables;
}

export async function runDatabaseCleanup() {
  const startedAt = Date.now();
  const summary = {
    price_ticks: await deleteOldPriceTicks(),
    market_comments: await deleteOldMarketComments(),
    usdt_deposit_events: await deleteOldDepositEvents(),
    usdt_deposit_intents: await deleteOldExpiredDepositIntents(),
    fire_task_claims: await deleteOldTaskClaims(),
    empty_markets: await deleteEmptyOldMarkets(),
    vacuumed_tables: [],
    elapsed_ms: 0,
  };

  summary.vacuumed_tables = await vacuumTouchedTables(summary);
  summary.elapsed_ms = Date.now() - startedAt;

  return summary;
}
