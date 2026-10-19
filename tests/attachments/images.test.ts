// tests/attachments/images.test.ts
// Photos from the app are accepted only when they are real jpeg, png or webp
// data URLs within the limits.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PHOTO_QUESTION,
  MAX_IMAGES,
  MAX_IMAGE_CHARS,
  buildUserContent,
  parseImages,
} from "../../supabase/functions/ai-chat/attachments/images.ts";

function dataUrl(mime: string, head: readonly number[], size = 64): string {
  const bytes = Buffer.alloc(size);

  Buffer.from(head).copy(bytes);

  return `data:image/${mime};base64,${bytes.toString("base64")}`;
}

const JPEG = dataUrl("jpeg", [0xff, 0xd8, 0xff, 0xe0]);
const PNG = dataUrl("png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = dataUrl("webp", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

test("parseImages: nothing attached gives an empty list", () => {
  assert.deepEqual(parseImages(undefined), []);
  assert.deepEqual(parseImages(null), []);
  assert.deepEqual(parseImages([]), []);
});

test("parseImages: real jpeg, png and webp files pass", () => {
  assert.deepEqual(parseImages([JPEG, PNG, WEBP]), [JPEG, PNG, WEBP]);
});

test("parseImages: more than the limit is refused", () => {
  assert.throws(() => parseImages(Array(MAX_IMAGES + 1).fill(JPEG)), /At most/);
});

test("parseImages: other formats and non-pictures are refused", () => {
  assert.throws(() => parseImages(["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="]));
  assert.throws(() => parseImages([dataUrl("gif", [0x47, 0x49, 0x46, 0x38])]));
  assert.throws(() => parseImages(["https://example.com/a.jpg"]));
  assert.throws(() => parseImages([42]));
  assert.throws(() => parseImages("not a list"));
});

test("parseImages: the file must match the format it claims", () => {
  assert.throws(() => parseImages([dataUrl("png", [0xff, 0xd8, 0xff, 0xe0])]));
  assert.throws(() => parseImages([dataUrl("jpeg", [0x00, 0x01, 0x02, 0x03])]));
  assert.throws(() => parseImages([dataUrl("webp", [0x52, 0x49, 0x46, 0x46])]));
});

test("parseImages: broken base64 is refused", () => {
  assert.throws(() => parseImages(["data:image/jpeg;base64,/9j/4AAQ$$$$"]));
  assert.throws(() => parseImages(["data:image/jpeg;base64,/9j/"]));
});

test("parseImages: a photo over the size limit is refused", () => {
  const huge = dataUrl("jpeg", [0xff, 0xd8, 0xff, 0xe0], MAX_IMAGE_CHARS);

  assert.throws(() => parseImages([huge]), /too large/);
});

test("buildUserContent: text only stays a plain string", () => {
  assert.equal(buildUserContent("hello", undefined), "hello");
  assert.equal(buildUserContent("hello", []), "hello");
});

test("buildUserContent: photos follow the text, with a default question", () => {
  assert.deepEqual(buildUserContent("what is it?", [JPEG]), [
    { type: "text", text: "what is it?" },
    { type: "image_url", image_url: { url: JPEG } },
  ]);

  const bare = buildUserContent("  ", [JPEG, PNG]);

  assert.ok(Array.isArray(bare));
  assert.deepEqual(bare[0], { type: "text", text: DEFAULT_PHOTO_QUESTION });
  assert.equal(bare.length, 3);
});
