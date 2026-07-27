import { randomBytes } from "node:crypto";

import { config } from "../config.js";
import { query, toNumber, withTransaction } from "../db.js";
import { getUserByTelegramId, upsertUser } from "./marketService.js";

const NETWORK_LABELS = {
  BSC: "BEP20",
  ETH: "ERC20",
};

function normalizeNetwork(value) {
  const raw = String(value || "BSC").trim().toUpperCase();
  if (["BSC", "BEP20", "BNB", "BNB20"].includes(raw)) {
    return "BSC";
  }
  if (["ETH", "ERC20", "ETHEREUM"].includes(raw)) {
    return "ETH";
  }
  throw new Error("invalid_withdrawal_network");
}

function ensureWithdrawalAmount(value) {
  const amount = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("invalid_withdrawal_amount");
  }
  return Math.round(amount * 100) / 100;
}

export function calculateUsdtWithdrawalAmounts(
  value,
  feeValue = config.usdtWithdrawalFee,
  minimumValue = config.usdtWithdrawalMinimum,
) {
  const amount = ensureWithdrawalAmount(value);
  const fee = Math.max(0, Math.round(Number(feeValue || 0) * 100) / 100);
  const minimum = Math.max(0, Math.round(Number(minimumValue || 0) * 100) / 100);
  if (amount < minimum) {
    throw new Error("withdrawal_amount_below_minimum");
  }
  const payout = Math.round((amount - fee) * 100) / 100;
  if (payout <= 0) {
    throw new Error("withdrawal_amount_below_fee");
  }
  return {
    amount,
    fee,
    payout,
  };
}

function normalizeEvmAddress(value) {
  const address = String(value || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("invalid_withdrawal_address");
  }
  return address;
}

function mapWithdrawal(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    telegram_id: row.telegram_id,
    username: row.username,
    first_name: row.first_name,
    status: row.status,
    amount: toNumber(row.amount),
    fee_amount: toNumber(row.fee_amount),
    payout_amount: row.payout_amount === null || row.payout_amount === undefined
      ? toNumber(row.amount)
      : toNumber(row.payout_amount),
    network: row.network,
    network_label: NETWORK_LABELS[row.network] || row.network,
    to_address: row.to_address,
    tx_hash: row.tx_hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
    confirmed_at: row.confirmed_at,
  };
}

function adminConfirmUrl(requestId, token) {
  return `${config.publicWebUrl}/admin/withdrawals/${encodeURIComponent(requestId)}/confirm?token=${encodeURIComponent(token)}`;
}

function adminConfirmCallbackData(requestId) {
  return `em_wd_confirm:${requestId}`;
}

async function sendAdminWithdrawalNotification(request, adminToken) {
  if (!config.telegramBotToken || !config.telegramAdminUserIds.length) {
    return;
  }

  const name = request.username
    ? `@${request.username}`
    : (request.first_name || `user ${request.telegram_id}`);
  const text = [
    `💸 Вывод USDT #${request.id}`,
    "",
    name,
    `Списано: ${request.amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} USDT`,
    `Комиссия: ${request.fee_amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} USDT`,
    `Отправить: ${request.payout_amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} USDT`,
    `Сеть: ${request.network_label}`,
    "",
    "Кошелек:",
    request.to_address,
  ].join("\n");
  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: "✅ Подтвердить вывод",
          callback_data: adminConfirmCallbackData(request.id),
        },
      ],
    ],
  };
  await Promise.allSettled(config.telegramAdminUserIds.map(async (chatId) => {
    const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      }),
    });
    if (!response.ok) {
      console.warn("[EasyMarket] withdrawal admin notify failed", {
        request_id: request.id,
        chat_id: chatId,
        status: response.status,
      });
    }
  }));
}

async function sendUserWithdrawalConfirmed(request) {
  if (!config.telegramBotToken || !request.telegram_id) {
    return;
  }

  const text = `Вывод ${request.payout_amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} USDT подтвержден. Комиссия: ${request.fee_amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} USDT.`;
  await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: request.telegram_id,
      text,
      disable_web_page_preview: true,
    }),
  }).catch(() => undefined);
}

