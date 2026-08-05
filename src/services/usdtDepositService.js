import {
  formatUnits,
  getAddress,
  id,
  Interface,
  JsonRpcProvider,
  zeroPadValue,
} from "ethers";
import { randomInt } from "node:crypto";

import { config } from "../config.js";
import { query, toNumber, withTransaction } from "../db.js";
import { claimDepositLossRefundOffers, getUserByTelegramId, upsertUser } from "./marketService.js";

const TRANSFER_TOPIC = id("Transfer(address,address,uint256)");
const TRANSFER_IFACE = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const RECENT_UNMATCHED_LIMIT = 200;

let providerCache = new Map();
let backfillLastRunAt = new Map();

function roundMoney(value, decimals = 2) {
  const multiplier = 10 ** decimals;
  return Math.round(Number(value || 0) * multiplier) / multiplier;
}

export function normalizeUsdtDepositAmount(value, minimumValue = config.usdtDepositMinimum) {
  const amount = roundMoney(value, 2);
  const minimum = roundMoney(minimumValue, 2);
  if (!Number.isFinite(amount) || amount < minimum || amount > 100_000) {
    throw new Error("invalid_deposit_amount");
  }
  return amount;
}

function buildDepositAmountCandidates(requestedAmount) {
  const offsets = Array.from({ length: 99 }, (_, index) => (index + 1) / 100);
  for (let index = offsets.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [offsets[index], offsets[swapIndex]] = [offsets[swapIndex], offsets[index]];
  }
  return [0, ...offsets].map((offset) => roundMoney(requestedAmount + offset, 2));
}

function normalizeAddress(value) {
  try {
    return getAddress(String(value || "").trim());
  } catch {
    return "";
  }
}

function buildEvmNetwork(input) {
  const treasuryAddress = normalizeAddress(config.publicUsdtEvmAddress);
  const tokenAddress = normalizeAddress(input.tokenAddress);
  if (!treasuryAddress || !tokenAddress || (!input.rpcUrl && !input.explorerApiKey)) {
    return null;
  }

  return {
    key: input.key,
    label: input.label,
    rpcUrl: input.rpcUrl,
    tokenAddress,
    treasuryAddress,
    decimals: input.decimals,
    confirmations: config.usdtDepositConfirmations,
    explorerApiUrl: input.explorerApiUrl,
    explorerApiKey: input.explorerApiKey,
    explorerChainId: input.explorerChainId,
    explorerPageSize: input.explorerPageSize,
  };
}

// A hung request is worse than a failed one: scanUsdtDeposits already handles
// errors per network, but nothing ever resolves a promise that hangs, so the
// caller's busy latch would stay set forever and the scanner would go quiet
// without a single log line. Every outbound call gets a deadline.
function withTimeout(promise, label) {
  const ms = Math.max(1_000, Number(config.usdtDepositScanTimeoutMs || 20_000));
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout_${label}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function getConfiguredUsdtDepositNetworks() {
  return [
    buildEvmNetwork({
      key: "BSC",
      label: "BEP20",
      rpcUrl: config.usdtBscRpcUrl,
      tokenAddress: config.usdtBscTokenAddress,
      decimals: config.usdtBscDecimals,
      explorerApiUrl: config.evmScanApiUrl,
      explorerApiKey: config.evmScanApiKey,
      explorerChainId: config.usdtBscExplorerChainId,
      explorerPageSize: config.evmScanPageSize,
    }),
    buildEvmNetwork({
      key: "ETH",
      label: "ERC20",
      rpcUrl: config.usdtEthRpcUrl,
      tokenAddress: config.usdtEthTokenAddress,
      decimals: config.usdtEthDecimals,
      explorerApiUrl: config.evmScanApiUrl,
      explorerApiKey: config.evmScanApiKey,
      explorerChainId: config.usdtEthExplorerChainId,
      explorerPageSize: config.evmScanPageSize,
    }),
  ].filter(Boolean);
}

export function getPublicUsdtDepositNetworks() {
  return getConfiguredUsdtDepositNetworks().map((network) => ({
    key: network.key,
    label: network.label,
    confirmations: network.confirmations,
  }));
}

function getProvider(network) {
  const cached = providerCache.get(network.key);
  if (cached) {
    return cached;
  }
  const provider = new JsonRpcProvider(network.rpcUrl);
  providerCache.set(network.key, provider);
  return provider;
}

function mapDepositIntent(row) {
  if (!row) {
    return null;
  }
  const network = getConfiguredUsdtDepositNetworks().find((item) => item.key === row.network);
  const isAnyNetwork = row.network === "ANY";
  return {
    id: Number(row.id),
    network: row.network,
    network_label: isAnyNetwork ? "BEP20 / ERC20" : network?.label || row.network,
    status: row.status,
    requested_amount: toNumber(row.requested_amount),
    deposit_amount: toNumber(row.deposit_amount),
    credited_amount: toNumber(row.credited_amount),
    to_address: row.to_address,
    from_address: row.from_address,
    tx_hash: row.tx_hash,
    log_index: row.log_index === null || row.log_index === undefined ? null : Number(row.log_index),
    block_number: row.block_number === null || row.block_number === undefined ? null : Number(row.block_number),
    confirmations: Number(row.confirmations || 0),
    created_at: row.created_at,
    expires_at: row.expires_at,
    credited_at: row.credited_at,
  };
}

async function sendAdminDepositIntentNotification(user, intent) {
  if (!config.telegramBotToken || !config.telegramAdminUserIds.length || !intent) {
    return;
  }

  const name = user.username
    ? `@${user.username}`
    : (user.first_name || `user ${user.telegram_id}`);
  const text = [
    "Новая заявка на пополнение USDT",
    "",
    `Пользователь: ${name}`,
    `telegram_id: ${user.telegram_id}`,
    `Заявка #${intent.id}`,
    `Сумма к отправке: ${intent.deposit_amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} USDT`,
    `Кошелек: ${intent.to_address}`,
    `Сети: BEP20 / ERC20`,
  ].join("\n");

  await Promise.allSettled(config.telegramAdminUserIds.map(async (chatId) => {
    const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      console.warn("[EasyMarket] deposit admin notify failed", {
        intent_id: intent.id,
        chat_id: chatId,
        status: response.status,
      });
    }
  }));
}

