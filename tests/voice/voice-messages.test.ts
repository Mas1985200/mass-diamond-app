// tests/voice/voice-messages.test.ts
// The recording time is shown in Persian digits and a wrong value never shows
// nonsense. Every error code has a readable message. Pure code, nothing faked.

import test from "node:test";
import assert from "node:assert/strict";

import {
  formatRecordTime,
  VOICE_ERROR_MESSAGES,
  VOICE_LABELS,
} from "../../src/features/voice/voiceMessages.ts";

test("the recording time shows minutes and two-digit seconds", () => {
  assert.equal(formatRecordTime(0), "۰:۰۰");
  assert.equal(formatRecordTime(5), "۰:۰۵");
  assert.equal(formatRecordTime(59), "۰:۵۹");
  assert.equal(formatRecordTime(60), "۱:۰۰");
  assert.equal(formatRecordTime(65), "۱:۰۵");
});

test("a fraction is cut and a wrong value shows as zero", () => {
  assert.equal(formatRecordTime(5.9), "۰:۰۵");
  assert.equal(formatRecordTime(-4), "۰:۰۰");
  assert.equal(formatRecordTime(Number.NaN), "۰:۰۰");
  assert.equal(formatRecordTime(Number.POSITIVE_INFINITY), "۰:۰۰");
});

test("every error code has a non-empty message", () => {
  const codes = Object.keys(VOICE_ERROR_MESSAGES);

  assert.equal(codes.length, 8);

  for (const code of codes) {
    const message = VOICE_ERROR_MESSAGES[code as keyof typeof VOICE_ERROR_MESSAGES];

    assert.ok(message.trim().length > 0, code);
  }
});

test("every label is a non-empty text", () => {
  for (const [name, label] of Object.entries(VOICE_LABELS)) {
    assert.ok(label.trim().length > 0, name);
  }
});
