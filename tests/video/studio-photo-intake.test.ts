// tests/video/studio-photo-intake.test.ts
// A photo from the phone camera: what counts as a photo, how it is shrunk, what
// happens with files that are too big, too small, broken or not pictures, that the
// decoded picture is always released, and the real browser parts with a fake
// browser. No browser.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_SIDE,
  createBrowserPhotoDeps,
  fitWithin,
  importPhoto,
  isPhotoFile,
  releasePhoto,
  type DecodedPhoto,
  type PhotoDeps,
  type PhotoScope,
} from "../../src/features/video/studio/photoIntake.ts";

const FILE = { type: "image/jpeg", size: 3_000_000, name: "IMG_1.jpg" };

function deps(over: Partial<PhotoDeps> & { width?: number; height?: number } = {}) {
  const events: string[] = [];
  const rendered: Array<[number, number]> = [];
  const photo: DecodedPhoto = {
    width: over.width ?? 4000, height: over.height ?? 3000, source: "bitmap",
    close: () => { events.push("closed"); },
  };
  const d: PhotoDeps = {
    decode: over.decode ?? (async () => photo),
    render: over.render ?? (async (_p, w, h) => { rendered.push([w, h]); return new Blob(["jpegbytes"]); }),
    createUrl: over.createUrl ?? (() => "blob:https://app/photo-1"),
    revokeUrl: (url) => { events.push(`revoked ${url}`); },
  };
  return { d, events, rendered };
}

test("pictures are accepted by type, by name when the type is missing, and SVG is refused", () => {
  assert.equal(isPhotoFile({ type: "image/jpeg", size: 1 }), true);
  assert.equal(isPhotoFile({ type: "IMAGE/PNG", size: 1 }), true);
  assert.equal(isPhotoFile({ type: "image/heic", size: 1 }), true);
  assert.equal(isPhotoFile({ type: "", size: 1, name: "photo.HEIC" }), true);
  assert.equal(isPhotoFile({ type: "", size: 1, name: "notes.txt" }), false);
  assert.equal(isPhotoFile({ type: "", size: 1 }), false);
  assert.equal(isPhotoFile({ type: "image/svg+xml", size: 1, name: "a.svg" }), false);
  assert.equal(isPhotoFile({ type: "application/pdf", size: 1, name: "a.jpg" }), false);
  assert.equal(isPhotoFile({ type: "video/mp4", size: 1 }), false);
});

test("a big photo is shrunk to the longest side and keeps its shape", () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 1920, height: 1440 });
  assert.deepEqual(fitWithin(3000, 4000), { width: 1440, height: 1920 });
  assert.deepEqual(fitWithin(1920, 1080), { width: 1920, height: 1080 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(100000, 10), { width: 1920, height: 1 });
  assert.deepEqual(fitWithin(5000, 5000, 1000), { width: 1000, height: 1000 });
});

test("a good photo gives a phone address with the shrunk size", async () => {
  const { d, rendered, events } = deps();
  const result = await importPhoto(FILE, d);
  assert.deepEqual(result, { ok: true, url: "blob:https://app/photo-1", width: 1920, height: 1440, bytes: 9 });
  assert.deepEqual(rendered, [[1920, 1440]]);
  assert.deepEqual(events, ["closed"]);
  assert.ok(MAX_PHOTO_SIDE === 1920);
});

test("things that are not photos, empty files and huge files are refused before reading", async () => {
  let decoded = 0;
  const { d } = deps({ decode: async () => { decoded++; throw new Error("not used"); } });
  assert.deepEqual(await importPhoto({ type: "text/plain", size: 10 }, d), { ok: false, code: "not_image" });
  assert.deepEqual(await importPhoto({ ...FILE, size: 0 }, d), { ok: false, code: "unreadable" });
  assert.deepEqual(await importPhoto({ ...FILE, size: MAX_PHOTO_BYTES + 1 }, d), { ok: false, code: "too_large" });
  assert.equal(decoded, 0);
  const exact = deps();
  assert.ok((await importPhoto({ ...FILE, size: MAX_PHOTO_BYTES }, exact.d)).ok);
});

test("a file that cannot be read as a picture is unreadable", async () => {
  const { d } = deps({ decode: async () => { throw new Error("bad data"); } });
  assert.deepEqual(await importPhoto(FILE, d), { ok: false, code: "unreadable" });
  const zero = deps({ width: 0, height: 0 });
  assert.deepEqual(await importPhoto(FILE, zero.d), { ok: false, code: "unreadable" });
  assert.deepEqual(zero.events, ["closed"]);
});