export async function expirePendingDepositIntents() {
  // Pending deposits must stay visible until the user cancels them or the scanner credits them.
  // Expiring them automatically made real late transfers hard to match and confused users.
  return 0;
}

export async function createUsdtDepositIntent(input) {
  const networks = getConfiguredUsdtDepositNetworks();
  const network = networks[0];
  if (!network) {
    throw new Error("invalid_deposit_network");
  }
  const requestedAmount = normalizeUsdtDepositAmount(input.amount);
  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });

  const intent = await withTransaction(async (client) => {
    const existingResult = await client.query(
      `
        SELECT *
        FROM usdt_deposit_intents
        WHERE user_id = $1
          AND status = 'pending'
          AND requested_amount = $2::numeric
          AND network = ANY($3::text[])
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [user.id, requestedAmount, ["ANY", ...networks.map((item) => item.key)]],
    );
    if (existingResult.rows[0]) {
      return existingResult.rows[0];
    }

    // Разносим суммы как можно дальше друг от друга: чем больше зазор между
    // ожидаемыми суммами, тем реже допуск при сопоставлении даёт двух
    // кандидатов и тем чаще перевод зачисляется автоматически.
    const neighborsResult = await client.query(
      `
        SELECT deposit_amount
        FROM usdt_deposit_intents
        WHERE status = 'pending'
          AND deposit_amount BETWEEN ($1::numeric - 1) AND ($1::numeric + 2)
      `,
      [requestedAmount],
    );
    const takenAmounts = neighborsResult.rows.map((row) => toNumber(row.deposit_amount));
    const orderedCandidates = buildDepositAmountCandidates(requestedAmount)
      .map((candidate) => ({
        candidate,
        distance: takenAmounts.length
          ? Math.min(...takenAmounts.map((taken) => Math.abs(taken - candidate)))
          : Number.POSITIVE_INFINITY,
      }))
      // Сортировка стабильная, поэтому среди равноудалённых сохраняется
      // случайный порядок из buildDepositAmountCandidates.
      .sort((a, b) => b.distance - a.distance)
      .map((item) => item.candidate);

    for (const depositAmount of orderedCandidates) {
      const result = await client.query(
        `
          INSERT INTO usdt_deposit_intents (
            user_id,
            network,
            requested_amount,
            deposit_amount,
            to_address,
            expires_at
          )
          VALUES (
            $1,
            'ANY',
            $2::numeric,
            $3::numeric,
            $4,
            now() + ($5::int * interval '1 minute')
          )
          ON CONFLICT (network, deposit_amount) WHERE status = 'pending'
          DO NOTHING
          RETURNING *
        `,
        [
          user.id,
          requestedAmount,
          depositAmount,
          network.treasuryAddress,
          Math.round(config.usdtDepositIntentMinutes),
        ],
      );
      if (result.rows[0]) {
        return result.rows[0];
      }
    }

    throw new Error("deposit_amount_collision");
  });

  const mappedIntent = mapDepositIntent(intent);
  void sendAdminDepositIntentNotification(user, mappedIntent);

  return {
    user,
    intent: mappedIntent,
  };
}

export async function getUserDepositIntents(telegramId, limit = 10) {
  await expirePendingDepositIntents();
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    return [];
  }
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 30));
  const result = await query(
    `
      SELECT *
      FROM usdt_deposit_intents
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [user.id, safeLimit],
  );
  return result.rows.map(mapDepositIntent);
}

// Read-only view for working out what happened to a payment that never landed.
// Shows every intent regardless of status, plus any chain event that touched the
// same address, so a cancelled intent with money already sent is visible.
export async function auditUserDeposits(input = {}) {
  const telegramId = String(input.telegram_id || input.telegramId || "").trim();
  const username = String(input.username || "").replace(/^@/, "").trim();
  if (!telegramId && !username) {
    throw new Error("telegram_id_or_username_required");
  }

  const userResult = await query(
    `
      SELECT id, telegram_id, username, first_name, created_at
      FROM users
      WHERE ($1::text <> '' AND telegram_id = $1::text)
         OR ($2::text <> '' AND lower(username) = lower($2::text))
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [telegramId, username],
  );
  const user = userResult.rows[0];
  if (!user) {
    throw new Error("user_not_found");
  }

  const intentsResult = await query(
    `
      SELECT *
      FROM usdt_deposit_intents
      WHERE user_id = $1::bigint
      ORDER BY created_at DESC
      LIMIT 30
    `,
    [user.id],
  );

  // Any chain event that landed on an address this user was ever given, however
  // the event itself was classified.
  const eventsResult = await query(
    `
      SELECT events.*
      FROM usdt_deposit_events events
      WHERE lower(events.to_address) IN (
        SELECT DISTINCT lower(to_address)
        FROM usdt_deposit_intents
        WHERE user_id = $1::bigint
      )
      ORDER BY events.created_at DESC
      LIMIT 50
    `,
    [user.id],
  );

  const creditedResult = await query(
    `
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS entries
      FROM usdt_ledger
      WHERE user_id = $1::bigint
        AND reason = 'usdt_onchain_deposit'
        AND amount > 0
    `,
    [user.id],
  );

  // Whether the watcher is even current matters as much as the intent itself:
  // a stalled scanner and a payment that never arrived look identical from the
  // intent's side.
  const scannerResult = await query(
    `
      SELECT network, last_scanned_block, updated_at
      FROM usdt_deposit_scanner_state
      ORDER BY network
    `,
  );
  const lastEventResult = await query(
    `
      SELECT network, MAX(created_at) AS seen_at
      FROM usdt_deposit_events
      GROUP BY network
    `,
  );

  const lastEventByNetwork = new Map(
    lastEventResult.rows.map((row) => [row.network, row.seen_at]),
  );

  return {
    ok: true,
    user: {
      id: Number(user.id),
      telegram_id: user.telegram_id,
      username: user.username,
      first_name: user.first_name,
    },
    scanner: {
      enabled: Boolean(config.usdtDepositScanEnabled),
      networks: scannerResult.rows.map((row) => ({
        network: row.network,
        last_scanned_block: Number(row.last_scanned_block),
        updated_at: row.updated_at,
        stale_seconds: Math.round((Date.now() - new Date(row.updated_at).getTime()) / 1000),
        last_event_at: lastEventByNetwork.get(row.network) || null,
      })),
    },
    credited_total: Number(creditedResult.rows[0]?.total || 0),
    credited_entries: Number(creditedResult.rows[0]?.entries || 0),
    intents: intentsResult.rows.map((row) => ({
      id: Number(row.id),
      status: row.status,
      network: row.network,
      requested_amount: Number(row.requested_amount),
      deposit_amount: Number(row.deposit_amount),
      credited_amount: row.credited_amount === null ? null : Number(row.credited_amount),
      to_address: row.to_address,
      from_address: row.from_address,
      tx_hash: row.tx_hash,
      created_at: row.created_at,
      expires_at: row.expires_at,
      credited_at: row.credited_at,
    })),
    chain_events: eventsResult.rows.map((row) => ({
      id: Number(row.id),
      status: row.status,
      network: row.network,
      tx_hash: row.tx_hash,
      amount: Number(row.amount),
      from_address: row.from_address,
      to_address: row.to_address,
      matched_intent_id: row.matched_intent_id === null ? null : Number(row.matched_intent_id),
      chain_timestamp: row.chain_timestamp,
      created_at: row.created_at,
    })),
  };
}

export async function getUserDepositIntent(input) {
  await expirePendingDepositIntents();
  const telegramId = String(input.telegram_id || "").trim();
  if (!telegramId) {
    throw new Error("telegram_id_missing");
  }
  const intentId = Number(input.intentId);
  if (!Number.isSafeInteger(intentId) || intentId <= 0) {
    return null;
  }
  const result = await query(
    `
      SELECT i.*
      FROM usdt_deposit_intents i
      JOIN users u ON u.id = i.user_id
      WHERE i.id = $1
        AND u.telegram_id = $2
      LIMIT 1
    `,
    [intentId, telegramId],
  );
  return mapDepositIntent(result.rows[0]);
}

export async function cancelUserDepositIntent(input) {
  const telegramId = String(input.telegram_id || "").trim();
  if (!telegramId) {
    throw new Error("telegram_id_missing");
  }
  const intentId = Number(input.intentId);
  if (!Number.isSafeInteger(intentId) || intentId <= 0) {
    return null;
  }

  const result = await query(
    `
      UPDATE usdt_deposit_intents i
      SET status = 'cancelled',
          updated_at = now()
      FROM users u
      WHERE i.id = $1
        AND i.user_id = u.id
        AND u.telegram_id = $2
        AND i.status = 'pending'
      RETURNING i.*
    `,
    [intentId, telegramId],
  );
  return mapDepositIntent(result.rows[0]);
}

// Очередь на разбор: реальные приходы из блокчейна, которые не сошлись ни с
// одной заявкой по точной сумме. Показываем только свежие — человек, который
// собирался платить, делает это в течение пары часов после создания заявки,
// а заявки недельной давности это просто "нажал и забыл".
const DEPOSIT_REVIEW_EVENT_MAX_AGE_HOURS = 72;
const DEPOSIT_REVIEW_INTENT_MAX_AGE_HOURS = 48;
const DEPOSIT_REVIEW_INTENT_AFTER_EVENT_MINUTES = 60;

export async function getDepositReviewQueue(input = {}) {
  const limit = Math.max(1, Math.min(30, Number(input.limit) || 15));
  const eventMaxAgeHours = Math.max(
    1,
    Math.min(168, Number(input.max_age_hours ?? input.maxAgeHours) || DEPOSIT_REVIEW_EVENT_MAX_AGE_HOURS),
  );

  const eventsResult = await query(
    `
      SELECT *
      FROM usdt_deposit_events
      WHERE status = 'unmatched'
        AND created_at >= now() - interval '1 hour' * $1::int
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [eventMaxAgeHours, limit],
  );

  const events = [];
  for (const event of eventsResult.rows) {
    const arrivedAt = event.chain_timestamp || event.created_at;
    const candidatesResult = await query(
      `
        SELECT
          intents.id,
          intents.deposit_amount,
          intents.requested_amount,
          intents.created_at,
          users.telegram_id,
          users.username,
          users.first_name
        FROM usdt_deposit_intents intents
        JOIN users ON users.id = intents.user_id
        WHERE intents.status = 'pending'
          AND intents.created_at >= now() - interval '1 hour' * $2::int
          AND intents.created_at <= $1::timestamptz + interval '1 minute' * $3::int
        ORDER BY ABS(intents.deposit_amount - $4::numeric) ASC, intents.created_at DESC
        LIMIT 3
      `,
      [
        arrivedAt,
        DEPOSIT_REVIEW_INTENT_MAX_AGE_HOURS,
        DEPOSIT_REVIEW_INTENT_AFTER_EVENT_MINUTES,
        event.amount,
      ],
    );

    events.push({
      event_id: Number(event.id),
      network: event.network,
      amount: toNumber(event.amount),
      from_address: event.from_address,
      tx_hash: event.tx_hash,
      arrived_at: arrivedAt,
      candidates: candidatesResult.rows.map((row) => ({
        intent_id: Number(row.id),
        telegram_id: row.telegram_id,
        username: row.username,
        first_name: row.first_name,
        expected_amount: toNumber(row.deposit_amount),
        requested_amount: toNumber(row.requested_amount),
        delta: roundMoney(toNumber(event.amount) - toNumber(row.deposit_amount), 2),
        created_at: row.created_at,
      })),
    });
  }

  return events;
}

// Зачисление из очереди: админ выбрал, какой заявке принадлежит конкретный
// приход. Событие переводится в credited вместе с балансом, поэтому один и
// тот же перевод нельзя зачислить дважды.
export async function creditDepositEventToIntent(input = {}) {
  const eventId = Number(input.event_id ?? input.eventId);
  const intentId = Number(input.intent_id ?? input.intentId);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    throw new Error("deposit_event_not_found");
  }
  if (!Number.isSafeInteger(intentId) || intentId <= 0) {
    throw new Error("deposit_intent_not_found");
  }

  return withTransaction(async (client) => {
    const eventResult = await client.query(
      `
        SELECT *
        FROM usdt_deposit_events
        WHERE id = $1
          AND status <> 'credited'
        LIMIT 1
        FOR UPDATE
      `,
      [eventId],
    );
    const event = eventResult.rows[0];
    if (!event) {
      throw new Error("deposit_event_not_found");
    }

    const intentResult = await client.query(
      `
        SELECT intents.*, users.telegram_id, users.username, users.first_name
        FROM usdt_deposit_intents intents
        JOIN users ON users.id = intents.user_id
        WHERE intents.id = $1
          AND intents.status = 'pending'
        LIMIT 1
        FOR UPDATE OF intents
      `,
      [intentId],
    );
    const intent = intentResult.rows[0];
    if (!intent) {
      throw new Error("deposit_intent_not_pending");
    }

    const amount = roundMoney(event.amount, 2);
    if (amount <= 0) {
      throw new Error("invalid_deposit_amount");
    }

    await client.query(
      `
        UPDATE usdt_balances
        SET balance = balance + $2::numeric,
            updated_at = now()
        WHERE user_id = $1
      `,
      [intent.user_id, amount],
    );
    await client.query(
      `
        INSERT INTO usdt_ledger (user_id, amount, reason, source)
        VALUES ($1, $2::numeric, 'usdt_onchain_deposit', $3)
      `,
      [intent.user_id, amount, `${event.network}:${event.tx_hash}:${event.log_index}`],
    );
    await client.query(
      `
        UPDATE usdt_deposit_intents
        SET status = 'credited',
            credited_amount = $2::numeric,
            from_address = $3,
            tx_hash = $4,
            log_index = $5,
            block_number = $6,
            credited_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [intent.id, amount, event.from_address, event.tx_hash, event.log_index, event.block_number],
    );
    await client.query(
      `
        UPDATE usdt_deposit_events
        SET status = 'credited',
            matched_intent_id = $2
        WHERE id = $1
      `,
      [event.id, intent.id],
    );
    await claimDepositLossRefundOffers(client, intent.user_id);
    const balanceResult = await client.query(
      "SELECT balance FROM usdt_balances WHERE user_id = $1",
      [intent.user_id],
    );

    console.log("[EasyMarket] USDT deposit credited from review queue", {
      event_id: event.id,
      intent_id: intent.id,
      user_id: intent.user_id,
      amount,
    });

    return {
      amount,
      telegram_id: intent.telegram_id,
      username: intent.username,
      first_name: intent.first_name,
      expected_amount: toNumber(intent.deposit_amount),
      usdt_cash_balance: toNumber(balanceResult.rows[0]?.balance),
    };
  });
}

// Пометить приход разобранным, не двигая деньги: перевод уже зачислен другим
// путём или начислять его не нужно. Из очереди уходит навсегда.
export async function dismissDepositEvent(input = {}) {
  const eventId = Number(input.event_id ?? input.eventId);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    throw new Error("deposit_event_not_found");
  }
  const intentId = Number(input.intent_id ?? input.intentId);

  const result = await query(
    `
      UPDATE usdt_deposit_events
      SET status = 'dismissed',
          matched_intent_id = COALESCE($2, matched_intent_id)
      WHERE id = $1
        AND status <> 'credited'
      RETURNING *
    `,
    [eventId, Number.isSafeInteger(intentId) && intentId > 0 ? intentId : null],
  );
  const event = result.rows[0];
  if (!event) {
    throw new Error("deposit_event_not_found");
  }

  console.log("[EasyMarket] USDT deposit event dismissed", {
    event_id: event.id,
    amount: toNumber(event.amount),
  });

  return {
    event_id: Number(event.id),
    amount: toNumber(event.amount),
    status: event.status,
  };
}

// Ручной апрув зависшей заявки: пользователь отправил не ту точную сумму, и
// сканер её не сматчил. Проводим как настоящий депозит (ledger-reason
// usdt_onchain_deposit + intent credited), чтобы включились депозитные
// механики — бонусная разблокировка и конвертация звёзд.
export async function creditPendingDepositIntentManually(input) {
  const telegramId = String(input.telegram_id || "").trim();
  if (!telegramId) {
    throw new Error("telegram_id_missing");
  }
  const amount = roundMoney(input.amount, 2);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) {
    throw new Error("invalid_deposit_amount");
  }
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    throw new Error("user_not_found");
  }

  return withTransaction(async (client) => {
    const intentResult = await client.query(
      `
        SELECT *
        FROM usdt_deposit_intents
        WHERE user_id = $1
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [user.id],
    );
    const intent = intentResult.rows[0];
    if (!intent) {
      throw new Error("no_pending_deposit_intent");
    }

    await client.query(
      `
        UPDATE usdt_balances
        SET balance = balance + $2::numeric,
            updated_at = now()
        WHERE user_id = $1
      `,
      [user.id, amount],
    );
    await client.query(
      `
        INSERT INTO usdt_ledger (user_id, amount, reason, source)
        VALUES ($1, $2::numeric, 'usdt_onchain_deposit', $3)
      `,
      [user.id, amount, `manual_approve:intent:${intent.id}`],
    );
    const updatedResult = await client.query(
      `
        UPDATE usdt_deposit_intents
        SET status = 'credited',
            credited_amount = $2::numeric,
            credited_at = now(),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [intent.id, amount],
    );
    // Если этому начислению соответствует ровно один неразобранный приход на
    // ту же сумму — закрываем и его, иначе он останется висеть в очереди и
    // его предложат зачислить кому-то ещё.
    const matchingEvents = await client.query(
      `
        SELECT id
        FROM usdt_deposit_events
        WHERE status = 'unmatched'
          AND amount = $1::numeric
          AND created_at >= now() - interval '7 days'
        LIMIT 2
      `,
      [amount],
    );
    if (matchingEvents.rows.length === 1) {
      await client.query(
        `
          UPDATE usdt_deposit_events
          SET status = 'credited',
              matched_intent_id = $2
          WHERE id = $1
        `,
        [matchingEvents.rows[0].id, intent.id],
      );
    }

    await claimDepositLossRefundOffers(client, user.id);
    const balanceResult = await client.query(
      "SELECT balance FROM usdt_balances WHERE user_id = $1",
      [user.id],
    );

    console.log("[EasyMarket] USDT deposit credited manually", {
      intent_id: intent.id,
      user_id: user.id,
      amount,
    });

    return {
      intent: mapDepositIntent(updatedResult.rows[0]),
      usdt_cash_balance: toNumber(balanceResult.rows[0]?.balance),
    };
  });
}

// Откат ошибочного ручного апрува: снимает начисленное с основного баланса и
// снимает заявке статус credited, чтобы депозитные пороги пересчитались.
export async function revertManualDepositCredit(input) {
  const telegramId = String(input.telegram_id || "").trim();
  if (!telegramId) {
    throw new Error("telegram_id_missing");
  }
  const intentId = Number(input.intent_id ?? input.intentId);
  if (!Number.isSafeInteger(intentId) || intentId <= 0) {
    throw new Error("deposit_intent_not_found");
  }
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    throw new Error("user_not_found");
  }

  return withTransaction(async (client) => {
    const intentResult = await client.query(
      `
        SELECT *
        FROM usdt_deposit_intents
        WHERE id = $1
          AND user_id = $2
          AND status = 'credited'
        LIMIT 1
        FOR UPDATE
      `,
      [intentId, user.id],
    );
    const intent = intentResult.rows[0];
    if (!intent) {
      throw new Error("deposit_intent_not_found");
    }
    const amount = roundMoney(intent.credited_amount, 2);
    if (amount <= 0) {
      throw new Error("deposit_intent_not_pending");
    }

    const balanceResult = await client.query(
      "SELECT balance FROM usdt_balances WHERE user_id = $1 FOR UPDATE",
      [user.id],
    );
    if (toNumber(balanceResult.rows[0]?.balance) < amount) {
      throw new Error("insufficient_usdt");
    }

    await client.query(
      `
        UPDATE usdt_balances
        SET balance = balance - $2::numeric,
            updated_at = now()
        WHERE user_id = $1
      `,
      [user.id, amount],
    );
    await client.query(
      `
        INSERT INTO usdt_ledger (user_id, amount, reason, source)
        VALUES ($1, -$2::numeric, 'usdt_deposit_revert', $3)
      `,
      [user.id, amount, `manual_revert:intent:${intent.id}`],
    );
    const revertedResult = await client.query(
      `
        UPDATE usdt_deposit_intents
        SET status = 'cancelled',
            credited_amount = 0,
            credited_at = NULL,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [intent.id],
    );
    const finalBalance = await client.query(
      "SELECT balance FROM usdt_balances WHERE user_id = $1",
      [user.id],
    );

    console.log("[EasyMarket] USDT manual deposit credit reverted", {
      intent_id: intent.id,
      user_id: user.id,
      amount,
    });

    return {
      intent: mapDepositIntent(revertedResult.rows[0]),
      reverted_amount: amount,
      usdt_cash_balance: toNumber(finalBalance.rows[0]?.balance),
    };
  });
}

