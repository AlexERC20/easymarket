import { config } from "../config.js";
import { query } from "../db.js";

function rowCount(result) {
  return Number(result?.rowCount || 0);
}

async function deleteInBatches(sql, params = []) {
  const batchSize = Math.round(config.databaseCleanupBatchSize);
  const maxBatches = Math.round(config.databaseCleanupMaxBatches);
  let total = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await query(sql, [...params, batchSize]);
    const deleted = rowCount(result);
    total += deleted;
    if (deleted < batchSize) {
      break;
    }
  }

  return total;
}

async function deleteOldPriceTicks() {
  return deleteInBatches(
    `
      WITH doomed AS (
        SELECT id
        FROM price_ticks
        WHERE created_at < now() - ($1::int * interval '1 hour')
        ORDER BY id ASC
        LIMIT $2
      )
      DELETE FROM price_ticks ticks
      USING doomed
      WHERE ticks.id = doomed.id
    `,
    [Math.round(config.cleanupPriceTicksHours)],
  );
}

async function truncatePriceTicksIfTooLarge() {
  const maxMb = Number(config.cleanupPriceTicksTruncateAboveMb || 0);
  if (!Number.isFinite(maxMb) || maxMb <= 0) {
    return {
      truncated: false,
      bytes_before: 0,
      threshold_mb: maxMb,
    };
  }

  const sizeResult = await query("SELECT pg_total_relation_size('price_ticks') AS bytes");
  const bytesBefore = Number(sizeResult.rows?.[0]?.bytes || 0);
  const thresholdBytes = maxMb * 1024 * 1024;
  if (bytesBefore < thresholdBytes) {
    return {
      truncated: false,
      bytes_before: bytesBefore,
      threshold_mb: maxMb,
    };
  }

  await query("TRUNCATE TABLE price_ticks RESTART IDENTITY");
  return {
    truncated: true,
    bytes_before: bytesBefore,
    threshold_mb: maxMb,
  };
}

async function deleteOldMarketComments() {
  return deleteInBatches(
    `
      WITH doomed AS (
        SELECT id
        FROM market_comments
        WHERE created_at < now() - ($1::int * interval '1 day')
        ORDER BY id ASC
        LIMIT $2
      )
      DELETE FROM market_comments comments
      USING doomed
      WHERE comments.id = doomed.id
    `,
    [Math.round(config.cleanupMarketCommentsDays)],
  );
}

async function deleteOldDepositEvents() {
  return deleteInBatches(
    `
      WITH doomed AS (
        SELECT id
        FROM usdt_deposit_events
        WHERE created_at < now() - ($1::int * interval '1 day')
        ORDER BY id ASC
        LIMIT $2
      )
      DELETE FROM usdt_deposit_events events
      USING doomed
      WHERE events.id = doomed.id
    `,
    [Math.round(config.cleanupDepositEventsDays)],
  );
}

async function deleteOldExpiredDepositIntents() {
  return deleteInBatches(
    `
      WITH doomed AS (
        SELECT id
        FROM usdt_deposit_intents
        WHERE status IN ('expired', 'cancelled', 'canceled')
          AND updated_at < now() - ($1::int * interval '1 day')
        ORDER BY id ASC
        LIMIT $2
      )
      DELETE FROM usdt_deposit_intents intents
      USING doomed
      WHERE intents.id = doomed.id
    `,
    [Math.round(config.cleanupExpiredDepositIntentsDays)],
  );
}

async function deleteOldTaskClaims() {
  return deleteInBatches(
    `
      WITH doomed AS (
        SELECT id
        FROM fire_task_claims
        WHERE created_at < now() - ($1::int * interval '1 day')
        ORDER BY id ASC
        LIMIT $2
      )
      DELETE FROM fire_task_claims claims
      USING doomed
      WHERE claims.id = doomed.id
    `,
    [Math.round(config.cleanupTaskClaimsDays)],
  );
}

async function deleteEmptyOldMarkets() {
  return deleteInBatches(
    `
      WITH doomed AS (
        SELECT m.id
        FROM markets m
        WHERE m.status IN ('resolved', 'price_error', 'superseded')
          AND COALESCE(m.resolved_at, m.end_time, m.created_at) < now() - ($1::int * interval '1 day')
          AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.market_id = m.id)
          AND NOT EXISTS (SELECT 1 FROM trades t WHERE t.market_id = m.id)
          AND NOT EXISTS (SELECT 1 FROM market_comments c WHERE c.market_id = m.id)
        ORDER BY m.id ASC
        LIMIT $2
      )
      DELETE FROM markets markets_to_delete
      USING doomed
      WHERE markets_to_delete.id = doomed.id
    `,
    [Math.round(config.cleanupEmptyMarketsDays)],
  );
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
  const priceTickEmergency = await truncatePriceTicksIfTooLarge();
  const summary = {
    price_ticks: priceTickEmergency.truncated ? 0 : await deleteOldPriceTicks(),
    price_ticks_emergency: priceTickEmergency,
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
