// tests/video/studio-load-images.test.ts
// Getting the pictures ready: only safe addresses are loaded, one address is
// loaded once, only a few load at a time, a broken or slow picture fails alone,
// and progress and cancelling work. No browser, no network.

import test from "node:test";
import assert from "node:assert/strict";

import {
  isLoadableImageUrl,
  loadSceneImages,
  type ImageLoader,
} from "../../src/features/video/studio/loadImages.ts";
import type { StudioScene } from "../../src/features/video/studio/types.ts";

function scene(id: string, imageUrl: string): StudioScene {
  return {
    id, imageUrl, seconds: 5, motion: "still", transition: "cut",
    transitionSeconds: 0, caption: null, narration: null,
  };
}

const ok: ImageLoader = async () => ({ width: 100, height: 50 });

test("only https, phone-made and small inline pictures are loadable", () => {
  for (const good of [
    "https://example.com/a.jpg",
    "HTTPS://example.com/a.jpg",
    "blob:https://app.example/1234-5678",
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/jpeg;base64,/9j/4AAQ",
  ]) assert.equal(isLoadableImageUrl(good), true, good);
  for (const bad of [
    "", "   ", "http://example.com/a.jpg", "javascript:alert(1)", "file:///etc/passwd",
    "ftp://x/a.png", "//example.com/a.jpg", "https://", "blob:", "data:text/html;base64,PGgxPg==",
    "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png,rawdata", "/relative.png",
  ]) assert.equal(isLoadableImageUrl(bad), false, bad);
  assert.equal(isLoadableImageUrl(undefined as unknown as string), false);
});

test("every scene gets its picture by its index", async () => {
  const scenes = [scene("a", "https://x/1.jpg"), scene("b", "https://x/2.jpg")];
  const loader: ImageLoader = async (url) => ({ width: url.endsWith("1.jpg") ? 10 : 20, height: 5 });
  const result = await loadSceneImages(scenes, { loader });
  assert.deepEqual(result.failed, []);
  assert.equal(result.cancelled, false);
  assert.equal(result.images.get(0)!.width, 10);
  assert.equal(result.images.get(1)!.width, 20);
});

test("an address used by several scenes is loaded once", async () => {
  const asked: string[] = [];
  const loader: ImageLoader = async (url) => { asked.push(url); return { width: 1, height: 1 }; };
  const scenes = [scene("a", "https://x/1.jpg"), scene("b", " https://x/1.jpg "), scene("c", "https://x/2.jpg")];
  const result = await loadSceneImages(scenes, { loader });
  assert.deepEqual(asked.sort(), ["https://x/1.jpg", "https://x/2.jpg"]);
  assert.deepEqual([...result.images.keys()], [0, 1, 2]);
});

test("unsafe addresses are never loaded and their scenes are reported", async () => {
  const asked: string[] = [];
  const loader: ImageLoader = async (url) => { asked.push(url); return { width: 1, height: 1 }; };
  const scenes = [scene("a", "http://x/1.jpg"), scene("b", "javascript:alert(1)"), scene("c", ""), scene("d", "https://x/ok.jpg")];
  const result = await loadSceneImages(scenes, { loader });
  assert.deepEqual(asked, ["https://x/ok.jpg"]);
  assert.deepEqual(result.failed, [0, 1, 2]);
  assert.deepEqual([...result.images.keys()], [3]);
});

test("a broken picture, a slow one and one with no size fail alone", async () => {
  const loader: ImageLoader = async (url) => {
    if (url.endsWith("broken.jpg")) throw new Error("404");
    if (url.endsWith("slow.jpg")) return new Promise(() => {});
    if (url.endsWith("empty.jpg")) return { width: 0, height: 0 };
    return { width: 4, height: 3 };
  };
  const scenes = [
    scene("a", "https://x/broken.jpg"), scene("b", "https://x/slow.jpg"),
    scene("c", "https://x/empty.jpg"), scene("d", "https://x/fine.jpg"),
  ];
  const result = await loadSceneImages(scenes, { loader, timeoutMs: 20 });
  assert.deepEqual(result.failed, [0, 1, 2]);
  assert.deepEqual([...result.images.keys()], [3]);
});

test("only the allowed number of pictures load at the same time", async () => {
  let running = 0;
  let peak = 0;
  const loader: ImageLoader = async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    return { width: 1, height: 1 };
  };
  const scenes = Array.from({ length: 12 }, (_, i) => scene(`s${i}`, `https://x/${i}.jpg`));
  const result = await loadSceneImages(scenes, { loader, concurrency: 3 });
  assert.equal(result.images.size, 12);
  assert.equal(peak, 3);
  const nonsense = await loadSceneImages(scenes.slice(0, 2), { loader, concurrency: 0 });
  assert.equal(nonsense.images.size, 2);
});

test("progress counts every different picture once, up to the total", async () => {
  const seen: Array<[number, number]> = [];
  const scenes = [scene("a", "https://x/1.jpg"), scene("b", "https://x/1.jpg"), scene("c", "http://x/bad.jpg"), scene("d", "https://x/2.jpg")];
  await loadSceneImages(scenes, { loader: ok, concurrency: 1, onProgress: (d, t) => seen.push([d, t]) });
  assert.deepEqual(seen, [[1, 3], [2, 3], [3, 3]]);
});

test("cancelling stops the loading and says so", async () => {
  const asked: string[] = [];
  const loader: ImageLoader = async (url) => { asked.push(url); return { width: 1, height: 1 }; };
  const scenes = Array.from({ length: 10 }, (_, i) => scene(`s${i}`, `https://x/${i}.jpg`));
  const result = await loadSceneImages(scenes, { loader, concurrency: 1, isCancelled: () => asked.length >= 2 });
  assert.equal(result.cancelled, true);
  assert.equal(asked.length, 2);
});

test("no scenes is nothing to load", async () => {
  assert.deepEqual(await loadSceneImages([], { loader: ok }), { images: new Map(), failed: [], cancelled: false });
});