test("a tiny picture is refused and released", async () => {
  const { d, events } = deps({ width: 40, height: 30 });
  assert.deepEqual(await importPhoto(FILE, d), { ok: false, code: "too_small" });
  assert.deepEqual(events, ["closed"]);
});

test("a drawing that fails or gives nothing is a failure and the picture is released", async () => {
  for (const render of [
    async () => null,
    async () => new Blob([]),
    async () => { throw new Error("canvas"); },
  ]) {
    const { d, events } = deps({ render });
    assert.deepEqual(await importPhoto(FILE, d), { ok: false, code: "failed" });
    assert.deepEqual(events, ["closed"]);
  }
  const noUrl = deps({ createUrl: () => { throw new Error("no URL"); } });
  assert.deepEqual(await importPhoto(FILE, noUrl.d), { ok: false, code: "failed" });
});

test("only phone addresses are released, and a failing release is harmless", () => {
  const { d, events } = deps();
  releasePhoto("blob:https://app/photo-1", d);
  releasePhoto("https://x/a.jpg", d);
  assert.deepEqual(events, ["revoked blob:https://app/photo-1"]);
  assert.doesNotThrow(() => releasePhoto("blob:x", { revokeUrl: () => { throw new Error("gone"); } }));
  assert.doesNotThrow(() => releasePhoto("blob:x", {}));
});

function fakeScope(over: Partial<PhotoScope> & { orientationFails?: boolean; noContext?: boolean; blobNull?: boolean } = {}) {
  const log: string[] = [];
  const scope: PhotoScope = {
    createImageBitmap: async (_file, options) => {
      log.push(options ? `bitmap ${options.imageOrientation}` : "bitmap plain");
      if (options && over.orientationFails) throw new Error("option not supported");
      return { width: 800, height: 600, close: () => { log.push("bitmap closed"); } };
    },
    document: {
      createElement: () => {
        const canvas = {
          width: 0, height: 0,
          getContext: () => over.noContext ? null : {
            drawImage: (_s: never, x: number, y: number, w: number, h: number) => { log.push(`draw ${x},${y},${w},${h} on ${canvas.width}x${canvas.height}`); },
          },
          toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => {
            log.push(`toBlob ${type} ${quality}`);
            cb(over.blobNull ? null : new Blob(["x"]));
          },
        };
        return canvas;
      },
    },
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: (u) => { log.push(`revoke ${u}`); } },
    ...over,
  };
  return { scope, log };
}

test("the real parts: decode upright, draw at the new size, save as JPEG, make and free the address", async () => {
  const { scope, log } = fakeScope();
  const result = await importPhoto(FILE, createBrowserPhotoDeps(scope));
  assert.deepEqual(result, { ok: true, url: "blob:fake", width: 800, height: 600, bytes: 1 });
  assert.deepEqual(log, ["bitmap from-image", "draw 0,0,800,600 on 800x600", "toBlob image/jpeg 0.9", "bitmap closed"]);
  releasePhoto("blob:fake", createBrowserPhotoDeps(scope));
  assert.equal(log[log.length - 1], "revoke blob:fake");
});

test("a browser that does not know the orientation option still reads the photo", async () => {
  const { scope, log } = fakeScope({ orientationFails: true });
  assert.ok((await importPhoto(FILE, createBrowserPhotoDeps(scope))).ok);
  assert.deepEqual(log.slice(0, 2), ["bitmap from-image", "bitmap plain"]);
});

test("a browser that lacks pieces gives clear failures, not crashes", async () => {
  assert.deepEqual(await importPhoto(FILE, createBrowserPhotoDeps({})), { ok: false, code: "unreadable" });
  assert.deepEqual(await importPhoto(FILE, createBrowserPhotoDeps(fakeScope({ noContext: true }).scope)), { ok: false, code: "failed" });
  assert.deepEqual(await importPhoto(FILE, createBrowserPhotoDeps(fakeScope({ blobNull: true }).scope)), { ok: false, code: "failed" });
  const noUrl = fakeScope({ URL: undefined });
  assert.deepEqual(await importPhoto(FILE, createBrowserPhotoDeps(noUrl.scope)), { ok: false, code: "failed" });
});
