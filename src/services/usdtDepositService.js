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
const RECENT_UNMATCHED_LIMIT = 200;

let providerCache = new Map();
let backfillLastRunAt = new Map();

function roundMoney(value, decimals = 2) {
  const multiplier = 10 ** decimals;
  return Math.round(Number(value || 0) * multiplier) / multiplier;
}

function ensurePositiveDepositAmount(value) {
  const amount = roundMoney(value, 2);
  if (!Number.isFinite(amount) || amount < 15 || amount > 100_000) {
    throw new Error("invalid_deposit_amount");
  }
  return amount;
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
  const networks = getConfiguredUsdtDepositNetworks();
  const network = networks[0];
  if (!network) {
    throw new Error("invalid_deposit_network");
  }
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
          WHERE status = 'pending'
            AND deposit_amount = $1::numeric
            AND network = ANY($2::text[])
          LIMIT 1
        `,
        [depositAmount, ["ANY", ...networks.map((item) => item.key)]],
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
            'ANY',
            $2::numeric,
            $3::numeric,
            $4,
            now() + ($5::int * interval '1 minute')
          )
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
    return await provider.getLogs({
      address: network.tokenAddress,
      fromBlock,
      toBlock,
      topics: [
        TRANSFER_TOPIC,
        null,
        zeroPadValue(network.treasuryAddress, 32),
      ],
    });
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

async function matchDepositEvent(client, network, event) {
  if (!event || event.status === "credited") {
    return false;
  }

  const intentResult = await client.query(
    `
      SELECT *
      FROM usdt_deposit_intents
      WHERE network = ANY($1::text[])
        AND status = ANY($5::text[])
        AND deposit_amount = $2::numeric
        AND created_at <= ($3::timestamptz + ($6::int * interval '1 minute'))
        AND expires_at >= ($3::timestamptz - ($6::int * interval '1 minute'))
      ORDER BY
        CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
        CASE WHEN network = $4 THEN 0 ELSE 1 END,
        created_at ASC
      LIMIT 1
      FOR UPDATE
    `,
    [
      [network.key, "ANY"],
      event.amount,
      event.chain_timestamp || new Date(),
      network.key,
      ["pending", "expired"],
      Math.round(config.usdtDepositMatchGraceMinutes),
    ],
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
          AND status <> 'credited'
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
    block = await provider.getBlock(log.blockNumber);
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

function canUseBscScan(network) {
  return network.key === "BSC"
    && Boolean(config.bscScanApiKey)
    && Boolean(config.bscScanApiUrl);
}

function getBscScanTransferAmount(tx, fallbackDecimals) {
  const decimals = Number(tx.tokenDecimal ?? fallbackDecimals);
  const rawValue = BigInt(String(tx.value || "0"));
  return roundMoney(formatUnits(rawValue, Number.isFinite(decimals) ? decimals : fallbackDecimals), 2);
}

async function scanBscScanNetwork(network) {
  if (!canUseBscScan(network)) {
    return {
      enabled: false,
      reason: "missing_api_key",
    };
  }

  const params = new URLSearchParams({
    chainid: config.bscScanChainId,
    module: "account",
    action: "tokentx",
    contractaddress: network.tokenAddress,
    address: network.treasuryAddress,
    page: "1",
    offset: String(Math.round(config.bscScanPageSize)),
    sort: "desc",
    apikey: config.bscScanApiKey,
  });

  const response = await fetch(`${config.bscScanApiUrl}?${params.toString()}`, {
    headers: {
      accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`bscscan_http_${response.status}`);
  }
  if (!payload || (payload.status === "0" && payload.message !== "No transactions found")) {
    throw new Error(payload?.result || payload?.message || "bscscan_error");
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
      amount: getBscScanTransferAmount(tx, network.decimals),
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
    explorer = await scanBscScanNetwork(network);
  } catch (error) {
    explorer = {
      enabled: true,
      error: "scan_failed",
      message: error instanceof Error ? error.message : "unknown",
    };
  }

  const provider = getProvider(network);
  let latestBlock;
  try {
    latestBlock = await provider.getBlockNumber();
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
  const logs = await getTransferLogs(provider, network, fromBlock, toBlock);

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
      });
    }
  }

  return {
    ok: true,
    enabled: true,
    results,
  };
}
