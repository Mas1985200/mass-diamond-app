// tests/video/video-model-store.test.ts
// Remembering the picked video model, with a fake storage.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MODEL_STORAGE_KEY,
  readSavedModel,
  writeSavedModel,
  type KeyValueStorage,
} from "../../src/features/video/videoModelStore.ts";

function memory(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const broken: KeyValueStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

test("a saved model is read back", () => {
  const storage = memory();
  assert.equal(readSavedModel(storage), null);
  assert.equal(writeSavedModel(storage, "fal-wan22"), true);
  assert.equal(storage.data[MODEL_STORAGE_KEY], "fal-wan22");
  assert.equal(readSavedModel(storage), "fal-wan22");
});

test("Auto reads as nothing saved, and saving Auto replaces an older model", () => {
  const storage = memory();
  writeSavedModel(storage, "fal-wan22");
  writeSavedModel(storage, "auto");
  assert.equal(storage.data[MODEL_STORAGE_KEY], "auto");
  assert.equal(readSavedModel(storage), null);
  assert.equal(readSavedModel(memory({ [MODEL_STORAGE_KEY]: "AUTO" })), null);
});

test("a saved value that is not a plain id is ignored", () => {
  for (const bad of ["", "  ", "a b", "../x", "<script>", "a".repeat(65)]) {
    assert.equal(readSavedModel(memory({ [MODEL_STORAGE_KEY]: bad })), null);
  }
  assert.equal(readSavedModel(memory({ [MODEL_STORAGE_KEY]: " ok-1 " })), "ok-1");
});

test("a value that is not a plain id is never written", () => {
  const storage = memory();
  for (const bad of ["", "  ", "a b", "../x", "a".repeat(65)]) {
    assert.equal(writeSavedModel(storage, bad), false);
  }
  assert.deepEqual(storage.data, {});
});

test("no storage, or a storage that throws, never breaks anything", () => {
  assert.equal(readSavedModel(null), null);
  assert.equal(writeSavedModel(null, "fal-wan22"), false);
  assert.equal(readSavedModel(broken), null);
  assert.equal(writeSavedModel(broken, "fal-wan22"), false);
});

// end of video-model-store.test.ts
