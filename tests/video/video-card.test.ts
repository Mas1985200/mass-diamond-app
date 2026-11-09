// tests/video/video-card.test.ts
// The pure rules of the video card: reading the card and the answers, what
// the card shows, when to ask again and the texts.

import test from "node:test";
import assert from "node:assert/strict";

import {
  cssRatio,
  downloadName,
  failureText,
  formatPercent,
  isFinalAnswerError,
  isFinishedView,
  nextPollDelayMs,
  parseJobAnswer,
  parseVideoCard,
  safeHttpsUrl,
  viewOf,
  VIDEO_CARD_TEXT,
  POLL_FAIL_MAX_MS,
  POLL_FIRST_MS,
  POLL_HIDDEN_MS,
  POLL_MAX_MS,
  type VideoJob,
} from "../../src/features/video/videoCard.ts";

const ID = "3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b";

test("a valid card is read and cleaned; a card without a real job id is dropped", () => {
  assert.deepEqual(
    parseVideoCard({ t: "video", lang: "en", jobId: ID.toUpperCase(), aspectRatio: "9:16", durationSeconds: 4.4, quality: "high" }),
    { t: "video", lang: "en", jobId: ID, aspectRatio: "9:16", durationSeconds: 4, quality: "high" },
  );
  assert.equal(parseVideoCard({ t: "video", jobId: "nope" }), null);
  assert.equal(parseVideoCard({ t: "video" }), null);
  const odd = parseVideoCard({ t: "video", jobId: ID, lang: "xx", aspectRatio: "4:3", durationSeconds: 9999, quality: "ultra" });
  assert.deepEqual(odd, { t: "video", lang: "fa", jobId: ID, aspectRatio: "16:9", durationSeconds: 60, quality: "standard" });
  assert.equal(parseVideoCard({ t: "video", jobId: ID, durationSeconds: -3 })?.durationSeconds, 1);
  assert.equal(parseVideoCard({ t: "video", jobId: ID, durationSeconds: "5" })?.durationSeconds, 5);
});

test("only plain https addresses are used", () => {
  assert.equal(safeHttpsUrl("https://x.supabase.co/a.mp4?token=1"), "https://x.supabase.co/a.mp4?token=1");
  for (const bad of ["http://x.com/a.mp4", "javascript:alert(1)", "data:video/mp4;base64,AAA", "https://x.com/a b", 'https://x.com/"', "", null, 5, "https://" + "a".repeat(5000)]) {
    assert.equal(safeHttpsUrl(bad), null);
  }
});

test("a succeeded answer carries the links, others never do", () => {
  const done = parseJobAnswer({ ok: true, job: { id: ID, status: "succeeded", progress: 100, videoUrl: "https://v/x.mp4", thumbnailUrl: "http://bad/t.jpg" } });
  assert.deepEqual(done, { ok: true, job: { id: ID, status: "succeeded", progress: 100, errorCode: null, videoUrl: "https://v/x.mp4", thumbnailUrl: null } });
  const working = parseJobAnswer({ ok: true, job: { id: ID, status: "processing", progress: 140.6, videoUrl: "https://v/x.mp4" } });
  assert.equal(working.ok && working.job.progress, 100);
  assert.equal(working.ok && working.job.videoUrl, null);
  const failed = parseJobAnswer({ ok: true, job: { id: ID, status: "failed", progress: 0, errorCode: "timeout" } });
  assert.equal(failed.ok && failed.job.errorCode, "timeout");
  const negative = parseJobAnswer({ ok: true, job: { id: ID, status: "queued", progress: -5 } });
  assert.equal(negative.ok && negative.job.progress, 0);
});

test("error answers and strange answers are understood without throwing", () => {
  assert.deepEqual(parseJobAnswer({ ok: false, error: { code: "JOB_NOT_FOUND", retryable: false } }), { ok: false, code: "JOB_NOT_FOUND", retryable: false });
  assert.deepEqual(parseJobAnswer({ ok: false, error: { code: "INTERNAL_ERROR", retryable: true } }), { ok: false, code: "INTERNAL_ERROR", retryable: true });
  for (const strange of [null, undefined, 5, "x", [], {}, { ok: true }, { ok: true, job: {} }, { ok: true, job: { id: "bad", status: "queued" } }, { ok: true, job: { id: ID, status: "weird" } }]) {
    const answer = parseJobAnswer(strange);
    assert.equal(answer.ok, false);
    assert.equal(answer.ok === false && answer.retryable, true);
  }
});

function job(over: Partial<VideoJob>): VideoJob {
  return { id: ID, status: "queued", progress: 0, errorCode: null, videoUrl: null, thumbnailUrl: null, ...over };
}

