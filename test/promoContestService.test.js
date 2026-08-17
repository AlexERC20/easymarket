import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPromoLevelProgress,
  PROMO_STAR_HOLD_LEVELS,
  PROMO_USDT_DEPOSIT_LEVELS,
  PROMO_USDT_HOLD_LEVELS,
  purchasePromoPointsWithStars,
} from "../src/services/promoContestService.js";

test("real USDT hold levels heavily outweigh star hold levels", () => {
  const usdt = buildPromoLevelProgress(1_000, PROMO_USDT_HOLD_LEVELS, "daily_hold_usdt", "2026-08-17");
  const stars = buildPromoLevelProgress(100_000, PROMO_STAR_HOLD_LEVELS, "daily_hold_stars", "2026-08-17");

  assert.equal(usdt.achieved_level, 4);
  assert.equal(usdt.points, 220);
  assert.equal(usdt.target, 2_500);
  assert.equal(stars.achieved_level, 6);
  assert.equal(stars.points, 25);
  assert.ok(usdt.points > stars.points * 8);
});

test("deposit milestone progress exposes only reached post-launch levels", () => {
  const progress = buildPromoLevelProgress(
    20,
    PROMO_USDT_DEPOSIT_LEVELS,
    "milestone_usdt_deposits",
    "2026-08-17",
  );

  assert.equal(progress.achieved_level, 3);
  assert.equal(progress.unit, "COUNT");
  assert.equal(progress.target, 35);
  assert.equal(progress.next_points, 1_100);
  assert.deepEqual(progress.achieved_levels, [
    { level: 1, target: 5, points: 250 },
    { level: 2, target: 10, points: 400 },
    { level: 3, target: 20, points: 700 },
  ]);
});

function createPurchaseClient({ balance = 2_000, existing = null } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT balance FROM fire_balances")) {
        return { rows: [{ balance: String(balance) }] };
      }
      if (sql.includes("SELECT * FROM promo_point_purchases")) {
        return { rows: existing ? [existing] : [] };
      }
      if (sql.includes("INSERT INTO promo_point_purchases")) {
        return {
          rows: [{
            id: 7,
            user_id: 11,
            day_key: params[1],
            stars_spent: String(params[2]),
            points: params[3],
          }],
        };
      }
      return { rows: [] };
    },
  };
  return { client, calls };
}

test("point purchase atomically deducts stars and writes one ledger event", async () => {
  const { client, calls } = createPurchaseClient();
  const result = await purchasePromoPointsWithStars(client, {
    userId: 11,
    stars: 1_000,
    dayKey: "2026-08-17",
  });

  assert.equal(result.points, 150);
  assert.equal(result.balance, 1_000);
  const balanceUpdate = calls.find((call) => call.sql.includes("UPDATE fire_balances"));
  const ledgerInsert = calls.find((call) => call.sql.includes("INSERT INTO fire_ledger"));
  assert.deepEqual(balanceUpdate?.params, [11, 1_000]);
  assert.deepEqual(ledgerInsert?.params, [11, -1_000, "promo_points:2026-08-17"]);
});

test("a second point purchase on the same day is rejected", async () => {
  const { client } = createPurchaseClient({
    existing: { id: 7, day_key: "2026-08-17", stars_spent: "250", points: 25 },
  });
  await assert.rejects(
    purchasePromoPointsWithStars(client, {
      userId: 11,
      stars: 500,
      dayKey: "2026-08-17",
    }),
    /promo_points_already_purchased_today/,
  );
});

test("point purchase cannot overdraw the star balance", async () => {
  const { client } = createPurchaseClient({ balance: 249 });
  await assert.rejects(
    purchasePromoPointsWithStars(client, {
      userId: 11,
      stars: 250,
      dayKey: "2026-08-17",
    }),
    /insufficient_fire/,
  );
});
