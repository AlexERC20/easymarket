import assert from "node:assert/strict";
import test from "node:test";

import { getInactivityBurnTransition } from "../src/services/inactivityMath.js";

test("a final inactivity wipe stays terminal until activity resets the stage", () => {
  assert.equal(getInactivityBurnTransition(3, 3), null);
  assert.equal(getInactivityBurnTransition(3, 30), null);
});

test("a reset activity stage can start one new inactivity cycle", () => {
  assert.deepEqual(getInactivityBurnTransition(0, 3), {
    targetStage: 3,
    isFinal: true,
  });
});

test("staged inactivity burns advance once per threshold", () => {
  assert.deepEqual(getInactivityBurnTransition(0, 1), {
    targetStage: 1,
    isFinal: false,
  });
  assert.deepEqual(getInactivityBurnTransition(1, 2), {
    targetStage: 2,
    isFinal: false,
  });
  assert.equal(getInactivityBurnTransition(2, 2), null);
});
