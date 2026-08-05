import crypto from "node:crypto";

import { query, withTransaction, toNumber } from "../db.js";

// Колесо на банк. Все скидываются в общий котёл, доля круга равна доле в банке,
// стрелка сверху выбирает победителя. Дом здесь ничего не разыгрывает и никогда
// не платит — он только удерживает комиссию, и она сжигается: смысл затеи в том,
// чтобы звёзд в обращении становилось меньше, а не чтобы они переезжали на счёт
// дома.

export const ROULETTE_CURRENCIES = ["STAR", "BONUS", "USDT"];

const MIN_BET = { STAR: 50, BONUS: 1, USDT: 1 };
const HOUSE_RAKE = 0.1;

// Минута на ставки, из них последние пять секунд приём уже закрыт и круг
// раскручивается. Дальше быстрый прогон и пауза, чтобы разглядеть результат.
const BET_MS = 55_000;
const LOCK_MS = 5_000;
const RESULT_PAUSE_MS = 6_000;
const MIN_PARTICIPANTS = 2;

function nowMs() {
  return Date.now();
}

function roundAmount(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function normalizeCurrency(currency) {
  const upper = String(currency || "STAR").toUpperCase();
  return ROULETTE_CURRENCIES.includes(upper) ? upper : "STAR";
}

export function getMinimumBet(currency) {
  return MIN_BET[normalizeCurrency(currency)] ?? 50;
}

// Пока играем только на звёздах. Остальные круги уже поддержаны схемой и
// расчётом, включаются переключением этого списка.
export function getEnabledCurrencies() {
  return ["STAR"];
}

function balanceTableFor(currency) {
  if (currency === "USDT") {
    return { balances: "usdt_balances", ledger: "usdt_ledger" };
  }
  if (currency === "BONUS") {
    return { balances: "usdt_bonus_balances", ledger: "usdt_bonus_ledger" };
  }
  return { balances: "fire_balances", ledger: "fire_ledger" };
}

// Из одного зерна выводим всё: и точку остановки, и число оборотов, и время
// прогона. Хеш зерна публикуется до начала ставок, само зерно — при раскрутке,
// поэтому подобрать результат задним числом нельзя, а проверить можно.
function deriveFromSeed(seed, label) {
  const digest = crypto.createHash("sha256").update(`${seed}:${label}`).digest();
  // 48 бит с запасом хватает: дальше точность double всё равно теряется.
  const value = digest.readUIntBE(0, 6);
  return value / 2 ** 48;
}

export function buildSpin(seed) {
  return {
    // Доля окружности, на которой встанет стрелка. Равномерная, а значит шанс
    // сегмента равен его дуге — то есть ровно доле игрока в банке. Ничего
    // взвешивать отдельно не нужно, честность здесь геометрическая.
    finalAngle: deriveFromSeed(seed, "angle"),
    // Множитель раскрутки: сколько полных оборотов пройдёт колесо. На исход не
    // влияет, но делает каждый прогон непохожим на предыдущий.
    turns: roundAmount(7 + deriveFromSeed(seed, "turns") * 6),
    spinSeconds: roundAmount(6.5 + deriveFromSeed(seed, "duration") * 3),
  };
}

// Сегменты складываются по игрокам: несколько ставок одного человека — это один
// сектор, иначе круг рассыпался бы на полоски и доля читалась бы неверно.
export function buildSegments(betRows) {
  const byUser = new Map();
  betRows.forEach((row) => {
    const userId = Number(row.user_id);
    const amount = roundAmount(row.amount);
    const existing = byUser.get(userId);
    if (existing) {
      existing.amount = roundAmount(existing.amount + amount);
      return;
    }
    byUser.set(userId, {
      user_id: userId,
      amount,
      username: row.username || null,
      first_name: row.first_name || null,
      photo_url: row.photo_url || null,
    });
  });

  const segments = Array.from(byUser.values());
  const pot = roundAmount(segments.reduce((sum, item) => sum + item.amount, 0));
  let cursor = 0;
  segments.forEach((segment) => {
    const share = pot > 0 ? segment.amount / pot : 0;
    segment.share = share;
    segment.start = cursor;
    cursor += share;
    segment.end = cursor;
  });
  if (segments.length) {
    // Накопленная сумма долей может не дотянуть до единицы на последних знаках,
    // и тогда точка остановки у самого края не попала бы ни в один сектор.
    segments[segments.length - 1].end = 1;
  }
  return { segments, pot };
}

export function pickWinner(segments, finalAngle) {
  const angle = Number(finalAngle);
  if (!segments.length || !Number.isFinite(angle)) {
    return null;
  }
  const point = ((angle % 1) + 1) % 1;
  return segments.find((segment) => point >= segment.start && point < segment.end)
    || segments[segments.length - 1];
}

// Маршруты приходят с telegram_id, внутри всё считается по внутреннему id.
async function resolveUserId(telegramId, client = null) {
  const raw = String(telegramId || "").trim();
  if (!raw) {
    return null;
  }
  const runner = client
    ? (sql, params) => client.query(sql, params)
    : (sql, params) => query(sql, params);
  const result = await runner(
    "SELECT id FROM users WHERE telegram_id = $1::text LIMIT 1",
    [raw],
  );
  return result.rows[0] ? Number(result.rows[0].id) : null;
}

async function loadBets(client, roundId) {
  const result = await client.query(
    `
      SELECT bets.user_id, bets.amount, users.username, users.first_name, users.photo_url
      FROM roulette_bets bets
      JOIN users ON users.id = bets.user_id
      WHERE bets.round_id = $1
        AND bets.refunded = FALSE
      ORDER BY bets.id
    `,
    [roundId],
  );
  return result.rows;
}

async function adjustBalance(client, currency, userId, amount, reason, source) {
  const delta = roundAmount(amount);
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) {
    return;
  }
  const { balances, ledger } = balanceTableFor(currency);
  await client.query(
    `
      INSERT INTO ${balances} (user_id, balance, updated_at)
      VALUES ($1, $2::numeric, now())
      ON CONFLICT (user_id) DO UPDATE
      SET balance = ${balances}.balance + $2::numeric,
          updated_at = now()
    `,
    [userId, delta],
  );
  await client.query(
    `
      INSERT INTO ${ledger} (user_id, amount, reason, source)
      VALUES ($1, $2::numeric, $3, $4)
    `,
    [userId, delta, reason, source],
  );
}