export async function checkUserDepositIntent(input) {
  const telegramId = String(input.telegram_id || "").trim();
  if (!telegramId) {
    throw new Error("telegram_id_missing");
  }
  const intentId = Number(input.intentId);
  if (!Number.isSafeInteger(intentId) || intentId <= 0) {
    throw new Error("deposit_intent_not_found");
  }

  const before = await getUserDepositIntent({
    telegram_id: telegramId,
    intentId,
  });
  if (!before) {
    throw new Error("deposit_intent_not_found");
  }

  const scan = await scanUsdtDeposits();
  const after = await getUserDepositIntent({
    telegram_id: telegramId,
    intentId,
  });

  return {
    intent: after,
    scan,
  };
}

async function getScannerState(network) {
  const result = await query(
    `
      SELECT last_scanned_block
      FROM usdt_deposit_scanner_state
      WHERE network = $1
      LIMIT 1
    `,
    [network.key],
  );
  return Number(result.rows[0]?.last_scanned_block || 0);
}

async function setScannerState(network, blockNumber) {
  await query(
    `
      INSERT INTO usdt_deposit_scanner_state (network, last_scanned_block, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (network) DO UPDATE SET
        last_scanned_block = GREATEST(usdt_deposit_scanner_state.last_scanned_block, EXCLUDED.last_scanned_block),
        updated_at = now()
    `,
    [network.key, blockNumber],
  );
}