export async function createUsdtWithdrawalRequest(input) {
  const withdrawal = calculateUsdtWithdrawalAmounts(input.amount);
  const { amount, fee, payout } = withdrawal;
  const network = normalizeNetwork(input.network);
  const toAddress = normalizeEvmAddress(input.to_address ?? input.toAddress ?? input.wallet);
  const adminToken = randomBytes(24).toString("hex");
  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });

  const result = await withTransaction(async (client) => {
    const depositResult = await client.query(
      `
        SELECT (
          EXISTS (
            SELECT 1
            FROM usdt_deposit_intents
            WHERE user_id = $1
              AND status = 'credited'
              AND COALESCE(credited_amount, 0) > 0
          )
          OR EXISTS (
            SELECT 1
            FROM usdt_ledger
            WHERE user_id = $1
              AND reason = 'usdt_onchain_deposit'
              AND amount > 0
          )
        ) AS unlocked
      `,
      [user.id],
    );
    if (depositResult.rows[0]?.unlocked !== true) {
      throw new Error("withdrawal_deposit_required");
    }

    const balanceResult = await client.query(
      "SELECT balance FROM usdt_balances WHERE user_id = $1 FOR UPDATE",
      [user.id],
    );
    const balance = toNumber(balanceResult.rows[0]?.balance);
    if (balance < amount) {
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
        VALUES ($1, -$2::numeric, 'usdt_withdrawal_pending', $3)
      `,
      [user.id, amount, `withdrawal:${network}`],
    );
    const requestResult = await client.query(
      `
        INSERT INTO usdt_withdrawal_requests (
          user_id,
          amount,
          fee_amount,
          payout_amount,
          network,
          to_address,
          admin_token
        )
        VALUES ($1, $2::numeric, $3::numeric, $4::numeric, $5, $6, $7)
        RETURNING *
      `,
      [user.id, amount, fee, payout, network, toAddress, adminToken],
    );
    const updatedBalanceResult = await client.query(
      "SELECT balance FROM usdt_balances WHERE user_id = $1",
      [user.id],
    );
    const bonusBalanceResult = await client.query(
      "SELECT balance FROM usdt_bonus_balances WHERE user_id = $1",
      [user.id],
    );
    const cashBalance = toNumber(updatedBalanceResult.rows[0]?.balance);
    const bonusBalance = toNumber(bonusBalanceResult.rows[0]?.balance);

    return {
      request: {
        ...mapWithdrawal({
          ...requestResult.rows[0],
          telegram_id: user.telegram_id,
          username: user.username,
          first_name: user.first_name,
        }),
      },
      cash_balance: cashBalance,
      bonus_balance: bonusBalance,
      balance: cashBalance + bonusBalance,
    };
  });

  void sendAdminWithdrawalNotification(result.request, adminToken);
  return result;
}

export async function getUserWithdrawals(telegramId, limit = 20) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    return [];
  }

  const result = await query(
    `
      SELECT
        requests.*,
        users.telegram_id,
        users.username,
        users.first_name
      FROM usdt_withdrawal_requests requests
      JOIN users ON users.id = requests.user_id
      WHERE requests.user_id = $1
      ORDER BY requests.created_at DESC
      LIMIT $2
    `,
    [user.id, Math.max(1, Math.min(80, Number(limit) || 20))],
  );

  return result.rows.map(mapWithdrawal);
}

export async function getPendingUsdtWithdrawals(limit = 30) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const result = await query(
    `
      SELECT
        requests.*,
        users.telegram_id,
        users.username,
        users.first_name
      FROM usdt_withdrawal_requests requests
      JOIN users ON users.id = requests.user_id
      WHERE requests.status = 'pending'
      ORDER BY requests.created_at ASC
      LIMIT $1
    `,
    [safeLimit],
  );

  return result.rows.map(mapWithdrawal);
}

export async function getWalletHistory(telegramId, limit = 30) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const result = await query(
    `
      SELECT *
      FROM (
        SELECT
          ('deposit:' || intents.id::text) AS event_id,
          intents.id,
          'deposit' AS type,
          intents.status,
          intents.deposit_amount AS amount,
          0::numeric AS fee_amount,
          intents.deposit_amount AS payout_amount,
          intents.network,
          intents.to_address AS address,
          intents.tx_hash,
          intents.created_at,
          intents.updated_at
        FROM usdt_deposit_intents intents
        WHERE intents.user_id = $1

        UNION ALL

        SELECT
          ('withdrawal:' || requests.id::text) AS event_id,
          requests.id,
          'withdrawal' AS type,
          requests.status,
          requests.amount,
          requests.fee_amount,
          requests.payout_amount,
          requests.network,
          requests.to_address AS address,
          requests.tx_hash,
          requests.created_at,
          requests.updated_at
        FROM usdt_withdrawal_requests requests
        WHERE requests.user_id = $1
      ) history
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [user.id, safeLimit],
  );

  return result.rows.map((row) => ({
    event_id: row.event_id,
    id: Number(row.id),
    type: row.type,
    currency: "USDT",
    status: row.status,
    amount: toNumber(row.amount),
    fee_amount: toNumber(row.fee_amount),
    payout_amount: toNumber(row.payout_amount),
    network: row.network,
    network_label: NETWORK_LABELS[row.network] || row.network,
    address: row.address,
    tx_hash: row.tx_hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export async function confirmUsdtWithdrawalRequest(input) {
  const requestId = Number(input.requestId);
  const token = String(input.token || "").trim();
  if (!Number.isSafeInteger(requestId) || requestId <= 0 || !token) {
    throw new Error("withdrawal_not_found");
  }

  const request = await withTransaction(async (client) => {
    const requestResult = await client.query(
      `
        SELECT
          requests.*,
          users.telegram_id,
          users.username,
          users.first_name
        FROM usdt_withdrawal_requests requests
        JOIN users ON users.id = requests.user_id
        WHERE requests.id = $1
          AND requests.admin_token = $2
        FOR UPDATE
      `,
      [requestId, token],
    );
    const row = requestResult.rows[0];
    if (!row) {
      throw new Error("withdrawal_not_found");
    }
    if (row.status !== "pending") {
      if (row.status !== "completed") {
        throw new Error("withdrawal_not_pending");
      }
      return mapWithdrawal(row);
    }

    const updateResult = await client.query(
      `
        UPDATE usdt_withdrawal_requests
        SET status = 'completed',
            updated_at = now(),
            confirmed_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [requestId],
    );

    return mapWithdrawal({
      ...updateResult.rows[0],
      telegram_id: row.telegram_id,
      username: row.username,
      first_name: row.first_name,
    });
  });

  void sendUserWithdrawalConfirmed(request);
  return request;
}

export async function confirmUsdtWithdrawalRequestByBridge(input) {
  const requestId = Number(input.requestId);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    throw new Error("withdrawal_not_found");
  }

  const request = await withTransaction(async (client) => {
    const requestResult = await client.query(
      `
        SELECT
          requests.*,
          users.telegram_id,
          users.username,
          users.first_name
        FROM usdt_withdrawal_requests requests
        JOIN users ON users.id = requests.user_id
        WHERE requests.id = $1
        FOR UPDATE
      `,
      [requestId],
    );
    const row = requestResult.rows[0];
    if (!row) {
      throw new Error("withdrawal_not_found");
    }
    if (row.status !== "pending") {
      if (row.status !== "completed") {
        throw new Error("withdrawal_not_pending");
      }
      return mapWithdrawal(row);
    }

    const updateResult = await client.query(
      `
        UPDATE usdt_withdrawal_requests
        SET status = 'completed',
            updated_at = now(),
            confirmed_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [requestId],
    );

    return mapWithdrawal({
      ...updateResult.rows[0],
      telegram_id: row.telegram_id,
      username: row.username,
      first_name: row.first_name,
    });
  });

  void sendUserWithdrawalConfirmed(request);
  return request;
}