async function createRound(client, currency) {
  const seed = crypto.randomBytes(32).toString("hex");
  const seedHash = crypto.createHash("sha256").update(seed).digest("hex");
  const start = nowMs();
  const betsCloseAt = new Date(start + BET_MS);
  const spinAt = new Date(start + BET_MS + LOCK_MS);
  // ends_at пересчитается при раскрутке, когда станет известна её длительность.
  const endsAt = new Date(start + BET_MS + LOCK_MS + 10_000);

  const result = await client.query(
    `
      INSERT INTO roulette_rounds (currency, status, seed, seed_hash, bets_close_at, spin_at, ends_at)
      VALUES ($1, 'betting', $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [currency, seed, seedHash, betsCloseAt, spinAt, endsAt],
  );
  return result.rows[0];
}

async function getCurrentRoundRow(client, currency) {
  const result = await client.query(
    `
      SELECT *
      FROM roulette_rounds
      WHERE currency = $1
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
    `,
    [currency],
  );
  return result.rows[0] || null;
}

// Один шаг жизненного цикла. Всё под транзакцией с блокировкой строки раунда:
// тик может пересечься с обработкой ставки, и без блокировки два процесса
// разыграли бы один банк дважды.
async function advanceRound(client, currency) {
  let round = await getCurrentRoundRow(client, currency);
  if (!round) {
    return createRound(client, currency);
  }

  const now = nowMs();

  if (round.status === "betting" && now >= new Date(round.bets_close_at).getTime()) {
    const bets = await loadBets(client, round.id);
    const { segments, pot } = buildSegments(bets);
    if (segments.length < MIN_PARTICIPANTS) {
      // Одному играть не с кем: он выиграл бы собственные звёзды за вычетом
      // комиссии, то есть просто заплатил бы за участие. Возвращаем и ждём.
      for (const bet of bets) {
        await adjustBalance(
          client,
          currency,
          bet.user_id,
          roundAmount(bet.amount),
          "roulette_refund",
          `roulette:${round.id}`,
        );
      }
      await client.query(
        "UPDATE roulette_bets SET refunded = TRUE WHERE round_id = $1",
        [round.id],
      );
      await client.query(
        `
          UPDATE roulette_rounds
          SET status = 'void', pot = 0, settled_at = now(), ends_at = now()
          WHERE id = $1
        `,
        [round.id],
      );
      round = await getCurrentRoundRow(client, currency);
    } else {
      const updated = await client.query(
        "UPDATE roulette_rounds SET status = 'locked', pot = $2::numeric WHERE id = $1 RETURNING *",
        [round.id, pot],
      );
      round = updated.rows[0];
    }
  }

  if (round.status === "locked" && now >= new Date(round.spin_at).getTime()) {
    const spin = buildSpin(round.seed);
    const endsAt = new Date(new Date(round.spin_at).getTime() + spin.spinSeconds * 1_000);
    const updated = await client.query(
      `
        UPDATE roulette_rounds
        SET status = 'spinning',
            final_angle = $2::numeric,
            spin_turns = $3::numeric,
            spin_seconds = $4::numeric,
            ends_at = $5
        WHERE id = $1
        RETURNING *
      `,
      [round.id, spin.finalAngle, spin.turns, spin.spinSeconds, endsAt],
    );
    round = updated.rows[0];
  }

  if (round.status === "spinning" && now >= new Date(round.ends_at).getTime()) {
    const bets = await loadBets(client, round.id);
    const { segments, pot } = buildSegments(bets);
    const winner = pickWinner(segments, round.final_angle);
    const rake = roundAmount(pot * HOUSE_RAKE);
    const payout = roundAmount(pot - rake);

    if (winner) {
      await adjustBalance(
        client,
        currency,
        winner.user_id,
        payout,
        "roulette_win",
        `roulette:${round.id}`,
      );
    }
    // Комиссия никуда не зачисляется — она перестаёт существовать. Ровно этим
    // круг и отличается от рынков: там дом рискует, здесь он изымает.
    const updated = await client.query(
      `
        UPDATE roulette_rounds
        SET status = 'settled',
            pot = $2::numeric,
            rake = $3::numeric,
            winner_user_id = $4,
            winner_amount = $5::numeric,
            settled_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [round.id, pot, rake, winner?.user_id || null, payout],
    );
    round = updated.rows[0];
  }

  const finished = round.status === "settled" || round.status === "void";
  if (finished) {
    const restAt = new Date(round.settled_at || round.ends_at).getTime() + RESULT_PAUSE_MS;
    if (now >= restAt) {
      return createRound(client, currency);
    }
  }

  return round;
}