async function getTransferLogs(provider, network, fromBlock, toBlock) {
  if (fromBlock > toBlock) {
    return [];
  }

  try {
    return await withTimeout(provider.getLogs({
      address: network.tokenAddress,
      fromBlock,
      toBlock,
      topics: [
        TRANSFER_TOPIC,
        null,
        zeroPadValue(network.treasuryAddress, 32),
      ],
    }), "get_logs");
  } catch (error) {
    if (fromBlock >= toBlock) {
      throw error;
    }

    const midpoint = Math.floor((fromBlock + toBlock) / 2);
    const left = await getTransferLogs(provider, network, fromBlock, midpoint);
    const right = await getTransferLogs(provider, network, midpoint + 1, toBlock);
    return [...left, ...right];
  }
}

// Подбор заявки под пришедший перевод. Сначала точное совпадение суммы, как
// раньше. Если его нет — допуск в несколько копеек (биржи занижают и завышают
// сумму на копейки), но только когда в окно попала ровно одна заявка: два
// кандидата означают, что угадывать нельзя, и перевод уходит в очередь.
async function findIntentForDepositEvent(client, network, event) {
  const baseParams = [
    [network.key, "ANY"],
    event.amount,
    event.chain_timestamp || new Date(),
    network.key,
    Math.round(config.usdtDepositMatchGraceMinutes),
  ];
  const exactResult = await client.query(
    `
      SELECT *
      FROM usdt_deposit_intents
      WHERE network = ANY($1::text[])
        AND status = 'pending'
        AND deposit_amount = $2::numeric
        AND created_at <= ($3::timestamptz + ($5::int * interval '1 minute'))
      ORDER BY
        CASE WHEN network = $4::text THEN 0 ELSE 1 END,
        created_at ASC
      LIMIT 1
      FOR UPDATE
    `,
    baseParams,
  );
  if (exactResult.rows[0]) {
    return exactResult.rows[0];
  }

  const tolerance = Math.max(0, Number(config.usdtDepositMatchTolerance || 0));
  if (tolerance <= 0) {
    return null;
  }
  const nearResult = await client.query(
    `
      SELECT *
      FROM usdt_deposit_intents
      WHERE network = ANY($1::text[])
        AND status = 'pending'
        AND deposit_amount BETWEEN ($2::numeric - $6::numeric) AND ($2::numeric + $6::numeric)
        AND created_at <= ($3::timestamptz + ($5::int * interval '1 minute'))
      LIMIT 2
      FOR UPDATE
    `,
    [...baseParams, tolerance],
  );
  if (nearResult.rows.length !== 1) {
    return null;
  }
  console.log("[EasyMarket] deposit matched within tolerance", {
    intent_id: nearResult.rows[0].id,
    expected: toNumber(nearResult.rows[0].deposit_amount),
    arrived: toNumber(event.amount),
  });
  return nearResult.rows[0];
}

