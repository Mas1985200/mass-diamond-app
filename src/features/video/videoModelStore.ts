// src/features/video/videoModelStore.ts
// Remembers which video model the person picked, on this device. Pure code:
// the storage is given in, so the rules are tested without a browser. Storage
// can be missing or can throw (private window, blocked site data), so every
// read and write is guarded and the chooser works without it.

import { AUTO_MODEL_ID } from "./videoModels.ts";

export const MODEL_STORAGE_KEY = "md.video.model";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const MAX_ID_CHARS = 64;

// The two calls of a browser's localStorage the chooser needs.
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// The saved model id, or null when nothing usable is saved. A saved value that
// is not a plain id is ignored, never trusted.
export function readSavedModel(storage: KeyValueStorage | null): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(MODEL_STORAGE_KEY)?.trim() ?? "";
    if (!value || value.length > MAX_ID_CHARS || !ID_PATTERN.test(value)) return null;
    return value.toLowerCase() === AUTO_MODEL_ID ? null : value;
  } catch {
    return null;
  }
}

// Saves the pick. Auto is saved as "auto" so that a later pick of Auto clears
// an older model. Returns false when nothing could be saved.
export function writeSavedModel(storage: KeyValueStorage | null, id: string): boolean {
  if (!storage) return false;
  const value = id.trim();
  if (!value || value.length > MAX_ID_CHARS || !ID_PATTERN.test(value)) return false;
  try {
    storage.setItem(MODEL_STORAGE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

// end of videoModelStore.ts
