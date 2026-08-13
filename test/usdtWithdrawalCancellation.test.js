import assert from "node:assert/strict";
import test from "node:test";

import { cancelPendingUsdtWithdrawal } from "../src/services/usdtWithdrawalService.js";

function createClient(status = "pending") {
  let cashBalance = 2;
  const ledger = [];
  const request = {
    id: 42,
    user_id: 7,
    telegram_id: "700",
    username: "tester",
    first_name: "Test",
    status,
    amount: "18",
    fee_amount: "3",
    payout_amount: "15",
    network: "BSC",
    to_address: "0x1111111111111111111111111111111111111111",
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
  };

  return {
    ledger,
    get cashBalance() {
      return cashBalance;
    },
    async query(sql, params = []) {
      if (sql.includes("FROM usdt_withdrawal_requests requests")) {
        return { rows: [{ ...request }] };
      }
      if (sql.includes("UPDATE usdt_withdrawal_requests")) {
        request.status = "cancelled";
        request.cancelled_at = "2026-08-13T00:01:00.000Z";
        request.admin_telegram_id = params[1];
        request.admin_username = params[2];
        return { rows: [{ ...request }] };
      }
      if (sql.includes("UPDATE usdt_balances")) {
        cashBalance += Number(params[1]);
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO usdt_ledger")) {
        ledger.push({
          userId: params[0],
          amount: Number(params[1]),
          reason: "usdt_withdrawal_cancelled",
          source: params[2],
        });
        return { rows: [] };
      }
      if (sql.includes("SELECT balance FROM usdt_balances")) {
        return { rows: [{ balance: cashBalance }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("cancelling a pending withdrawal returns the full debited amount once", async () => {
  const client = createClient();
  const first = await cancelPendingUsdtWithdrawal(client, {
    requestId: 42,
    adminTelegramId: "100",
    adminUsername: "admin",
  });

  assert.equal(first.request.status, "cancelled");
  assert.equal(first.request.amount, 18);
  assert.equal(first.cash_balance, 20);
  assert.equal(first.refunded, true);
  assert.deepEqual(client.ledger, [{
    userId: 7,
    amount: 18,
    reason: "usdt_withdrawal_cancelled",
    source: "withdrawal:42:cancel",
  }]);

  const duplicate = await cancelPendingUsdtWithdrawal(client, { requestId: 42 });
  assert.equal(duplicate.request.status, "cancelled");
  assert.equal(duplicate.cash_balance, 20);
  assert.equal(duplicate.refunded, false);
  assert.equal(client.ledger.length, 1);
});

test("a completed withdrawal cannot be cancelled", async () => {
  const client = createClient("completed");
  await assert.rejects(
    cancelPendingUsdtWithdrawal(client, { requestId: 42 }),
    /withdrawal_not_pending/,
  );
  assert.equal(client.cashBalance, 2);
  assert.equal(client.ledger.length, 0);
});
