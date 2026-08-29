import { randomInt } from "node:crypto";

import { query, toNumber, withTransaction } from "../db.js";
import { getUserByTelegramId, touchUserActivity, addFireToUser } from "./marketService.js";

// Fixed-prize wheel for the "you've been gone 3 days" win-back DM -
// unlike the player-funded roulette pot (rouletteService.js), this pays
// real STAR out of the house, so the table below is deliberately weighted
// for ~70% RTP against the 100-star paid-spin price: E[prize] ~= 71 STAR.
// Cool prizes are rare on purpose (jackpot ~1 in 250,000) but reachable -
// a "prize" nobody can mathematically win would just be a lie in the promo.
export const COMEBACK_WHEEL_SPIN_STARS = 100;
const COMEBACK_WHEEL_TOTAL_WEIGHT = 1_000_000;
export const COMEBACK_WHEEL_PRIZES = Object.freeze([
  { amount: 23, weight: 340_226 },
  { amount: 33, weight: 160_000 },
  { amount: 43, weight: 110_000 },
  { amount: 55, weight: 90_000 },
  { amount: 70, weight: 70_000 },
  { amount: 85, weight: 55_000 },
  { amount: 110, weight: 45_000 },
  { amount: 140, weight: 35_000 },
  { amount: 170, weight: 28_000 },
  { amount: 215, weight: 22_000 },
  { amount: 270, weight: 16_000 },
  { amount: 340, weight: 11_000 },
  { amount: 430, weight: 7_000 },
  { amount: 540, weight: 4_500 },
  { amount: 700, weight: 2_800 },
  { amount: 850, weight: 1_600 },
  { amount: 1_050, weight: 900 },
  { amount: 1_350, weight: 500 },
  { amount: 1_750, weight: 250 },
  { amount: 2_250, weight: 120 },
  { amount: 2_900, weight: 60 },
  { amount: 3_600, weight: 30 },
  { amount: 4_300, weight: 10 },
  { amount: 5_000, weight: 4 },
]);

function pickComebackWheelPrize() {
  let roll = randomInt(0, COMEBACK_WHEEL_TOTAL_WEIGHT);
  for (const tier of COMEBACK_WHEEL_PRIZES) {
    if (roll < tier.weight) {
      return tier.amount;
    }
    roll -= tier.weight;
  }
  return COMEBACK_WHEEL_PRIZES[0].amount;
}

export async function getComebackWheelStatus(telegramId) {
  const result = await query(
    "SELECT comeback_wheel_free_spin_used_at FROM users WHERE telegram_id = $1 LIMIT 1",
    [String(telegramId)],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("user_not_found");
  }
  return {
    free_spin_available: !row.comeback_wheel_free_spin_used_at,
    spin_stars_cost: COMEBACK_WHEEL_SPIN_STARS,
    prizes: COMEBACK_WHEEL_PRIZES.map((tier) => tier.amount),
  };
}

export async function spinComebackWheelFree(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    throw new Error("user_not_found");
  }

  const prizeAmount = pickComebackWheelPrize();
  const claimed = await withTransaction(async (client) => {
    const result = await client.query(
      `
        UPDATE users
        SET comeback_wheel_free_spin_used_at = now()
        WHERE id = $1
          AND comeback_wheel_free_spin_used_at IS NULL
      `,
      [user.id],
    );
    if (result.rowCount === 0) {
      return false;
    }
    await client.query(
      `
        INSERT INTO comeback_wheel_spins (user_id, is_free, stars_paid, prize_amount, shown_at)
        VALUES ($1, TRUE, 0, $2, now())
      `,
      [user.id, prizeAmount],
    );
    await touchUserActivity(user.id, client);
    return true;
  });
  if (!claimed) {
    throw new Error("free_spin_already_used");
  }

  await addFireToUser({
    telegram_id: telegramId,
    amount: prizeAmount,
    reason: "comeback_wheel_free",
    source: "api",
  });

  return { prize_amount: prizeAmount };
}