test("the card shows what the job is, and never a ready video without a link", () => {
  assert.deepEqual(viewOf(null, false), { kind: "starting" });
  assert.deepEqual(viewOf(null, true), { kind: "missing" });
  assert.deepEqual(viewOf(job({}), false), { kind: "queued" });
  assert.deepEqual(viewOf(job({ status: "processing", progress: 40 }), false), { kind: "working", progress: 40 });
  assert.deepEqual(viewOf(job({ status: "succeeded", videoUrl: "https://v/x.mp4", thumbnailUrl: "https://v/t.jpg" }), false), { kind: "ready", videoUrl: "https://v/x.mp4", posterUrl: "https://v/t.jpg" });
  assert.deepEqual(viewOf(job({ status: "succeeded" }), false), { kind: "failed", code: "no_video" });
  assert.deepEqual(viewOf(job({ status: "failed", errorCode: "timeout" }), false), { kind: "failed", code: "timeout" });
  assert.deepEqual(viewOf(job({ status: "failed" }), false), { kind: "failed", code: "unknown" });
  assert.deepEqual(viewOf(job({ status: "canceled" }), false), { kind: "canceled" });
});

test("which views end the asking", () => {
  assert.equal(isFinishedView({ kind: "starting" }), false);
  assert.equal(isFinishedView({ kind: "queued" }), false);
  assert.equal(isFinishedView({ kind: "working", progress: 1 }), false);
  for (const view of [{ kind: "ready", videoUrl: "https://v", posterUrl: null }, { kind: "failed", code: "x" }, { kind: "canceled" }, { kind: "missing" }] as const) {
    assert.equal(isFinishedView(view), true);
  }
});

test("the waiting time grows calmly, backs off on failures and slows when hidden", () => {
  const base = { workingAnswers: 0, failuresInRow: 0, hidden: false };
  assert.equal(nextPollDelayMs(base), POLL_FIRST_MS);
  assert.ok(nextPollDelayMs({ ...base, workingAnswers: 5 }) > POLL_FIRST_MS);
  assert.equal(nextPollDelayMs({ ...base, workingAnswers: 1000 }), POLL_MAX_MS);
  assert.equal(nextPollDelayMs({ ...base, failuresInRow: 1 }), 5_000);
  assert.equal(nextPollDelayMs({ ...base, failuresInRow: 2 }), 10_000);
  assert.equal(nextPollDelayMs({ ...base, failuresInRow: 3 }), 20_000);
  assert.equal(nextPollDelayMs({ ...base, failuresInRow: 99 }), POLL_FAIL_MAX_MS);
  assert.equal(nextPollDelayMs({ ...base, hidden: true }), POLL_HIDDEN_MS);
  assert.equal(nextPollDelayMs({ workingAnswers: NaN, failuresInRow: NaN, hidden: false }), POLL_FIRST_MS);
  assert.equal(nextPollDelayMs({ workingAnswers: -4, failuresInRow: -1, hidden: false }), POLL_FIRST_MS);
});

test("a missing video or a refusal is final; a temporary trouble is tried again", () => {
  assert.equal(isFinalAnswerError("JOB_NOT_FOUND", true), true);
  assert.equal(isFinalAnswerError("AUTH_REQUIRED", true), true);
  assert.equal(isFinalAnswerError("INVALID_REQUEST", false), true);
  assert.equal(isFinalAnswerError("INTERNAL_ERROR", true), false);
  assert.equal(isFinalAnswerError("UNKNOWN", true), false);
});

test("numbers follow the language and every failure has a text", () => {
  assert.equal(formatPercent(45, "fa"), "۴۵٪");
  assert.equal(formatPercent(45, "en"), "45%");
  assert.equal(formatPercent(7.6, "en"), "8%");
  const known = ["content_rejected", "unsupported_request", "timeout", "no_engine", "not_configured", "quota_exhausted", "rate_limited", "engine_busy", "no_video"];
  for (const lang of ["fa", "en"] as const) {
    for (const code of known) assert.ok(failureText(code, lang).length > 10, `${lang} ${code}`);
    assert.equal(failureText("something_new", lang).length > 10, true);
    assert.notEqual(failureText("timeout", lang), failureText("something_new", lang));
  }
  assert.equal(Object.keys(VIDEO_CARD_TEXT.fa).sort().join(), Object.keys(VIDEO_CARD_TEXT.en).sort().join());
});

test("the box ratio and the download name are safe", () => {
  assert.equal(cssRatio("9:16"), "9 / 16");
  assert.equal(cssRatio("16:9"), "16 / 9");
  assert.equal(downloadName(ID), "mass-diamond-3f2b8c1e.mp4");
  assert.equal(downloadName("../../x"), "mass-diamond-x.mp4");
  assert.equal(downloadName(""), "mass-diamond-video.mp4");
});
