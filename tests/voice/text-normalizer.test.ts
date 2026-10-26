// tests/voice/text-normalizer.test.ts
// The voice text cleaner may fix the surface of the text (spaces, letter forms,
// half-spaces, punctuation) but must never change what was said: not the words,
// not the numbers, names, brands, links, and not text in a language it has no
// rules for. Pure function, so nothing is replaced by a fake.

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTranscript } from "../../src/features/voice/textNormalizer.ts";

const ZWNJ = "\u200C";

// What must survive: the letters (with the Arabic forms mapped to the Persian
// ones) and everything that is not a space, a half-space or a punctuation mark.
function skeleton(text: string): string {
  return text
    .replace(/[\s\u200C]/g, "")
    .replace(/[،؛؟!?.,;]/g, "")
    .replace(/[\u064A\u0649]/g, "\u06CC")
    .replace(/\u0643/g, "\u06A9");
}

const PERSIAN_SAMPLES: readonly string[] = [
  "سلام ، خوبی ؟",
  "من می خوام برم بیرون",
  "نمی دونم چی بگم",
  "كتاب يك دوست خوب",
  "کتاب ها رو بیار",
  "ساعت ۱۲:۳۰ جلوی برج میلاد باش",
  "مبلغ 1,500,000 تومان رو واریز کردم",
  "گوشی iPhone 15 Pro رو از Dubai خریدم",
  "  این    یک   جمله‌ی   تست   است  ",
  "سلام, خوبی? من حالم خوبه; تو چطوری",
];

test("Persian: Arabic letter forms become the Persian ones", () => {
  assert.equal(
    normalizeTranscript("كتاب يك دوست خوب", "fa"),
    "کتاب یک دوست خوب",
  );
  assert.equal(normalizeTranscript("على", "fa"), "علی");
});

test("Arabic: the same letters are the right letters and stay", () => {
  assert.equal(normalizeTranscript("كتاب يمكن", "ar"), "كتاب يمكن");
});

test("no language given: only the language-neutral cleaning is done", () => {
  assert.equal(normalizeTranscript("  كتاب   يك  ", ""), "كتاب يك");
});

test("a language code with a region works like the plain one", () => {
  assert.equal(normalizeTranscript("كتاب", "fa-IR"), "کتاب");
  assert.equal(normalizeTranscript("كتاب", "FA"), "کتاب");
});

test("numbers, times, amounts and phone numbers are never rewritten", () => {
  const clean =
    "ساعت ۱۲:۳۰ مبلغ 1,500,000 تومان و شماره 0912 123 4567 و عدد ٣٤٥ و 3.5";

  assert.equal(normalizeTranscript(clean, "fa"), clean);
});

test("English words, brands, e-mail addresses and links are not damaged", () => {
  const mixed =
    "من با iPhone 15 Pro رفتم Dubai و ایمیل test@example.com و https://mass-diamond.netlify.app/chat?x=1 رو بفرست";

  assert.equal(normalizeTranscript(mixed, "fa"), mixed);
});

test("Persian verb prefix and plural ending get a half-space", () => {
  assert.equal(
    normalizeTranscript("من می خوام برم", "fa"),
    `من می${ZWNJ}خوام برم`,
  );
  assert.equal(
    normalizeTranscript("نمی دونم", "fa"),
    `نمی${ZWNJ}دونم`,
  );
  assert.equal(
    normalizeTranscript("کتاب ها رو بیار", "fa"),
    `کتاب${ZWNJ}ها رو بیار`,
  );
});

test("a lone prefix word with nothing after it is left as it is", () => {
  assert.equal(normalizeTranscript("من می", "fa"), "من می");
});

test("English text is not given Persian half-spaces", () => {
  assert.equal(normalizeTranscript("me ha ha", "en"), "me ha ha");
  assert.equal(normalizeTranscript("me ha ha", "fa"), "me ha ha");
});

test("Persian punctuation is placed and spaced the Persian way", () => {
  assert.equal(normalizeTranscript("سلام ، خوبی ؟", "fa"), "سلام، خوبی؟");
  assert.equal(
    normalizeTranscript("سلام, خوبی? من خوبم; تو چطوری", "fa"),
    "سلام، خوبی؟ من خوبم؛ تو چطوری",
  );
  assert.equal(normalizeTranscript("سلام،خوبی", "fa"), "سلام، خوبی");
});

test("French keeps its own space before a question mark", () => {
  assert.equal(normalizeTranscript("Tu viens ?", "fr"), "Tu viens ?");
});

test("half-spaces are never doubled, next to a space or at the ends", () => {
  assert.equal(
    normalizeTranscript(`کتاب${ZWNJ}${ZWNJ}ها`, "fa"),
    `کتاب${ZWNJ}ها`,
  );
  assert.equal(normalizeTranscript(`سلام${ZWNJ} دنیا`, "fa"), "سلام دنیا");
  assert.equal(normalizeTranscript(`${ZWNJ}سلام${ZWNJ}`, "fa"), "سلام");
});

test("a half-space that belongs to another language is left alone", () => {
  const hindi = `क${ZWNJ}ष`;

  assert.equal(normalizeTranscript(hindi, "hi"), hindi);
});

test("spaces, tabs and line breaks become single spaces", () => {
  assert.equal(
    normalizeTranscript("  سلام \t\n  دنیا  ", "fa"),
    "سلام دنیا",
  );
});

test("invisible junk is removed", () => {
  assert.equal(normalizeTranscript("\uFEFFسلام\u00AD", "fa"), "سلام");
});

test("the stretching line is removed in Persian and Arabic", () => {
  assert.equal(normalizeTranscript("سـلام", "fa"), "سلام");
  assert.equal(normalizeTranscript("سـلام", "ar"), "سلام");
});

test("what was said never changes: the letters survive, only the surface moves", () => {
  for (const sample of PERSIAN_SAMPLES) {
    assert.equal(
      skeleton(normalizeTranscript(sample, "fa")),
      skeleton(sample),
      sample,
    );
  }
});

test("cleaning twice gives the same result as cleaning once", () => {
  for (const sample of PERSIAN_SAMPLES) {
    const once = normalizeTranscript(sample, "fa");

    assert.equal(normalizeTranscript(once, "fa"), once, sample);
  }
});

test("the empty text stays empty", () => {
  assert.equal(normalizeTranscript("", "fa"), "");
  assert.equal(normalizeTranscript("   ", "fa"), "");
});