async function matchDepositEvent(client, network, event) {
  // dismissed — разобранный вручную перевод: сканер не должен возвращать его
  // в очередь при следующем проходе.
  if (!event || event.status === "credited" || event.status === "dismissed") {
    return false;
  }

  const intent = await findIntentForDepositEvent(client, network, event);
  if (!intent) {
    await client.query(
      `
        UPDATE usdt_deposit_events
        SET status = 'unmatched'
        WHERE network = $1
          AND tx_hash = $2
          AND log_index = $3
          AND status NOT IN ('credited', 'dismissed')
      `,
      [network.key, event.tx_hash, event.log_index],
    );
    return false;
  }

  await client.query(
    `
      UPDATE usdt_balances
      SET balance = balance + $2::numeric,
          updated_at = now()
      WHERE user_id = $1
    `,
    [intent.user_id, event.amount],
  );
  await client.query(
    `
      INSERT INTO usdt_ledger (user_id, amount, reason, source)
      VALUES ($1, $2::numeric, 'usdt_onchain_deposit', $3)
    `,
    [intent.user_id, event.amount, `${network.key}:${event.tx_hash}:${event.log_index}`],
  );
  await client.query(
    `
      UPDATE usdt_deposit_intents
      SET status = 'credited',
          credited_amount = $2::numeric,
          from_address = $3,
          tx_hash = $4,
          log_index = $5,
          block_number = $6,
          confirmations = $7,
          credited_at = now(),
          updated_at = now()
      WHERE id = $1
    `,
    [
      intent.id,
      event.amount,
      event.from_address,
      event.tx_hash,
      event.log_index,
      event.block_number,
      event.confirmations || 0,
    ],
  );
  await client.query(
    `
      UPDATE usdt_deposit_events
      SET status = 'credited',
          matched_intent_id = $4
      WHERE network = $1
        AND tx_hash = $2
        AND log_index = $3
    `,
    [network.key, event.tx_hash, event.log_index, intent.id],
  );
  await claimDepositLossRefundOffers(client, intent.user_id);
  console.log("[EasyMarket] USDT deposit credited", {
    intent_id: intent.id,
    user_id: intent.user_id,
    network: network.key,
    amount: event.amount,
    tx_hash: String(event.tx_hash || "").slice(0, 12),
  });
  return true;
}