// Called by the bot once a real 100-star payment is confirmed. The prize is
// rolled and recorded here, server-side, at payout time - never trust a
// client-supplied result for something that pays real balance.
export async function spinComebackWheelPaid(input) {
  const starsAmount = Math.round(Number(input.stars_amount) || 0);
  if (starsAmount !== COMEBACK_WHEEL_SPIN_STARS) {
    throw new Error("invalid_spin_price");
  }
  const chargeId = String(input.telegram_payment_charge_id || "").trim();
  if (!chargeId) {
    throw new Error("charge_id_required");
  }
  const user = await getUserByTelegramId(input.telegram_id);
  if (!user) {
    throw new Error("user_not_found");
  }

  const existing = await query(
    "SELECT prize_amount FROM comeback_wheel_spins WHERE telegram_payment_charge_id = $1 LIMIT 1",
    [chargeId],
  );
  if (existing.rows[0]) {
    return { prize_amount: toNumber(existing.rows[0].prize_amount), already_credited: true };
  }

  const prizeAmount = pickComebackWheelPrize();
  await withTransaction(async (client) => {
    // shown_at stays NULL here on purpose - the paid result reaches the
    // frontend asynchronously (bot confirms payment, calls this, THEN the
    // Mini App polls claimLatestComebackWheelSpin), unlike the free spin
    // which returns its prize directly in the same response.
    await client.query(
      `
        INSERT INTO comeback_wheel_spins
          (user_id, is_free, stars_paid, prize_amount, telegram_payment_charge_id)
        VALUES ($1, FALSE, $2, $3, $4)
        ON CONFLICT (telegram_payment_charge_id) DO NOTHING
      `,
      [user.id, starsAmount, prizeAmount, chargeId],
    );
    await touchUserActivity(user.id, client);
  });

  await addFireToUser({
    telegram_id: input.telegram_id,
    amount: prizeAmount,
    reason: "comeback_wheel_paid",
    source: "bridge",
  });

  return { prize_amount: prizeAmount, already_credited: false };
}

// Polled by the Mini App right after Telegram reports the invoice as paid -
// the actual prize isn't known client-side until the bot confirms payment
// and calls spinComebackWheelPaid above, so this is the pickup point.
export async function claimLatestComebackWheelSpin(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    return null;
  }
  const result = await query(
    `
      UPDATE comeback_wheel_spins
      SET shown_at = now()
      WHERE id = (
        SELECT id
        FROM comeback_wheel_spins
        WHERE user_id = $1
          AND is_free = FALSE
          AND shown_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING prize_amount
    `,
    [user.id],
  );
  const row = result.rows[0];
  return row ? { prize_amount: toNumber(row.prize_amount) } : null;
}

const COMEBACK_WHEEL_REMINDER_MIN_DAYS = 3;
const COMEBACK_WHEEL_REMINDER_MAX_DAYS = 30;
const COMEBACK_WHEEL_REMINDER_COOLDOWN_DAYS = 14;

// Anyone idle 3-30 days who hasn't been pinged for this in the last two
// weeks. Upper bound keeps it from resurrecting years-old abandoned
// accounts forever; the cooldown (not "once ever") lets someone who comes
// back, then goes quiet again, get a second nudge later.
export async function getComebackWheelReminderTargets(input = {}) {
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 50));
  const result = await query(
    `
      SELECT users.telegram_id, users.username, users.first_name
      FROM users
      WHERE users.last_meaningful_activity_at < now() - interval '1 day' * $1::int
        AND users.last_meaningful_activity_at >= now() - interval '1 day' * $2::int
        AND NOT EXISTS (
          SELECT 1 FROM comeback_wheel_reminders reminders
          WHERE reminders.user_id = users.id
            AND reminders.sent_at > now() - interval '1 day' * $3::int
        )
      ORDER BY users.last_meaningful_activity_at ASC
      LIMIT $4
    `,
    [
      COMEBACK_WHEEL_REMINDER_MIN_DAYS,
      COMEBACK_WHEEL_REMINDER_MAX_DAYS,
      COMEBACK_WHEEL_REMINDER_COOLDOWN_DAYS,
      limit,
    ],
  );
  return result.rows.map((row) => ({
    telegram_id: row.telegram_id,
    username: row.username,
    first_name: row.first_name,
  }));
}

export async function markComebackWheelRemindersSent(telegramIds = []) {
  const ids = [...new Set(telegramIds.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!ids.length) {
    return { marked: 0 };
  }
  const result = await query(
    `
      INSERT INTO comeback_wheel_reminders (user_id, sent_at)
      SELECT id, now()
      FROM users
      WHERE telegram_id = ANY($1::text[])
      ON CONFLICT (user_id) DO UPDATE SET sent_at = now()
    `,
    [ids],
  );
  return { marked: result.rowCount || 0 };
}
