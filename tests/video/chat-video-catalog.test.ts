// tests/video/chat-video-catalog.test.ts
// The video catalog is data: every look and every photo ability is one row. These
// tests keep the rows honest: unique ids, no clashing words, no studio or
// brand names, the old style ids still work, only connected abilities are
// offered, and a style is found from any spelling and any language.

import test from "node:test";
import assert from "node:assert/strict";

import { PHOTO_ACTIONS } from "../../supabase/functions/ai-chat/video/catalog/actions.ts";
import { STYLES } from "../../supabase/functions/ai-chat/video/catalog/styles.ts";
import {
  directorCatalogText,
  findPhotoAction,
  findStyle,
  keysOf,
  liveActions,
  normalizeKey,
  resolveStyleId,
  styleIds,
  styleRecipe,
} from "../../supabase/functions/ai-chat/video/catalog/lookup.ts";
import type { PhotoAction } from "../../supabase/functions/ai-chat/video/catalog/types.ts";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FORBIDDEN_NAMES = [
  "pixar", "disney", "ghibli", "marvel", "lego", "nintendo", "pokemon",
  "dreamworks", "naruto", "simpsons", "mickey", "batman", "spiderman",
  "netflix", "warner",
  // The same brands written in Persian, Japanese and Chinese.
  "پیکسار", "دیزنی", "گیبلی", "مارول", "لگو", "نینتندو", "پوکمون", "ناروتو",
  "ジブリ", "ディズニー", "ポケモン", "乐高", "迪士尼",
];
// The ids the app used before the catalog existed. They must keep working.
const LEGACY_IDS = ["realistic", "cinematic", "animation", "advertising", "educational"];

function wordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

