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
import { getUserByTelegramId, upsertUser } from "./marketService.js";

const TRANSFER_TOPIC = id("Transfer(address,address,uint256)");
const TRANSFER_IFACE = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const MAX_BLOCK_RANGE = 1800;

let providerCache = new Map();

function roundMoney(value, decimals = 2) {
  const multiplier = 10 ** decimals;
  return Math.round(Number(value || 0) * multiplier) / multiplier;
}

function ensurePositiveDepositAmount(value) {
  const amount = roundMoney(value, 2);
  if (!Number.isFinite(amount) || amount < 1 || amount > 100_000) {
    throw new Error("invalid_deposit_amount");
  }
  return amount;
}

function normalizeNetwork(value) {
  const network = String(value || "BSC").trim().toUpperCase();
  if (network === "BEP20") {
    return "BSC";
  }
  if (network === "ERC20") {
    return "ETH";
  }
  return network;
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
  if (!treasuryAddress || !tokenAddress || !input.rpcUrl) {
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
  };
}

export function getConfiguredUsdtDepositNetworks() {
  return [
    buildEvmNetwork({
      key: "BSC",
      label: "BEP20",
      rpcUrl: config.usdtBscRpcUrl,
      tokenAddress: config.usdtBscTokenAddress,
      decimals: config.usdtBscDecimals,
    }),
    buildEvmNetwork({
      key: "ETH",
      label: "ERC20",
      rpcUrl: config.usdtEthRpcUrl,
      tokenAddress: config.usdtEthTokenAddress,
      decimals: config.usdtEthDecimals,
    }),
  ].filter(Boolean);
}

export function getPublicUsdtDepositNetworks() {
  return getConfiguredUsdtDepositNetworks().map((network) => ({
    key: network.key,
    label: network.label,
    address: network.treasuryAddress,
    token_address: network.tokenAddress,
    confirmations: network.confirmations,
  }));
}

function getNetworkOrThrow(value) {
  const networkKey = normalizeNetwork(value);
  const network = getConfiguredUsdtDepositNetworks().find((item) => item.key === networkKey);
  if (!network) {
    throw new Error("invalid_deposit_network");
  }
  return network;
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
  return {
    id: Number(row.id),
    network: row.network,
    network_label: network?.label || row.network,
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

export async function expirePendingDepositIntents() {
  await query(
    `
      UPDATE usdt_deposit_intents
      SET status = 'expired',
          updated_at = now()
      WHERE status = 'pending'
        AND expires_at < now()
    `,
  );
}

export async function createUsdtDepositIntent(input) {
  const network = getNetworkOrThrow(input.network);
  const requestedAmount = ensurePositiveDepositAmount(input.amount);
  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });

  const intent = await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE usdt_deposit_intents
        SET status = 'expired',
            updated_at = now()
        WHERE user_id = $1
          AND status = 'pending'
          AND expires_at < now()
      `,
      [user.id],
    );

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const cents = randomInt(1, 99) / 100;
      const depositAmount = roundMoney(requestedAmount + cents, 2);
      const existsResult = await client.query(
        `
          SELECT id
          FROM usdt_deposit_intents
          WHERE network = $1
            AND status = 'pending'
            AND deposit_amount = $2::numeric
          LIMIT 1
        `,
        [network.key, depositAmount],
      );
      if (existsResult.rows[0]) {
        continue;
      }

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
            $2,
            $3::numeric,
            $4::numeric,
            $5,
            now() + ($6::int * interval '1 minute')
          )
          RETURNING *
        `,
        [
          user.id,
          network.key,
          requestedAmount,
          depositAmount,
          network.treasuryAddress,
          Math.round(config.usdtDepositIntentMinutes),
        ],
      );
      return result.rows[0];
    }

    throw new Error("deposit_amount_collision");
  });

  return {
    user,
    intent: mapDepositIntent(intent),
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
    block = await provider.getBlock(log.blockNumber);
    blockCache.set(log.blockNumber, block);
  }
  const chainTimestamp = block?.timestamp
    ? new Date(Number(block.timestamp) * 1000)
    : new Date();
  const logIndex = Number(log.index ?? log.logIndex ?? 0);
  const txHash = String(log.transactionHash);
  const confirmations = Math.max(0, Number(blockCache.latestBlock || log.blockNumber) - Number(log.blockNumber) + 1);

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
        ON CONFLICT (network, tx_hash, log_index) DO NOTHING
        RETURNING *
      `,
      [
        network.key,
        txHash,
        logIndex,
        log.blockNumber,
        fromAddress,
        toAddress,
        amount,
        chainTimestamp,
      ],
    );

    if (!eventResult.rows[0]) {
      return;
    }

    const intentResult = await client.query(
      `
        SELECT *
        FROM usdt_deposit_intents
        WHERE network = $1
          AND status = 'pending'
          AND deposit_amount = $2::numeric
          AND created_at <= $3
          AND expires_at >= $3
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE
      `,
      [network.key, amount, chainTimestamp],
    );
    const intent = intentResult.rows[0];
    if (!intent) {
      await client.query(
        `
          UPDATE usdt_deposit_events
          SET status = 'unmatched'
          WHERE network = $1
            AND tx_hash = $2
            AND log_index = $3
        `,
        [network.key, txHash, logIndex],
      );
      return;
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
      [intent.user_id, amount, `${network.key}:${txHash}:${logIndex}`],
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
        amount,
        fromAddress,
        txHash,
        logIndex,
        log.blockNumber,
        confirmations,
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
      [network.key, txHash, logIndex, intent.id],
    );
  });
}

async function scanNetwork(network) {
  const provider = getProvider(network);
  const latestBlock = await provider.getBlockNumber();
  const safeToBlock = latestBlock - network.confirmations;
  if (safeToBlock <= 0) {
    return { network: network.key, scanned: 0 };
  }

  const previousBlock = await getScannerState(network);
  const effectivePreviousBlock = previousBlock || Math.max(0, safeToBlock - 300);
  const fromBlock = effectivePreviousBlock + 1;
  const toBlock = Math.min(safeToBlock, effectivePreviousBlock + MAX_BLOCK_RANGE);
  if (fromBlock > toBlock) {
    return { network: network.key, scanned: 0, latestBlock };
  }

  const blockCache = new Map();
  blockCache.latestBlock = latestBlock;
  const logs = await provider.getLogs({
    address: network.tokenAddress,
    fromBlock,
    toBlock,
    topics: [
      TRANSFER_TOPIC,
      null,
      zeroPadValue(network.treasuryAddress, 32),
    ],
  });

  for (const log of logs) {
    await processDepositLog(network, log, provider, blockCache);
  }

  await setScannerState(network, toBlock);
  return {
    network: network.key,
    fromBlock,
    toBlock,
    logs: logs.length,
    latestBlock,
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
      });
    }
  }

  return {
    ok: true,
    enabled: true,
    results,
  };
}
