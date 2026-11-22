// tests/video/studio-validate.test.ts
// Cleaning a studio project that comes from outside: wrong shapes are refused,
// strange values are brought into range, unsafe pictures and music are dropped,
// too many scenes or too long a film is cut from the end, and every change is
// reported. No browser.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LANGUAGE,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SCENE_SECONDS,
  parseStudioProject,
} from "../../src/features/video/studio/validate.ts";
import { buildTimeline } from "../../src/features/video/studio/timeline.ts";
import { STUDIO_LIMITS } from "../../src/features/video/studio/types.ts";

const good = (extra: Record<string, unknown> = {}) => ({ imageUrl: "https://x/a.jpg", ...extra });

function parsed(input: unknown) {
  const result = parseStudioProject(input);
  assert.ok(result.ok, JSON.stringify(result));
  return result;
}

test("things that are not a project are refused", () => {
  for (const bad of [null, undefined, 5, "text", [], {}, { scenes: "x" }, { scenes: {} }]) {
    assert.deepEqual(parseStudioProject(bad), { ok: false, code: "invalid_project" });
  }
});

test("a project with no usable scene is refused", () => {
  assert.deepEqual(parseStudioProject({ scenes: [] }), { ok: false, code: "no_scenes" });
  assert.deepEqual(
    parseStudioProject({ scenes: [null, 4, { imageUrl: "http://x/a.jpg" }, { imageUrl: "javascript:1" }, {}] }),
    { ok: false, code: "no_scenes" },
  );
});

test("a minimal project gets every default", () => {
  const { project, warnings } = parsed({ scenes: [good()] });
  assert.deepEqual(warnings, []);
  assert.deepEqual(project, {
    version: 1, title: "", aspectRatio: "16:9", quality: "standard",
    scenes: [{
      id: "scene-1", imageUrl: "https://x/a.jpg", seconds: DEFAULT_SCENE_SECONDS, motion: "zoom-in",
      transition: "fade", transitionSeconds: 1, caption: null, narration: null,
    }],
    audio: { musicUrl: null, musicVolume: DEFAULT_MUSIC_VOLUME, narration: true, language: DEFAULT_LANGUAGE },
  });
});

test("good values are kept as they are", () => {
  const { project } = parsed({
    title: "  My film ", aspectRatio: "9:16", quality: "high",
    scenes: [good({
      id: "intro", seconds: 7.5, motion: "pan-left", transition: "slide-right", transitionSeconds: 2,
      caption: " سلام ", narration: "Hello there",
    })],
    audio: { musicUrl: "https://x/m.mp3", musicVolume: 0.8, narration: false, language: "fa-IR" },
  });
  assert.equal(project.title, "My film");
  assert.equal(project.aspectRatio, "9:16");
  assert.equal(project.quality, "high");
  assert.deepEqual(project.scenes[0], {
    id: "intro", imageUrl: "https://x/a.jpg", seconds: 7.5, motion: "pan-left",
    transition: "slide-right", transitionSeconds: 2, caption: "سلام", narration: "Hello there",
  });
  assert.deepEqual(project.audio, { musicUrl: "https://x/m.mp3", musicVolume: 0.8, narration: false, language: "fa-IR" });
});

test("strange values are brought into range or to the default", () => {
  const { project } = parsed({
    aspectRatio: "4:3", quality: 5, title: 12,
    scenes: [
      good({ seconds: 9999, motion: "spin", transition: "wipe", transitionSeconds: 99 }),
      good({ seconds: -3, transitionSeconds: -2 }),
      good({ seconds: Number.NaN, transitionSeconds: "2" }),
      good({ seconds: "7", caption: 5, narration: {} }),
    ],
    audio: { musicVolume: 7, narration: "yes", language: "not a tag!", musicUrl: "http://x/m.mp3" },
  });
  assert.equal(project.aspectRatio, "16:9");
  assert.equal(project.quality, "standard");
  assert.equal(project.title, "");
  assert.deepEqual(project.scenes.map((s) => s.seconds), [60, 1, DEFAULT_SCENE_SECONDS, DEFAULT_SCENE_SECONDS]);
  assert.deepEqual(project.scenes.map((s) => s.transitionSeconds), [3, 0, 1, 1]);
  assert.equal(project.scenes[0].motion, "zoom-in");
  assert.equal(project.scenes[0].transition, "fade");
  assert.deepEqual(project.scenes.map((s) => [s.caption, s.narration]), [[null, null], [null, null], [null, null], [null, null]]);
  assert.deepEqual(project.audio, { musicUrl: null, musicVolume: 1, narration: true, language: DEFAULT_LANGUAGE });
  assert.equal(parsed({ scenes: [good()], audio: { musicVolume: -1 } }).project.audio.musicVolume, 0);
});