test("styles: unique well-formed ids, names and groups", () => {
  const ids = STYLES.map((style) => style.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(STYLES.length >= 20, "a wide choice of looks");

  for (const style of STYLES) {
    assert.match(style.id, ID_PATTERN);
    assert.ok(style.name.trim().length > 0);
    assert.ok(style.aliases.length > 0, `${style.id} has aliases`);
  }
});

test("styles: every recipe is a short plain description of a look", () => {
  for (const style of STYLES) {
    const words = wordCount(style.recipe);

    assert.ok(words >= 15 && words <= 45, `${style.id} recipe has ${words} words`);
    assert.equal(style.recipe, style.recipe.trim());
    assert.ok(!/\n/.test(style.recipe));
  }
});

test("styles: no studio, artist, brand or character name anywhere", () => {
  const everything = JSON.stringify([STYLES, PHOTO_ACTIONS]).toLowerCase();

  for (const name of FORBIDDEN_NAMES) {
    assert.ok(!everything.includes(name), `${name} must not appear`);
  }
});

test("styles and actions: no word answers to two different rows", () => {
  for (const rows of [STYLES, PHOTO_ACTIONS] as const) {
    const owner = new Map<string, string>();

    for (const row of rows) {
      for (const key of new Set(keysOf(row))) {
        const other = owner.get(key);

        assert.ok(
          other === undefined || other === row.id,
          `"${key}" is used by both ${other} and ${row.id}`,
        );
        owner.set(key, row.id);
      }
    }
  }
});

test("the old style ids all still resolve to themselves, and auto stays auto", () => {
  for (const id of LEGACY_IDS) {
    assert.equal(resolveStyleId(id), id === "animation" ? "classic-2d" : id);
    assert.ok(findStyle(id), `${id} is found`);
  }

  assert.equal(resolveStyleId("auto"), "auto");
  assert.equal(resolveStyleId(""), "auto");
  assert.equal(resolveStyleId(undefined), "auto");
  assert.equal(resolveStyleId(42), "auto");
  assert.equal(resolveStyleId("a style nobody made"), "auto");
});

test("findStyle: any spelling, any language, the same row", () => {
  const cases: Array<[string, string]> = [
    ["Anime", "anime"],
    ["  ANIME ", "anime"],
    ["انیمه", "anime"],
    ["アニメ", "anime"],
    ["Pixel Art", "pixel-art"],
    ["pixel_art", "pixel-art"],
    ["پیکسلی", "pixel-art"],
    ["آبرنگ", "watercolor"],
    ["ابرنگ", "watercolor"],
    ["مینیاتور", "persian-miniature"],
    ["سیاه\u200Cوسفید", "historical-bw"],
    ["سیاه و سفید", "historical-bw"],
    ["کارتون", "classic-2d"],
    ["گلی", "claymation"],
    ["سایبرپانک", "neon-cyberpunk"],
    ["VHS", "retro-vhs"],
  ];

  for (const [text, id] of cases) {
    assert.equal(findStyle(text)?.id, id, text);
  }
});

test("normalizeKey folds Arabic letters, marks, joiners and separators", () => {
  assert.equal(normalizeKey("كتاب"), normalizeKey("کتاب"));
  assert.equal(normalizeKey("يك"), normalizeKey("یک"));
  assert.equal(normalizeKey("می\u200Cخواهم"), normalizeKey("میخواهم"));
  assert.equal(normalizeKey("A-b_c d.e"), "abcde");
  assert.equal(normalizeKey("سَلام"), normalizeKey("سلام"));
});

test("styleRecipe and styleIds follow the rows", () => {
  assert.equal(styleRecipe("anime"), STYLES.find((style) => style.id === "anime")?.recipe);
  assert.equal(styleRecipe("nothing"), null);
  assert.deepEqual(styleIds(), STYLES.map((style) => style.id));
});

test("photo actions: unique ids, and the plan for each one is complete", () => {
  const ids = PHOTO_ACTIONS.map((action) => action.id);

  assert.equal(new Set(ids).size, ids.length);

  for (const action of PHOTO_ACTIONS) {
    assert.match(action.id, ID_PATTERN);
    assert.ok(action.description.trim().length > 20);
    assert.ok(["live", "planned"].includes(action.status));
    assert.ok(["device", "cloud"].includes(action.runner));
    assert.notEqual(action.fallback, action.runner);
  }
});

test("photo actions: everything that changes a face is marked, the phone comes first", () => {
  for (const id of ["talk", "age-up", "age-down", "place-in-scene"]) {
    assert.equal(findPhotoAction(id)?.usesFace, true, id);
  }

  assert.equal(findPhotoAction("animate")?.usesFace, false);

  for (const action of PHOTO_ACTIONS) {
    if (action.id !== "restyle") {
      assert.equal(action.runner, "device", `${action.id} runs on the phone first`);
    }
  }
});

test("liveActions: only what is connected today", () => {
  const live = liveActions();

  assert.ok(live.length > 0);
  assert.ok(live.every((action) => action.status === "live"));
  assert.ok(live.some((action) => action.id === "animate"));
  assert.ok(!live.some((action) => action.id === "talk"));
});

test("findPhotoAction: by id, name or word in any language", () => {
  assert.equal(findPhotoAction("talk")?.id, "talk");
  assert.equal(findPhotoAction("حرف بزند")?.id, "talk");
  assert.equal(findPhotoAction("پیر کن")?.id, "age-up");
  assert.equal(findPhotoAction("جوان کن")?.id, "age-down");
  assert.equal(findPhotoAction("متحرک کن")?.id, "animate");
  assert.equal(findPhotoAction("unknown"), null);
  assert.equal(findPhotoAction(null), null);
});

test("directorCatalogText: lists every look, only connected abilities, and never promises more", () => {
  const text = directorCatalogText();

  for (const style of STYLES) {
    assert.ok(text.includes(`${style.id} (${style.name})`), style.id);
  }

  assert.ok(text.includes("Bring the photo to life"));
  assert.ok(!text.includes("Make the face talk"));
  assert.ok(!text.includes("Make the person older"));
  assert.ok(text.includes("never promise one that is not listed"));
  assert.ok(!text.includes("someone who agreed"), "no face ability is live yet");
});

test("directorCatalogText: a live face ability brings the consent rule; no abilities, no photo line", () => {
  const talk = PHOTO_ACTIONS.find((action) => action.id === "talk") as PhotoAction;
  const withFace = directorCatalogText(STYLES, [{ ...talk, status: "live" }]);

  assert.ok(withFace.includes("Make the face talk"));
  assert.ok(withFace.includes("someone who agreed"));
  assert.ok(withFace.includes("never use a famous person's photo"));

  const none = directorCatalogText(STYLES, []);

  assert.ok(!none.includes("the person's own photo today"));
  assert.ok(none.includes("Looks you may offer"));
});
