// tests/cards/codec.test.ts
// Behavior tests for supabase/functions/ai-chat/cards/codec.ts.
// Runner: node:test (built in). No dependencies.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CARD_MARKER_PATTERN,
  CLOCK_MARKER_PATTERN,
  decodeCardBody,
  encodeCard,
  stripMarkers,
} from "../../supabase/functions/ai-chat/cards/codec.ts";
import type { CardPayload } from "../../supabase/functions/ai-chat/types.ts";

const PREFIX = ":::md-card~";
const SUFFIX = ":::";

// Strips ":::md-card~" and ":::" from an encoded marker.
function bodyOf(marker: string): string {
  assert.ok(marker.startsWith(PREFIX), "marker must start with the card prefix");
  assert.ok(marker.endsWith(SUFFIX), "marker must end with ':::'");
  return marker.slice(PREFIX.length, marker.length - SUFFIX.length);
}

// Reference base64url encoder, independent of codec.ts (Buffer-based).
function referenceBody(card: CardPayload): string {
  return Buffer.from(JSON.stringify(card), "utf8").toString("base64url");
}

const placesCard: CardPayload = {
  t: "places",
  lang: "fa",
  items: [
    {
      name: "برج میلاد",
      address: "تهران، بزرگراه همت 🇮🇷",
      lat: 35.7448,
      lon: 51.3753,
      km: 12.5,
      zoom: 15,
    },
    { name: "Eiffel Tower", address: "Paris, France", lat: 48.8584, lon: 2.2945 },
  ],
};

const photosCard: CardPayload = {
  t: "photos",
  lang: "en",
  items: [
    { src: "https://upload.wikimedia.org/a/b/c.jpg", title: "نمای شب 🌃" },
    { src: "https://example.com/x.png?a=1&b=2", title: "Plain title" },
  ],
};

const clockCard: CardPayload = {
  t: "clock",
  iso: "2026-10-13T12:34:56+03:30",
  zone: "Asia/Tehran",
  ref: "now",
  label: "تهران ⏰",
  lang: "fa",
};

const clockCardNoLabel: CardPayload = {
  t: "clock",
  iso: "2026-10-13T09:04:56Z",
  zone: "UTC",
  ref: "now",
  lang: "en",
};

test("encodeCard: marker shape and base64url alphabet", () => {
  for (const card of [placesCard, photosCard, clockCard, clockCardNoLabel]) {
    const marker = encodeCard(card);
    assert.match(marker, /^:::md-card~[A-Za-z0-9_-]+:::$/);
    assert.ok(!bodyOf(marker).includes("="), "no padding");
    assert.ok(!/[+/]/.test(bodyOf(marker)), "no + or /");
  }
});

test("encodeCard: body equals reference base64url of JSON (equivalence)", () => {
  for (const card of [placesCard, photosCard, clockCard, clockCardNoLabel]) {
    assert.equal(bodyOf(encodeCard(card)), referenceBody(card));
  }
});

test("golden: exact current encoding of a minimal clock card", () => {
  const card: CardPayload = {
    t: "clock",
    iso: "2026-01-01T00:00:00Z",
    zone: "UTC",
    ref: "now",
    lang: "en",
  };
  assert.equal(
    encodeCard(card),
    ":::md-card~eyJ0IjoiY2xvY2siLCJpc28iOiIyMDI2LTAxLTAxVDAwOjAwOjAwWiIsInpvbmUiOiJVVEMiLCJyZWYiOiJub3ciLCJsYW5nIjoiZW4ifQ:::",
  );
});

test("golden: exact current encoding of a Persian + emoji places card", () => {
  const card: CardPayload = {
    t: "places",
    lang: "fa",
    items: [{ name: "تهران 🏙️", address: "ایران", lat: 35.7, lon: 51.4 }],
  };
  assert.equal(
    encodeCard(card),
    ":::md-card~eyJ0IjoicGxhY2VzIiwibGFuZyI6ImZhIiwiaXRlbXMiOlt7Im5hbWUiOiLYqtmH2LHYp9mGIPCfj5nvuI8iLCJhZGRyZXNzIjoi2KfbjNix2KfZhiIsImxhdCI6MzUuNywibG9uIjo1MS40fV19:::",
  );
});

test("golden: a marker in the current format decodes to the original card", () => {
  const marker =
    ":::md-card~eyJ0IjoiY2xvY2siLCJpc28iOiIyMDI2LTAxLTAxVDAwOjAwOjAwWiIsInpvbmUiOiJVVEMiLCJyZWYiOiJub3ciLCJsYW5nIjoiZW4ifQ:::";
  assert.deepEqual(decodeCardBody(bodyOf(marker)), {
    t: "clock",
    iso: "2026-01-01T00:00:00Z",
    zone: "UTC",
    ref: "now",
    lang: "en",
  });
});

