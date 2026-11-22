// tests/video/studio-film-draft.test.ts
// What the person builds on the film screen: adding, removing, moving and editing
// photos, the shape that follows the first photo until the person chooses one, the
// limits, the project that goes to the studio, and the length of the film.

import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_DRAFT,
  draftReducer,
  draftSummary,
  draftToProject,
  shapeForPhoto,
  type DraftAction,
  type FilmDraft,
} from "../../src/features/video/studio/filmDraft.ts";
import { parseStudioProject } from "../../src/features/video/studio/validate.ts";
import { STUDIO_LIMITS } from "../../src/features/video/studio/types.ts";

const add = (id: string, width = 1600, height = 900): DraftAction => ({
  type: "add", id, url: `blob:https://app/${id}`, width, height,
});

function run(...actions: DraftAction[]): FilmDraft {
  return actions.reduce(draftReducer, EMPTY_DRAFT);
}

test("a photo is added with good defaults and the camera moves in turn", () => {
  const draft = run(add("a"), add("b"), add("c"), add("d"), add("e"));
  assert.deepEqual(draft.photos.map((p) => p.id), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(draft.photos.map((p) => p.motion), ["zoom-in", "pan-right", "zoom-out", "pan-left", "zoom-in"]);
  assert.deepEqual(
    { ...draft.photos[0], motion: undefined },
    { id: "a", url: "blob:https://app/a", width: 1600, height: 900, seconds: 5, motion: undefined, transition: "fade", caption: "" },
  );
});

test("the same photo id is not added twice", () => {
  const draft = run(add("a"), add("a"));
  assert.equal(draft.photos.length, 1);
});

test("the shape follows the first photo until the person chooses one", () => {
  assert.equal(run(add("a", 900, 1600)).aspectRatio, "9:16");
  assert.equal(run(add("a", 1000, 1000)).aspectRatio, "1:1");
  assert.equal(run(add("a", 1600, 900)).aspectRatio, "16:9");
  assert.equal(run(add("a", 900, 1600), add("b", 1600, 900)).aspectRatio, "9:16");
  const chosen = run({ type: "setShape", aspectRatio: "1:1" }, add("a", 900, 1600));
  assert.equal(chosen.aspectRatio, "1:1");
  assert.equal(chosen.shapeChosen, true);
  assert.equal(shapeForPhoto(0, 0), "16:9");
  assert.equal(shapeForPhoto(1200, 1000), "1:1");
});

test("no more photos than the studio allows", () => {
  let draft = EMPTY_DRAFT;
  for (let i = 0; i < STUDIO_LIMITS.maxScenes + 5; i += 1) draft = draftReducer(draft, add(`p${i}`));
  assert.equal(draft.photos.length, STUDIO_LIMITS.maxScenes);
});

test("a photo can be removed, and an unknown one changes nothing", () => {
  const draft = run(add("a"), add("b"));
  assert.deepEqual(draftReducer(draft, { type: "remove", id: "a" }).photos.map((p) => p.id), ["b"]);
  assert.equal(draftReducer(draft, { type: "remove", id: "zzz" }), draft);
});

test("a photo moves one place and stops at the ends", () => {
  const draft = run(add("a"), add("b"), add("c"));
  const ids = (d: FilmDraft) => d.photos.map((p) => p.id);
  assert.deepEqual(ids(draftReducer(draft, { type: "move", id: "b", direction: -1 })), ["b", "a", "c"]);
  assert.deepEqual(ids(draftReducer(draft, { type: "move", id: "b", direction: 1 })), ["a", "c", "b"]);
  assert.equal(draftReducer(draft, { type: "move", id: "a", direction: -1 }), draft);
  assert.equal(draftReducer(draft, { type: "move", id: "c", direction: 1 }), draft);
  assert.equal(draftReducer(draft, { type: "move", id: "zzz", direction: 1 }), draft);
});

test("editing keeps only good values and the original is never changed", () => {
  const draft = run(add("a"));
  const edited = draftReducer(draft, {
    type: "update", id: "a",
    changes: { seconds: 9999, motion: "pan-up", transition: "zoom", caption: "x".repeat(500) },
  });
  assert.equal(edited.photos[0].seconds, STUDIO_LIMITS.maxSceneSeconds);
  assert.equal(edited.photos[0].motion, "pan-up");
  assert.equal(edited.photos[0].transition, "zoom");
  assert.equal(edited.photos[0].caption.length, STUDIO_LIMITS.maxCaptionChars);
  assert.equal(draft.photos[0].seconds, 5);

  const bad = draftReducer(draft, {
    type: "update", id: "a",
    changes: { seconds: Number.NaN, motion: "spin" as never, transition: "wipe" as never },
  });
  assert.deepEqual(bad.photos[0], draft.photos[0]);
  assert.equal(draftReducer(draft, { type: "update", id: "zzz", changes: { seconds: 3 } }), draft);
  assert.equal(draftReducer(draft, { type: "update", id: "a", changes: { seconds: -4 } }).photos[0].seconds, 1);
});

test("shape, quality and title are checked, and reset starts again", () => {
  const draft = run(add("a"));
  assert.equal(draftReducer(draft, { type: "setShape", aspectRatio: "4:3" as never }), draft);
  assert.equal(draftReducer(draft, { type: "setQuality", quality: "ultra" as never }), draft);
  assert.equal(draftReducer(draft, { type: "setQuality", quality: "high" }).quality, "high");
  assert.equal(Array.from(draftReducer(draft, { type: "setTitle", title: "ا".repeat(500) }).title).length, STUDIO_LIMITS.maxTitleChars);
  assert.deepEqual(draftReducer(draft, { type: "reset" }), EMPTY_DRAFT);
});

test("the project for the studio is valid and keeps order, captions and settings", () => {
  const draft = run(
    add("a", 900, 1600), add("b"),
    { type: "update", id: "a", changes: { caption: "  Hello ", seconds: 7 } },
    { type: "setQuality", quality: "high" },
    { type: "setTitle", title: "Trip" },
  );
  const parsed = parseStudioProject(draftToProject(draft));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.project.title, "Trip");
  assert.equal(parsed.project.aspectRatio, "9:16");
  assert.equal(parsed.project.quality, "high");
  assert.deepEqual(parsed.project.scenes.map((s) => [s.id, s.seconds, s.caption]), [["a", 7, "Hello"], ["b", 5, null]]);
});