export async function rouletteTick() {
  const results = [];
  for (const currency of getEnabledCurrencies()) {
    try {
      const round = await withTransaction((client) => advanceRound(client, currency));
      results.push({ currency, round_id: Number(round.id), status: round.status });
    } catch (error) {
      console.warn(
        "[easymarket] roulette tick failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
  return results;
}

function serializeRound(round, segments, viewerId) {
  const spinning = round.status === "spinning" || round.status === "settled";
  return {
    id: Number(round.id),
    currency: round.currency,
    status: round.status,
    pot: roundAmount(round.pot),
    min_bet: getMinimumBet(round.currency),
    rake_percent: Math.round(HOUSE_RAKE * 100),
    // Хеш публикуем сразу, зерно — только когда колесо уже отпущено. До этого
    // момента никто, включая нас, не может назвать точку остановки.
    seed_hash: round.seed_hash,
    seed: spinning ? round.seed : null,
    final_angle: spinning ? toNumber(round.final_angle) : null,
    spin_turns: spinning ? toNumber(round.spin_turns) : null,
    spin_seconds: spinning ? toNumber(round.spin_seconds) : null,
    bets_close_at: round.bets_close_at,
    spin_at: round.spin_at,
    ends_at: round.ends_at,
    server_time: new Date().toISOString(),
    segments: segments.map((segment) => ({
      user_id: segment.user_id,
      amount: segment.amount,
      share: segment.share,
      start: segment.start,
      end: segment.end,
      name: segment.first_name || segment.username || "Игрок",
      photo_url: segment.photo_url,
      is_me: viewerId ? Number(segment.user_id) === Number(viewerId) : false,
    })),
    winner: round.winner_user_id
      ? {
        user_id: Number(round.winner_user_id),
        amount: roundAmount(round.winner_amount),
        is_me: viewerId ? Number(round.winner_user_id) === Number(viewerId) : false,
      }
      : null,
  };
}

export async function getRouletteState(input = {}) {
  const normalized = normalizeCurrency(input.currency);
  const viewerId = await resolveUserId(input.telegram_id);
  const roundResult = await query(
    "SELECT * FROM roulette_rounds WHERE currency = $1 ORDER BY id DESC LIMIT 1",
    [normalized],
  );
  const round = roundResult.rows[0];
  if (!round) {
    return { round: null, history: [] };
  }

  const betsResult = await query(
    `
      SELECT bets.user_id, bets.amount, users.username, users.first_name, users.photo_url
      FROM roulette_bets bets
      JOIN users ON users.id = bets.user_id
      WHERE bets.round_id = $1
        AND bets.refunded = FALSE
      ORDER BY bets.id
    `,
    [round.id],
  );
  const { segments } = buildSegments(betsResult.rows);

  const historyResult = await query(
    `
      SELECT rounds.id, rounds.pot, rounds.winner_amount, rounds.settled_at,
             users.username, users.first_name, users.photo_url
      FROM roulette_rounds rounds
      LEFT JOIN users ON users.id = rounds.winner_user_id
      WHERE rounds.currency = $1
        AND rounds.status = 'settled'
      ORDER BY rounds.settled_at DESC
      LIMIT 10
    `,
    [normalized],
  );

  return {
    round: serializeRound(round, segments, viewerId),
    history: historyResult.rows.map((row) => ({
      id: Number(row.id),
      pot: roundAmount(row.pot),
      amount: roundAmount(row.winner_amount),
      name: row.first_name || row.username || "Игрок",
      photo_url: row.photo_url,
    })),
  };
}

export async function placeRouletteBet(input) {
  const userId = await resolveUserId(input.telegram_id);
  const currency = normalizeCurrency(input.currency);
  const amount = roundAmount(input.amount);
  const minimum = getMinimumBet(currency);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return { ok: false, message: "Не удалось определить игрока." };
  }
  if (!Number.isFinite(amount) || amount < minimum) {
    return { ok: false, message: `Минимальная ставка — ${minimum}.` };
  }
  if (!getEnabledCurrencies().includes(currency)) {
    return { ok: false, message: "Этот круг ещё не запущен." };
  }

  return withTransaction(async (client) => {
    const round = await getCurrentRoundRow(client, currency);
    if (!round || round.status !== "betting") {
      return { ok: false, message: "Приём ставок закрыт, ждём следующий раунд." };
    }
    if (nowMs() >= new Date(round.bets_close_at).getTime()) {
      return { ok: false, message: "Приём ставок закрыт, ждём следующий раунд." };
    }

    const { balances } = balanceTableFor(currency);
    const balanceResult = await client.query(
      `SELECT balance FROM ${balances} WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const balance = roundAmount(balanceResult.rows[0]?.balance);
    if (balance < amount) {
      return { ok: false, message: "Не хватает баланса." };
    }

    await adjustBalance(client, currency, userId, -amount, "roulette_bet", `roulette:${round.id}`);
    await client.query(
      "INSERT INTO roulette_bets (round_id, user_id, amount) VALUES ($1, $2, $3::numeric)",
      [round.id, userId, amount],
    );

    const bets = await loadBets(client, round.id);
    const { segments, pot } = buildSegments(bets);
    await client.query(
      "UPDATE roulette_rounds SET pot = $2::numeric WHERE id = $1",
      [round.id, pot],
    );

    return {
      ok: true,
      round: serializeRound({ ...round, pot }, segments, userId),
      balance: roundAmount(balance - amount),
    };
  });
}
