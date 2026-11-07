// tests/video/video-credits.test.ts
// The price of a video, the plan sizes read from secrets, and the reading of
// the database's credit answer. Pure code, nothing faked.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FREE_MONTHLY_CREDITS,
  DEFAULT_PRO_MONTHLY_CREDITS,
  creditsFor,
  parseCreditDecision,
  parseLimit,
  readVideoLimits,
} from "../../supabase/functions/video-engine/credits.ts";

test("a video costs whole credits that grow with length and quality", () => {
  assert.equal(creditsFor(5, "draft"), 5);
  assert.equal(creditsFor(5, "standard"), 10);
  assert.equal(creditsFor(5, "high"), 15);
  assert.equal(creditsFor(3, "standard"), 6);
  assert.ok(creditsFor(5, "high") > creditsFor(5, "standard"));
  assert.ok(creditsFor(5, "standard") > creditsFor(5, "draft"));
});

test("odd lengths still give a whole price of at least one second", () => {
  assert.equal(creditsFor(2.2, "standard"), 6);
  assert.equal(creditsFor(0, "draft"), 1);
  assert.equal(creditsFor(-4, "draft"), 1);
  assert.equal(creditsFor(Number.NaN, "high"), 3);
  assert.equal(creditsFor(Number.POSITIVE_INFINITY, "high"), 3);
});

test("plan sizes come from secrets; a typo falls back to the default", () => {
  assert.equal(parseLimit("50", 7), 50);
  assert.equal(parseLimit(" 50 ", 7), 50);
  assert.equal(parseLimit("fifty", 7), 7);
  assert.equal(parseLimit("-5", 7), 7);
  assert.equal(parseLimit("1.5", 7), 7);
  assert.equal(parseLimit("99999999999", 7), 7);
  assert.equal(parseLimit(undefined, 7), 7);
  assert.deepEqual(readVideoLimits(() => undefined), {
    free: DEFAULT_FREE_MONTHLY_CREDITS,
    pro: DEFAULT_PRO_MONTHLY_CREDITS,
  });
  const env: Record<string, string> = {
    VIDEO_FREE_MONTHLY_CREDITS: "40",
    VIDEO_PRO_MONTHLY_CREDITS: "900",
  };
  assert.deepEqual(readVideoLimits((name) => env[name]), { free: 40, pro: 900 });
});

test("the database answer is read as a list of one row, or as unknown", () => {
  const row = { allowed: true, used: 10, quota: 20, plan: "free" };
  assert.deepEqual(parseCreditDecision([row]), row);
  assert.deepEqual(parseCreditDecision(row), row);
  assert.equal(parseCreditDecision(null), null);
  assert.equal(parseCreditDecision([]), null);
  assert.equal(parseCreditDecision([{ ...row, plan: "gold" }]), null);
  assert.equal(parseCreditDecision([{ ...row, used: -1 }]), null);
  assert.equal(parseCreditDecision([{ ...row, allowed: "yes" }]), null);
});
