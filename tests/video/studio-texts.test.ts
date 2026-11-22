// tests/video/studio-texts.test.ts
// The film-making screen's words: both languages have the same keys and no empty
// text, every word of the studio (motions, changes, shapes, qualities, errors,
// stages) has its text, and the texts with numbers read right in both languages.

import test from "node:test";
import assert from "node:assert/strict";

import {
  STUDIO_TEXT,
  clockText,
  errorText,
  progressText,
  warningText,
} from "../../src/features/video/studio/studioTexts.ts";
import {
  STUDIO_ASPECTS,
  STUDIO_MOTIONS,
  STUDIO_QUALITIES,
  STUDIO_TRANSITIONS,
} from "../../src/features/video/studio/types.ts";

const LANGS = ["fa", "en"] as const;

function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, inner]) => keysOf(inner, prefix ? `${prefix}.${key}` : key));
}

test("both languages have exactly the same keys", () => {
  assert.deepEqual(keysOf(STUDIO_TEXT.fa), keysOf(STUDIO_TEXT.en));
});

test("no text is empty and every word of the studio has its text", () => {
  for (const lang of LANGS) {
    const text = STUDIO_TEXT[lang];
    for (const [key, value] of Object.entries(text)) {
      if (typeof value === "string") assert.ok(value.trim().length > 0, `${lang}.${key}`);
    }
    for (const motion of STUDIO_MOTIONS) assert.ok(text.motions[motion]?.length > 0, `${lang} ${motion}`);
    for (const transition of STUDIO_TRANSITIONS) assert.ok(text.transitions[transition]?.length > 0, `${lang} ${transition}`);
    for (const aspect of STUDIO_ASPECTS) assert.ok(text.shapes[aspect]?.length > 0, `${lang} ${aspect}`);
    for (const quality of STUDIO_QUALITIES) assert.ok(text.qualities[quality]?.length > 0, `${lang} ${quality}`);
    for (const stage of ["loading", "recording"] as const) assert.ok(text.stages[stage].length > 0);
    for (const value of Object.values(text.errors)) assert.ok(value.length > 0);
  }
});

test("the languages really differ", () => {
  assert.notEqual(STUDIO_TEXT.fa.title, STUDIO_TEXT.en.title);
  assert.notEqual(STUDIO_TEXT.fa.errors.failed, STUDIO_TEXT.en.errors.failed);
});

test("every kind of failure has a text, and an unknown one reads as a general failure", () => {
  for (const lang of LANGS) {
    for (const code of ["invalid", "no_images", "cancelled", "unsupported", "failed", "not_image", "too_large", "too_small", "unreadable"]) {
      assert.equal(errorText(lang, code), STUDIO_TEXT[lang].errors[code as keyof typeof STUDIO_TEXT.fa.errors]);
    }
    assert.equal(errorText(lang, "nonsense"), STUDIO_TEXT[lang].errors.failed);
    assert.equal(errorText(lang, "toString"), STUDIO_TEXT[lang].errors.failed);
  }
});

test("every change made to the project has a sentence with its number", () => {
  assert.match(warningText("en", { code: "scenes_truncated", kept: 200 }), /200/);
  assert.match(warningText("fa", { code: "scenes_truncated", kept: 200 }), /۲۰۰/);
  assert.match(warningText("en", { code: "duration_truncated", kept: 10 }), /10/);
  assert.match(warningText("fa", { code: "duration_truncated", kept: 10 }), /۱۰/);
  assert.equal(warningText("en", { code: "scene_dropped", index: 3 }), STUDIO_TEXT.en.scenesDropped(1));
  assert.match(STUDIO_TEXT.fa.failedScenes(3), /۳/);
  assert.match(STUDIO_TEXT.en.failedScenes(3), /3/);
});

test("the progress line has the stage and the percent, kept between 0 and 100", () => {
  assert.equal(progressText("en", "recording", 0.42), "Making the film 42%");
  assert.equal(progressText("fa", "recording", 0.42), "در حال ساخت فیلم ۴۲٪");
  assert.equal(progressText("en", "loading", 5), "Getting the photos ready 100%");
  assert.equal(progressText("en", "loading", -1), "Getting the photos ready 0%");
  assert.equal(progressText("en", "loading", Number.NaN), "Getting the photos ready 0%");
});

test("a length reads as minutes and seconds, with Persian digits in Persian", () => {
  assert.equal(clockText(150, "en"), "2:30");
  assert.equal(clockText(5, "en"), "0:05");
  assert.equal(clockText(600, "en"), "10:00");
  assert.equal(clockText(59.6, "en"), "1:00");
  assert.equal(clockText(150, "fa"), "۲:۳۰");
  assert.equal(clockText(-4, "en"), "0:00");
  assert.equal(clockText(Number.NaN, "fa"), "۰:۰۰");
});
