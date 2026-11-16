// tests/video/video-credits.test.ts
// The price of a video, the plan sizes read from secrets, and the reading of
// the database's credit answer. Pure code, nothing faked.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FREE_MONTHLY_CREDITS,
  DEFAULT_PRO_MONTHLY_CREDITS,
  buildCreditStatus,
  creditsFor,
  monthStartUtc,
  nextMonthStartUtc,
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

test("the month is the UTC month, the same one the database counts in", () => {
  assert.equal(monthStartUtc(Date.UTC(2026, 10, 16, 12)), "2026-11-01");
  assert.equal(monthStartUtc(Date.UTC(2026, 10, 30, 23, 59, 59)), "2026-11-01");
  assert.equal(monthStartUtc(Date.UTC(2027, 0, 1, 0, 0, 0)), "2027-01-01");
  assert.equal(nextMonthStartUtc(Date.UTC(2026, 10, 16)), "2026-12-01T00:00:00.000Z");
  assert.equal(nextMonthStartUtc(Date.UTC(2026, 11, 31, 23, 59)), "2027-01-01T00:00:00.000Z");
});

test("the credit status shows what is left and when it starts again", () => {
  const limits = { free: 20, pro: 300 };
  const now = Date.UTC(2026, 10, 16);
  assert.deepEqual(buildCreditStatus("free", 10, limits, now), {
    plan: "free",
    used: 10,
    quota: 20,
    remaining: 10,
    resetsAt: "2026-12-01T00:00:00.000Z",
  });
  const pro = buildCreditStatus("pro", 50, limits, now);
  assert.equal(pro.quota, 300);
  assert.equal(pro.remaining, 250);
});

test("the credit status never goes below zero and never trusts a bad count", () => {
  const limits = { free: 20, pro: 300 };
  const now = Date.UTC(2026, 10, 16);
  assert.equal(buildCreditStatus("free", 35, limits, now).remaining, 0);
  for (const bad of [undefined, null, "x", -3, 1.5, Number.NaN]) {
    const status = buildCreditStatus("free", bad, limits, now);
    assert.equal(status.used, 0);
    assert.equal(status.remaining, 20);
  }
});

// end of video-credits.test.ts