async function storeAndMatchDepositEvent(network, event) {
  if (!event || event.amount < 0.01) {
    return false;
  }

  await withTransaction(async (client) => {
    const eventResult = await client.query(
      `
        INSERT INTO usdt_deposit_events (
          network,
          tx_hash,
          log_index,
          block_number,
          from_address,
          to_address,
          amount,
          chain_timestamp
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8)
        ON CONFLICT (network, tx_hash, log_index) DO UPDATE SET
          block_number = EXCLUDED.block_number
        RETURNING *
      `,
      [
        network.key,
        event.txHash,
        event.logIndex,
        event.blockNumber,
        event.fromAddress,
        event.toAddress,
        event.amount,
        event.chainTimestamp,
      ],
    );

    await matchDepositEvent(client, network, {
      ...eventResult.rows[0],
      confirmations: event.confirmations || 0,
    });
  });
}

async function processDepositLog(network, log, provider, blockCache) {
  const parsed = TRANSFER_IFACE.parseLog(log);
  const fromAddress = getAddress(parsed.args.from);
  const toAddress = getAddress(parsed.args.to);
  const amount = roundMoney(formatUnits(parsed.args.value, network.decimals), 2);
  if (amount < 0.01) {
    return;
  }

  let block = blockCache.get(log.blockNumber);
  if (!block) {
    block = await withTimeout(provider.getBlock(log.blockNumber), "get_block");
    blockCache.set(log.blockNumber, block);
  }
  const chainTimestamp = block?.timestamp
    ? new Date(Number(block.timestamp) * 1000)
    : new Date();
  const logIndex = Number(log.index ?? log.logIndex ?? 0);
  const txHash = String(log.transactionHash);
  const confirmations = Math.max(0, Number(blockCache.latestBlock || log.blockNumber) - Number(log.blockNumber) + 1);

  await storeAndMatchDepositEvent(network, {
    txHash,
    logIndex,
    blockNumber: log.blockNumber,
    fromAddress,
    toAddress,
    amount,
    chainTimestamp,
    confirmations,
  });
}

