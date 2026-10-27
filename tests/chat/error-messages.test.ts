// tests/chat/error-messages.test.ts
// Every chat error shows a real Persian message, and the limit message does
// not look like a temporary fault (the user must not keep pressing "retry").

import test from "node:test";
import assert from "node:assert/strict";

import { CHAT_ERROR_MESSAGES } from "../../src/features/chat/errorMessages.ts";

const PERSIAN_LETTER = /[\u0600-\u06FF]/;

test("every chat error has a non-empty Persian message", () => {
  const entries = Object.entries(CHAT_ERROR_MESSAGES);

  assert.ok(entries.length >= 8);

  for (const [code, message] of entries) {
    assert.ok(message.trim().length > 0, `${code} has no message`);
    assert.ok(PERSIAN_LETTER.test(message), `${code} is not Persian`);
  }
});

test("the limit message says the daily limit is finished, not that something broke", () => {
  const message = CHAT_ERROR_MESSAGES.QUOTA_EXCEEDED;

  assert.match(message, /سقف/);
  assert.doesNotMatch(message, /تلاش کنید/);
});
