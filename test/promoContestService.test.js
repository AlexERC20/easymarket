import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPromoLevelProgress,
  creditPromoPointsFromTelegramStars,
  PROMO_STAR_HOLD_LEVELS,
  PROMO_USDT_DEPOSIT_LEVELS,
  PROMO_USDT_HOLD_LEVELS,
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

function createPurchaseClient({ existing = null, existingPayment = null, racedPayment = null } = {}) {
  const calls = [];
  let insertAttempted = false;
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("WHERE telegram_payment_charge_id")) {
        const payment = existingPayment || (insertAttempted ? racedPayment : null);
        return { rows: payment ? [payment] : [] };
      }
      if (sql.includes("SELECT * FROM promo_point_purchases")) {
        return { rows: existing ? [existing] : [] };
      }
      if (sql.includes("INSERT INTO promo_point_purchases")) {
        insertAttempted = true;
        if (racedPayment) {
          return { rows: [] };
        }
        return {
          rows: [{
            id: 7,
            user_id: 11,
            day_key: params[1],
            stars_spent: String(params[2]),
            points: params[3],
            payment_source: "telegram_stars",
            telegram_payment_charge_id: params[4],
          }],
        };
      }
      return { rows: [] };
    },
  };
  return { client, calls };
}

test("Telegram Stars purchase credits points without touching the internal balance", async () => {
  const { client, calls } = createPurchaseClient();
  const result = await creditPromoPointsFromTelegramStars(client, {
    userId: 11,
    stars: 1_000,
    dayKey: "2026-08-17",
    telegramPaymentChargeId: "charge-1",
  });

  assert.equal(result.points, 1_500);
  assert.equal(result.payment_source, "telegram_stars");
  assert.equal(result.telegram_payment_charge_id, "charge-1");
  assert.equal(calls.some((call) => call.sql.includes("UPDATE fire_balances")), false);
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO fire_ledger")), false);
});

test("a second point purchase on the same day is rejected", async () => {
  const { client } = createPurchaseClient({
    existing: { id: 7, day_key: "2026-08-17", stars_spent: "250", points: 25 },
  });
  await assert.rejects(
    creditPromoPointsFromTelegramStars(client, {
      userId: 11,
      stars: 500,
      dayKey: "2026-08-17",
      telegramPaymentChargeId: "charge-2",
    }),
    /promo_points_already_purchased_today/,
  );
});

test("replaying the same Telegram charge is idempotent", async () => {
  const existingPayment = {
    id: 7,
    user_id: 11,
    day_key: "2026-08-17",
    stars_spent: "500",
    points: 600,
    payment_source: "telegram_stars",
    telegram_payment_charge_id: "charge-existing",
  };
  const { client, calls } = createPurchaseClient({ existingPayment });
  const result = await creditPromoPointsFromTelegramStars(client, {
    userId: 11,
    stars: 500,
    dayKey: "2026-08-17",
    telegramPaymentChargeId: "charge-existing",
  });

  assert.equal(result.already_credited, true);
  assert.equal(result.points, 600);
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO promo_point_purchases")), false);
});

test("a concurrent replay is recovered without aborting the transaction", async () => {
  const racedPayment = {
    id: 8,
    user_id: 11,
    day_key: "2026-08-17",
    stars_spent: "250",
    points: 250,
    payment_source: "telegram_stars",
    telegram_payment_charge_id: "charge-race",
  };
  const { client, calls } = createPurchaseClient({ racedPayment });
  const result = await creditPromoPointsFromTelegramStars(client, {
    userId: 11,
    stars: 250,
    dayKey: "2026-08-17",
    telegramPaymentChargeId: "charge-race",
  });

  assert.equal(result.already_credited, true);
  assert.equal(result.points, 250);
  assert.equal(calls.some((call) => call.sql.includes("ON CONFLICT DO NOTHING")), true);
});