async function reconcileUnmatchedDepositEvents(network, latestBlock) {
  const eventsResult = await query(
    `
      SELECT *
      FROM usdt_deposit_events
      WHERE network = $1
        AND status = 'unmatched'
        AND created_at >= now() - interval '2 days'
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [network.key, RECENT_UNMATCHED_LIMIT],
  );

  let matched = 0;
  for (const event of eventsResult.rows) {
    const confirmations = Math.max(0, Number(latestBlock || event.block_number) - Number(event.block_number) + 1);
    const didMatch = await withTransaction(async (client) => matchDepositEvent(client, network, {
      ...event,
      confirmations,
    }));
    if (didMatch) {
      matched += 1;
    }
  }

  return {
    checked: eventsResult.rows.length,
    matched,
  };
}

async function hasRecentUnresolvedDepositIntents() {
  const result = await query(
    `
      SELECT 1
      FROM usdt_deposit_intents
      WHERE status = ANY($1::text[])
        AND created_at >= now() - interval '2 days'
      LIMIT 1
    `,
    [["pending", "expired"]],
  );
  return Boolean(result.rows[0]);
}

async function maybeBackfillRecentDeposits(network, provider, latestBlock) {
  const now = Date.now();
  const lastRunAt = Number(backfillLastRunAt.get(network.key) || 0);
  if (now - lastRunAt < config.usdtDepositBackfillMs) {
    return null;
  }
  if (!(await hasRecentUnresolvedDepositIntents())) {
    backfillLastRunAt.set(network.key, now);
    return null;
  }

  backfillLastRunAt.set(network.key, now);
  const safeToBlock = latestBlock - network.confirmations;
  const maxRange = Math.round(config.usdtDepositMaxBlockRange);
  const fromBlock = Math.max(0, safeToBlock - Math.round(config.usdtDepositBackfillBlocks));
  if (fromBlock > safeToBlock) {
    return null;
  }

  const blockCache = new Map();
  blockCache.latestBlock = latestBlock;
  let logsCount = 0;
  for (let from = fromBlock; from <= safeToBlock; from += maxRange) {
    const to = Math.min(safeToBlock, from + maxRange - 1);
    const logs = await getTransferLogs(provider, network, from, to);
    logsCount += logs.length;
    for (const log of logs) {
      await processDepositLog(network, log, provider, blockCache);
    }
  }

  return {
    fromBlock,
    toBlock: safeToBlock,
    logs: logsCount,
  };
}

// "Upstream lower height 113211882 of type RECEIPTS is greater than 112949909"
// is the node saying which block it still has. Pull that number out so a cursor
// stranded behind a pruned range can jump to it: retrying the same range would
// fail identically forever, and the scanner would never move again on its own.
function detectPrunedLowerBound(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const lowerHeight = message.match(/lower height (\d+)/i);
  return lowerHeight ? Number(lowerHeight[1]) : null;
}

// Some nodes refuse old blocks outright rather than naming a boundary: "Archive
// requests require a personal token". There is no number to jump to, so the
// cursor has to resume near the head and the abandoned range gets reported.
function refusesArchiveHistory(error) {
  const message = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
  return message.includes("archive")
    || message.includes("missing trie node")
    || message.includes("state not available");
}

function canUseExplorerScan(network) {
  return Boolean(network.explorerApiKey)
    && Boolean(network.explorerApiUrl)
    && Boolean(network.explorerChainId);
}

function getExplorerTransferAmount(tx, fallbackDecimals) {
  const decimals = Number(tx.tokenDecimal ?? fallbackDecimals);
  const rawValue = BigInt(String(tx.value || "0"));
  return roundMoney(formatUnits(rawValue, Number.isFinite(decimals) ? decimals : fallbackDecimals), 2);
}

async function scanExplorerNetwork(network) {
  if (!canUseExplorerScan(network)) {
    return {
      enabled: false,
      reason: "missing_api_key",
    };
  }

  const params = new URLSearchParams({
    chainid: network.explorerChainId,
    module: "account",
    action: "tokentx",
    contractaddress: network.tokenAddress,
    address: network.treasuryAddress,
    page: "1",
    offset: String(Math.round(network.explorerPageSize || 50)),
    sort: "desc",
    apikey: network.explorerApiKey,
  });

  const response = await withTimeout(
    fetch(`${network.explorerApiUrl}?${params.toString()}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(
        Math.max(1_000, Number(config.usdtDepositScanTimeoutMs || 20_000)),
      ),
    }),
    "explorer",
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`explorer_http_${response.status}`);
  }
  if (!payload || (payload.status === "0" && payload.message !== "No transactions found")) {
    throw new Error(payload?.result || payload?.message || "explorer_error");
  }

  const rows = Array.isArray(payload.result) ? payload.result : [];
  let checked = 0;
  let incoming = 0;
  for (const tx of rows) {
    checked += 1;
    const txTo = normalizeAddress(tx.to);
    const contract = normalizeAddress(tx.contractAddress);
    if (txTo !== network.treasuryAddress || contract !== network.tokenAddress) {
      continue;
    }

    incoming += 1;
    await storeAndMatchDepositEvent(network, {
      txHash: String(tx.hash || ""),
      logIndex: Number(tx.logIndex ?? tx.transactionIndex ?? 0),
      blockNumber: Number(tx.blockNumber || 0),
      fromAddress: normalizeAddress(tx.from),
      toAddress: txTo,
      amount: getExplorerTransferAmount(tx, network.decimals),
      chainTimestamp: tx.timeStamp ? new Date(Number(tx.timeStamp) * 1000) : new Date(),
      confirmations: Number(tx.confirmations || 0),
    });
  }

  return {
    enabled: true,
    checked,
    incoming,
  };
}