test("an empty caption becomes none", () => {
  const draft = run(add("a"), { type: "update", id: "a", changes: { caption: "   " } });
  const project = draftToProject(draft) as { scenes: Array<{ caption: unknown }> };
  assert.equal(project.scenes[0].caption, null);
});

test("the summary gives the length with the overlaps and says when the film cannot be made", () => {
  assert.deepEqual(draftSummary(EMPTY_DRAFT), { photoCount: 0, seconds: 0, canMake: false, warnings: [] });
  // 3 photos of 5 s with two 1 s changes: 15 - 2 = 13 s.
  const three = draftSummary(run(add("a"), add("b"), add("c")));
  assert.equal(three.photoCount, 3);
  assert.equal(three.seconds, 13);
  assert.equal(three.canMake, true);
  assert.deepEqual(three.warnings, []);
});

test("a film that would pass ten minutes is reported", () => {
  let draft = EMPTY_DRAFT;
  for (let i = 0; i < 20; i += 1) {
    draft = draftReducer(draft, add(`p${i}`));
    draft = draftReducer(draft, { type: "update", id: `p${i}`, changes: { seconds: 60, transition: "cut" } });
  }
  const summary = draftSummary(draft);
  assert.equal(summary.photoCount, 10);
  assert.equal(summary.seconds, 600);
  assert.deepEqual(summary.warnings, [{ code: "duration_truncated", kept: 10 }]);
});