test("scenes with unsafe pictures are dropped and reported by their place", () => {
  const { project, warnings } = parsed({
    scenes: [good({ id: "a" }), { imageUrl: "http://x/b.jpg" }, null, good({ id: "d" })],
  });
  assert.deepEqual(project.scenes.map((s) => s.id), ["a", "d"]);
  assert.deepEqual(warnings, [{ code: "scene_dropped", index: 1 }, { code: "scene_dropped", index: 2 }]);
});

test("picture addresses are trimmed and music may come from the phone", () => {
  const { project } = parsed({
    scenes: [good({ imageUrl: "  https://x/a.jpg  " })],
    audio: { musicUrl: " blob:https://app/1 " },
  });
  assert.equal(project.scenes[0].imageUrl, "https://x/a.jpg");
  assert.equal(project.audio.musicUrl, "blob:https://app/1");
  assert.equal(parsed({ scenes: [good()], audio: { musicUrl: "data:audio/mp3;base64,AAAA" } }).project.audio.musicUrl, null);
});

test("scene ids are never empty and never repeated", () => {
  const { project } = parsed({ scenes: [good({ id: "x" }), good({ id: "x" }), good({ id: "  " }), good()] });
  const ids = project.scenes.map((s) => s.id);
  assert.equal(new Set(ids).size, 4);
  assert.equal(ids[0], "x");
  assert.ok(ids.every((id) => id.length > 0));
});

test("long texts are cut by letters, never in the middle of one", () => {
  const long = "😀".repeat(STUDIO_LIMITS.maxCaptionChars + 50);
  const { project } = parsed({
    title: "ا".repeat(500),
    scenes: [good({ caption: long, narration: "n".repeat(5000) })],
  });
  assert.equal(Array.from(project.scenes[0].caption!).length, STUDIO_LIMITS.maxCaptionChars);
  assert.equal(project.scenes[0].narration!.length, STUDIO_LIMITS.maxNarrationChars);
  assert.equal(Array.from(project.title).length, STUDIO_LIMITS.maxTitleChars);
});

test("too many scenes lose the last ones and it is reported", () => {
  const scenes = Array.from({ length: 250 }, (_, i) => good({ id: `s${i}`, seconds: 1, transitionSeconds: 0 }));
  const { project, warnings } = parsed({ scenes });
  assert.equal(project.scenes.length, STUDIO_LIMITS.maxScenes);
  assert.equal(project.scenes[0].id, "s0");
  assert.deepEqual(warnings, [{ code: "scenes_truncated", kept: STUDIO_LIMITS.maxScenes }]);
});

test("too long a film loses its last scenes, never the first, and fits the limit", () => {
  const scenes = Array.from({ length: 40 }, (_, i) => good({ id: `s${i}`, seconds: 60, transition: "cut" }));
  const { project, warnings } = parsed({ scenes });
  assert.equal(project.scenes.length, 10);
  assert.equal(project.scenes[0].id, "s0");
  assert.ok(buildTimeline(project).totalSeconds <= STUDIO_LIMITS.maxSeconds);
  assert.deepEqual(warnings, [{ code: "duration_truncated", kept: 10 }]);

  const exact = parsed({ scenes: Array.from({ length: 10 }, () => good({ seconds: 60, transition: "cut" })) });
  assert.deepEqual(exact.warnings, []);
});

test("the cleaned project is a fixed point: cleaning it again changes nothing", () => {
  const first = parsed({
    title: " t ", scenes: [good({ seconds: 500, caption: " c " }), good({ id: "q", transitionSeconds: 9 })],
    audio: { musicVolume: 3 },
  });
  const second = parsed(first.project);
  assert.deepEqual(second.project, first.project);
  assert.deepEqual(second.warnings, []);
});
