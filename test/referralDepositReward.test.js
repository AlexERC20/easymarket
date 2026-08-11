import assert from "node:assert/strict";
import test from "node:test";

import {
  awardReferralDepositReward,
  revokePendingReferralDepositRewardsForWithdrawal,
  splitReferralDepositReward,
  unlockReferralDepositRewardAfterCashBet,
} from "../src/services/marketService.js";

test("referral deposit reward is split into two cent-safe halves", () => {
  assert.deepEqual(splitReferralDepositReward(30), {
    total: 30,
    immediate: 15,
    pending: 15,
  });
  assert.deepEqual(splitReferralDepositReward(30.01), {
    total: 30.01,
    immediate: 15.01,
    pending: 15,
  });
});

test("referral deposit reward clamps invalid negative configuration", () => {
  assert.deepEqual(splitReferralDepositReward(-10), {
    total: 0,
    immediate: 0,
    pending: 0,
  });
});

test("confirmed deposit credits only the immediate half and is idempotent", async () => {
  const bonusLedger = [];
  let rewardInserted = false;
  const client = {
    async query(sql, params = []) {
      if (sql.includes("FROM usdt_deposit_intents")) {
        return { rows: [{ id: 77, user_id: 2, credited_amount: "18" }] };
      }
      if (sql.includes("SELECT * FROM users WHERE id")) {
        return { rows: [{ id: 2, telegram_id: "200", referred_by_telegram_id: "100" }] };
      }
      if (sql.includes("SELECT * FROM users WHERE telegram_id")) {
        return { rows: [{ id: 1, telegram_id: "100" }] };
      }
      if (sql.includes("INSERT INTO usdt_referral_deposit_rewards")) {
        if (rewardInserted) return { rows: [] };
        rewardInserted = true;
        return { rows: [{ id: 9, deposit_intent_id: 77, inviter_user_id: 1, referred_user_id: 2 }] };
      }
      if (sql.includes("SELECT id, clawback_outstanding")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO usdt_bonus_ledger")) {
        bonusLedger.push({ amount: params[1], reason: params[2], source: params[3] });
        return { rows: [] };
      }
      if (sql.includes("immediate_credited =")) {
        return { rows: [{ id: 9, immediate_credited: params[1], immediate_debt_offset: params[2] }] };
      }
      return { rows: [] };
    },
  };

  const first = await awardReferralDepositReward(client, { depositIntentId: 77 });
  const duplicate = await awardReferralDepositReward(client, { depositIntentId: 77 });

  assert.equal(first.immediate_credited, 15);
  assert.equal(duplicate, null);
  assert.deepEqual(bonusLedger, [{
    amount: 15,
    reason: "referral_deposit_bonus_usdt",
    source: "referral_deposit:77:immediate",
  }]);
});

test("a later referral reward first repays outstanding clawback debt", async () => {
  const bonusLedger = [];
  const debtUpdates = [];
  const client = {
    async query(sql, params = []) {
      if (sql.includes("FROM usdt_deposit_intents")) {
        return { rows: [{ id: 78, user_id: 2, credited_amount: "18" }] };
      }
      if (sql.includes("SELECT * FROM users WHERE id")) {
        return { rows: [{ id: 2, telegram_id: "200", referred_by_telegram_id: "100" }] };
      }
      if (sql.includes("SELECT * FROM users WHERE telegram_id")) {
        return { rows: [{ id: 1, telegram_id: "100" }] };
      }
      if (sql.includes("INSERT INTO usdt_referral_deposit_rewards")) {
        return { rows: [{ id: 10, deposit_intent_id: 78, inviter_user_id: 1, referred_user_id: 2 }] };
      }
      if (sql.includes("SELECT id, clawback_outstanding")) {
        return { rows: [{ id: 3, clawback_outstanding: "10" }] };
      }
      if (sql.includes("SET clawback_outstanding = GREATEST")) {
        debtUpdates.push({ id: params[0], amount: params[1] });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO usdt_bonus_ledger")) {
        bonusLedger.push({ amount: params[1], reason: params[2] });
        return { rows: [] };
      }
      if (sql.includes("immediate_credited =")) {
        return { rows: [{ id: 10, immediate_credited: params[1], immediate_debt_offset: params[2] }] };
      }
      return { rows: [] };
    },
  };

  const result = await awardReferralDepositReward(client, { depositIntentId: 78 });

  assert.equal(result.immediate_credited, 5);
  assert.equal(result.immediate_debt_offset, 10);
  assert.deepEqual(debtUpdates, [{ id: 3, amount: 10 }]);
  assert.deepEqual(bonusLedger, [{ amount: 5, reason: "referral_deposit_bonus_usdt" }]);
});