test("round-trip: places, photos, clock (with and without label)", () => {
  for (const card of [placesCard, photosCard, clockCard, clockCardNoLabel]) {
    assert.deepEqual(decodeCardBody(bodyOf(encodeCard(card))), card);
  }
});

test("round-trip: Persian text and emoji survive byte-exact", () => {
  const card: CardPayload = {
    t: "photos",
    lang: "fa",
    items: [{ src: "https://e.com/ü.jpg", title: "سلام دنیا 👋🏽 — ۱۲۳ — 𝒳" }],
  };
  const decoded = decodeCardBody(bodyOf(encodeCard(card))) as typeof card;
  assert.equal(decoded.items[0]!.title, "سلام دنیا 👋🏽 — ۱۲۳ — 𝒳");
  assert.deepEqual(decoded, card);
});

test("round-trip: empty items arrays", () => {
  const a: CardPayload = { t: "places", lang: "en", items: [] };
  const b: CardPayload = { t: "photos", lang: "en", items: [] };
  assert.deepEqual(decodeCardBody(bodyOf(encodeCard(a))), a);
  assert.deepEqual(decodeCardBody(bodyOf(encodeCard(b))), b);
});

test("round-trip: bodies of every length mod 3 (padding paths)", () => {
  for (let n = 0; n < 6; n++) {
    const card: CardPayload = {
      t: "photos",
      lang: "en",
      items: [{ src: "s", title: "x".repeat(n) }],
    };
    assert.deepEqual(decodeCardBody(bodyOf(encodeCard(card))), card);
  }
});

test("CARD_MARKER_PATTERN matches an encoded card and captures its body", () => {
  const marker = encodeCard(placesCard);
  const found = [...marker.matchAll(CARD_MARKER_PATTERN)];
  assert.equal(found.length, 1);
  assert.equal(found[0]![1], bodyOf(marker));
});

test("CLOCK_MARKER_PATTERN matches the legacy clock marker", () => {
  const legacy = ":::md-clock~2026-10-13T12:34:56+03:30~Asia/Tehran~fa:::";
  assert.equal([...legacy.matchAll(CLOCK_MARKER_PATTERN)].length, 1);
  const legacyEn = ":::md-clock~2026-10-13T09:04:56Z~America/Argentina/Buenos_Aires~en:::";
  assert.equal([...legacyEn.matchAll(CLOCK_MARKER_PATTERN)].length, 1);
});

test("stripMarkers: removes a card marker and trims", () => {
  assert.equal(stripMarkers(`  سلام\n${encodeCard(placesCard)}  `), "سلام");
});

test("stripMarkers: removes the legacy clock marker", () => {
  const legacy = ":::md-clock~2026-10-13T12:34:56+03:30~Asia/Tehran~fa:::";
  assert.equal(stripMarkers(`ساعت: ${legacy}`), "ساعت:");
});

test("stripMarkers: history text with several markers keeps surrounding text", () => {
  const history =
    `اینجا چند جا هست 📍\n${encodeCard(placesCard)}\n` +
    `و عکس‌ها:\n${encodeCard(photosCard)}\n` +
    `ساعت ${encodeCard(clockCard)} تمام. :::md-clock~2026-10-13T12:00:00Z~UTC~en:::`;
  assert.equal(
    stripMarkers(history),
    "اینجا چند جا هست 📍\n\n" + "و عکس‌ها:\n\n" + "ساعت  تمام.",
  );
});

test("stripMarkers: text without markers is unchanged apart from trim", () => {
  assert.equal(stripMarkers("  just text ✅ متن  "), "just text ✅ متن");
  assert.equal(stripMarkers("a :::not-a-marker::: b"), "a :::not-a-marker::: b");
});

test("stripMarkers: marker-only input becomes empty string", () => {
  assert.equal(stripMarkers(encodeCard(clockCard)), "");
});

test("stripMarkers: repeated calls are stable (global regex lastIndex safe)", () => {
  const text = `x ${encodeCard(photosCard)} y`;
  assert.equal(stripMarkers(text), "x  y");
  assert.equal(stripMarkers(text), "x  y");
  assert.equal(stripMarkers(text), "x  y");
});

test("decodeCardBody: current behavior on invalid input is null (verified from code: catch -> null)", () => {
  assert.equal(decodeCardBody("!!!not base64!!!"), null); // atob throws
  assert.equal(decodeCardBody(Buffer.from("not json", "utf8").toString("base64url")), null); // JSON.parse throws
  assert.equal(decodeCardBody(""), null); // "" decodes to "" -> JSON.parse("") throws
});
