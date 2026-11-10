// tests/video/video-mode.test.ts
// The video mode opens from the /video address, keeps the address in step with
// the mode, survives sending and leaving a chat, and holds sending back only
// when the engine is switched off. Pure code, nothing faked.

import test from "node:test";
import assert from "node:assert/strict";

import {
  HOME_PATH,
  VIDEO_ENGINE_READY,
  VIDEO_MODE_ID,
  VIDEO_PATH,
  initialModeId,
  isVideoBlocked,
  isVideoPath,
  modeAfterLeavingChat,
  modeAfterSending,
  pathForMode,
} from "../../src/features/video/videoMode.ts";

test("only /video (with or without a closing slash, any case) is the video address", () => {
  assert.equal(isVideoPath("/video"), true);
  assert.equal(isVideoPath("/video/"), true);
  assert.equal(isVideoPath("/Video"), true);
  assert.equal(isVideoPath("/VIDEO//"), true);
  assert.equal(isVideoPath("/"), false);
  assert.equal(isVideoPath(""), false);
  assert.equal(isVideoPath("/videos"), false);
  assert.equal(isVideoPath("/video/x"), false);
  assert.equal(isVideoPath("/a/video"), false);
});

test("the chat starts in video mode only when opened at the video address", () => {
  assert.equal(initialModeId("/video"), VIDEO_MODE_ID);
  assert.equal(initialModeId("/video/"), VIDEO_MODE_ID);
  assert.equal(initialModeId("/"), null);
  assert.equal(initialModeId("/anything"), null);
});

test("the address follows the mode and is only changed when it is wrong", () => {
  assert.equal(pathForMode(VIDEO_MODE_ID, "/"), VIDEO_PATH);
  assert.equal(pathForMode(VIDEO_MODE_ID, "/video"), null);
  assert.equal(pathForMode(VIDEO_MODE_ID, "/video/"), null);
  assert.equal(pathForMode(null, "/video"), HOME_PATH);
  assert.equal(pathForMode(null, "/"), null);
});

test("other modes never touch the address", () => {
  assert.equal(pathForMode("web", "/"), null);
  assert.equal(pathForMode("learn", "/"), null);
  assert.equal(pathForMode("web", "/video"), HOME_PATH);
});

test("sending keeps the video mode and ends every other mode", () => {
  assert.equal(modeAfterSending(VIDEO_MODE_ID), VIDEO_MODE_ID);
  assert.equal(modeAfterSending("web"), null);
  assert.equal(modeAfterSending("learn"), null);
  assert.equal(modeAfterSending(null), null);
});

test("leaving a chat keeps the video mode and ends every other mode", () => {
  assert.equal(modeAfterLeavingChat(VIDEO_MODE_ID), VIDEO_MODE_ID);
  assert.equal(modeAfterLeavingChat("product"), null);
  assert.equal(modeAfterLeavingChat(null), null);
});

test("the video engine is switched on, so the video mode lets messages through", () => {
  assert.equal(VIDEO_ENGINE_READY, true);
  assert.equal(isVideoBlocked(VIDEO_MODE_ID), false);
});

test("no other mode is ever held back by the video engine", () => {
  assert.equal(isVideoBlocked("web"), false);
  assert.equal(isVideoBlocked("learn"), false);
  assert.equal(isVideoBlocked(null), false);
});
