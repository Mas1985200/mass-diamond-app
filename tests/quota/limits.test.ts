// tests/quota/limits.test.ts
// The daily limits come from secrets; a bad value falls back to the default,
// and the database answer is accepted only in the exact shape expected.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FREE_DAILY_MESSAGES,
  DEFAULT_PRO_DAILY_MESSAGES,
  parseDecision,
  parseLimit,
  readLimits,
} from "../../supabase/functions/ai-chat/quota/limits.ts";

test("parseLimit: a whole number is used (spaces around it are fine)", () => {
  assert.equal(parseLimit("30", 20), 30);
  assert.equal(parseLimit(" 45 ", 20), 45);
  assert.equal(parseLimit("0", 20), 0);
});

test("parseLimit: anything else falls back to the default", () => {
  assert.equal(parseLimit(undefined, 20), 20);
  assert.equal(parseLimit("", 20), 20);
  assert.equal(parseLimit("abc", 20), 20);
  assert.equal(parseLimit("-5", 20), 20);
  assert.equal(parseLimit("2.5", 20), 20);
  assert.equal(parseLimit("1e3", 20), 20);
  assert.equal(parseLimit("999999999", 20), 20);
});

test("readLimits: reads both secrets and uses defaults when missing", () => {
  const set = readLimits((name) =>
    name === "AI_FREE_DAILY_MESSAGES"
      ? "10"
      : name === "AI_PRO_DAILY_MESSAGES"
        ? "800"
        : undefined,
  );

  assert.deepEqual(set, { free: 10, pro: 800 });

  assert.deepEqual(readLimits(() => undefined), {
    free: DEFAULT_FREE_DAILY_MESSAGES,
    pro: DEFAULT_PRO_DAILY_MESSAGES,
  });
});

test("parseDecision: accepts the one-row list the database returns", () => {
  assert.deepEqual(
    parseDecision([{ allowed: true, used: 3, quota: 20, plan: "free" }]),
    { allowed: true, used: 3, quota: 20, plan: "free" },
  );

  assert.deepEqual(
    parseDecision({ allowed: false, used: 20, quota: 20, plan: "free" }),
    { allowed: false, used: 20, quota: 20, plan: "free" },
  );
});

test("parseDecision: a wrong shape is unknown, never a guess", () => {
  assert.equal(parseDecision(null), null);
  assert.equal(parseDecision([]), null);
  assert.equal(parseDecision("yes"), null);
  assert.equal(parseDecision([{ allowed: "true", used: 1, quota: 2, plan: "free" }]), null);
  assert.equal(parseDecision([{ allowed: true, used: -1, quota: 2, plan: "free" }]), null);
  assert.equal(parseDecision([{ allowed: true, used: 1, quota: 2, plan: "gold" }]), null);
});
