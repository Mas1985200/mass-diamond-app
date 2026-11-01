// tests/chat/text-direction.test.ts
// Chat text runs the way its own language runs, in every script, and a reply
// in a foreign script never shows Persian or Arabic digits.

import test from "node:test";
import assert from "node:assert/strict";

import {
  detectDirection,
  westernDigitsForForeignText,
} from "../../src/features/chat/textDirection.ts";

test("right-to-left scripts run right to left", () => {
  assert.equal(detectDirection(["اخبار امروز فوتبال ایران"]), "rtl");
  assert.equal(detectDirection(["۱۰ آبان ۱۴۰۵ خبر"]), "rtl");
  assert.equal(detectDirection(["שלום עולם"]), "rtl");
});

test("every other script runs left to right", () => {
  const samples = [
    "Hoy, 1 de noviembre de 2026",
    "Сегодня 1 ноября 2026 г.",
    "Heute, Sonntag, 1. November",
    "今天有哪些关于伊朗足球的新闻",
    "आज ईरान के फुटबॉल से जुड़ी खबरें",
    "今日のニュース",
    "오늘의 뉴스",
    "ข่าววันนี้",
    "Σήμερα τα νέα",
  ];

  for (const sample of samples) {
    assert.equal(detectDirection([sample]), "ltr", sample);
  }
});

test("digits and punctuation never decide the direction", () => {
  assert.equal(detectDirection(["（٢٠٢٦年١١月١日）今天"]), "ltr");
  assert.equal(detectDirection(["2026 — आज"]), "ltr");
  assert.equal(detectDirection(["1405 خبر"]), "rtl");
});

test("text with no letter keeps the app's right-to-left default", () => {
  assert.equal(detectDirection([""]), "rtl");
  assert.equal(detectDirection(["123 ...", "٤٥٦"]), "rtl");
});

test("the first text with a letter decides for a group", () => {
  assert.equal(detectDirection(["123", "今天", "خبر"]), "ltr");
});

test("a Chinese reply shows western digits, not Persian ones", () => {
  assert.equal(
    westernDigitsForForeignText("今天（٢٠٢٦年١١月١日）的新闻"),
    "今天（2026年11月1日）的新闻",
  );
  assert.equal(westernDigitsForForeignText("आज ۱ नवंबर ۲۰۲۶"), "आज 1 नवंबर 2026");
});

test("Persian and Arabic text keeps its own digits", () => {
  const persian = "امروز ۱۰ آبان ۱۴۰۵";
  const arabic = "اليوم ٢٠٢٦";

  assert.equal(westernDigitsForForeignText(persian), persian);
  assert.equal(westernDigitsForForeignText(arabic), arabic);
});

test("Devanagari digits and text with no letters are left alone", () => {
  assert.equal(westernDigitsForForeignText("आज १ नवंबर २०२६"), "आज १ नवंबर २०२६");
  assert.equal(westernDigitsForForeignText("۱۲۳"), "۱۲۳");
});