test("one executed cash-bet event unlocks one pending half only once", async () => {
  let eventInserted = false;
  const bonusLedger = [];
  const reward = {
    id: 9,
    deposit_intent_id: 77,
    inviter_user_id: 1,
    referred_user_id: 2,
    pending_amount: "15",
    status: "pending_bet",
  };
  const client = {
    async query(sql, params = []) {
      if (sql.includes("WHERE referred_user_id") && sql.includes("status = 'pending_bet'")) {
        return { rows: [reward] };
      }
      if (sql.includes("INSERT INTO usdt_referral_cash_bet_events")) {
        if (eventInserted) return { rows: [] };
        eventInserted = true;
        return { rows: [{ event_key: params[0] }] };
      }
      if (sql.includes("SELECT id, clawback_outstanding")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO usdt_bonus_ledger")) {
        bonusLedger.push({ amount: params[1], reason: params[2] });
        return { rows: [] };
      }
      if (sql.includes("SET status = 'unlocked'")) {
        return { rows: [{ ...reward, status: "unlocked", pending_credited: params[1] }] };
      }
      return { rows: [] };
    },
  };

  const input = { referredUserId: 2, eventKey: "clob_market_buy:501", marketId: 12, tradeId: 501 };
  const first = await unlockReferralDepositRewardAfterCashBet(client, input);
  const duplicate = await unlockReferralDepositRewardAfterCashBet(client, input);

  assert.equal(first.status, "unlocked");
  assert.equal(duplicate, null);
  assert.deepEqual(bonusLedger, [{ amount: 15, reason: "referral_deposit_bet_bonus_usdt" }]);
});

test("withdrawal revokes a pending cycle without making inviter balance negative", async () => {
  const bonusLedger = [];
  const reward = {
    id: 9,
    deposit_intent_id: 77,
    inviter_user_id: 1,
    referred_user_id: 2,
    deposit_amount: "18",
    immediate_credited: "15",
    immediate_debt_offset: "0",
    pending_credited: "0",
    pending_debt_offset: "0",
    status: "pending_bet",
  };
  const client = {
    async query(sql, params = []) {
      if (sql.includes("WHERE referred_user_id") && sql.includes("status = 'pending_bet'")) {
        return { rows: [reward] };
      }
      if (sql.includes("SELECT balance FROM usdt_bonus_balances")) {
        return { rows: [{ balance: "4" }] };
      }
      if (sql.includes("INSERT INTO usdt_bonus_ledger")) {
        bonusLedger.push({ amount: params[1], reason: params[2] });
        return { rows: [] };
      }
      if (sql.includes("SET status = 'revoked'")) {
        return { rows: [{ ...reward, status: "revoked", clawback_recovered: params[2], clawback_outstanding: params[3] }] };
      }
      return { rows: [] };
    },
  };

  const result = await revokePendingReferralDepositRewardsForWithdrawal(client, {
    referredUserId: 2,
    withdrawalRequestId: 88,
    amount: 18,
  });

  assert.deepEqual(result, { revoked: 1, recovered: 4, outstanding: 11 });
  assert.deepEqual(bonusLedger, [{ amount: -4, reason: "referral_deposit_bonus_revoke" }]);
});