async function scanNetwork(network) {
  let explorer = null;
  try {
    explorer = await scanExplorerNetwork(network);
  } catch (error) {
    explorer = {
      enabled: true,
      error: "scan_failed",
      message: error instanceof Error ? error.message : "unknown",
    };
  }

  if (explorer?.enabled && !explorer.error) {
    const reconcile = await reconcileUnmatchedDepositEvents(network, 0);
    return {
      network: network.key,
      scanned: 0,
      source: "explorer",
      explorer,
      reconcile,
    };
  }

  const provider = getProvider(network);
  let latestBlock;
  try {
    latestBlock = await withTimeout(provider.getBlockNumber(), "block_number");
  } catch (error) {
    return {
      network: network.key,
      scanned: 0,
      explorer,
      rpc_error: "scan_failed",
      message: error instanceof Error ? error.message : "unknown",
    };
  }
  const safeToBlock = latestBlock - network.confirmations;
  if (safeToBlock <= 0) {
    return { network: network.key, scanned: 0, explorer };
  }

  const previousBlock = await getScannerState(network);
  const effectivePreviousBlock = previousBlock || Math.max(0, safeToBlock - Math.round(config.usdtDepositInitialLookbackBlocks));
  const fromBlock = effectivePreviousBlock + 1;
  const toBlock = Math.min(safeToBlock, effectivePreviousBlock + Math.round(config.usdtDepositMaxBlockRange));
  if (fromBlock > toBlock) {
    const reconcile = await reconcileUnmatchedDepositEvents(network, latestBlock);
    const backfill = await maybeBackfillRecentDeposits(network, provider, latestBlock);
    return { network: network.key, scanned: 0, latestBlock, explorer, reconcile, backfill };
  }

  const blockCache = new Map();
  blockCache.latestBlock = latestBlock;

  let logs;
  try {
    logs = await getTransferLogs(provider, network, fromBlock, toBlock);
  } catch (error) {
    // The history we are asking for is gone from the node. Step over it rather
    // than wedging here; the gap is reported so it can be recovered through the
    // explorer, which looks up by address and needs no archive access.
    const archiveRefused = refusesArchiveHistory(error);
    const prunedFrom = detectPrunedLowerBound(error)
      ?? (archiveRefused
        ? Math.max(0, safeToBlock - Math.round(config.usdtDepositInitialLookbackBlocks))
        : null);
    if (!prunedFrom || prunedFrom <= fromBlock) {
      throw error;
    }
    const resumeAt = Math.min(prunedFrom, safeToBlock);
    await setScannerState(network, resumeAt);
    console.warn(
      `[EasyMarket] ${network.key} deposit scan stepped over pruned blocks ${fromBlock}-${resumeAt}`,
    );
    const reconcile = await reconcileUnmatchedDepositEvents(network, latestBlock);
    return {
      network: network.key,
      scanned: 0,
      latestBlock,
      explorer,
      reconcile,
      skipped_pruned: { from: fromBlock, to: resumeAt },
    };
  }

  for (const log of logs) {
    await processDepositLog(network, log, provider, blockCache);
  }

  await setScannerState(network, toBlock);
  const reconcile = await reconcileUnmatchedDepositEvents(network, latestBlock);
  const backfill = await maybeBackfillRecentDeposits(network, provider, latestBlock);
  return {
    network: network.key,
    fromBlock,
    toBlock,
    logs: logs.length,
    latestBlock,
    explorer,
    reconcile,
    backfill,
  };
}

export async function scanUsdtDeposits() {
  if (!config.usdtDepositScanEnabled) {
    return {
      ok: true,
      enabled: false,
      results: [],
    };
  }

  await expirePendingDepositIntents();
  const networks = getConfiguredUsdtDepositNetworks();
  const results = [];
  for (const network of networks) {
    try {
      results.push(await scanNetwork(network));
    } catch (error) {
      console.warn("[EasyMarket] USDT deposit scan failed", {
        network: network.key,
        message: error instanceof Error ? error.message : "unknown",
      });
      results.push({
        network: network.key,
        error: "scan_failed",
        // The message used to go to console.warn only, which is unreachable on
        // a hosted log-less deploy - so a scanner that failed every run looked
        // exactly like one that was idle.
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: true,
    enabled: true,
    results,
  };
}
