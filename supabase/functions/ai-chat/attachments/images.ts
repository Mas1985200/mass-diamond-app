// supabase/functions/ai-chat/attachments/images.ts
// Photos the user attaches to a message: strict validation of what arrives
// (data URLs of real jpeg, png or webp files, within size limits) and the
// message format the vision model expects. Photos are never stored.

import type { OAIContentPart } from "../types.ts";

export const MAX_IMAGES = 3;
// Limits are on the whole data URL text. The app shrinks every photo before
// sending, so these are generous safety limits, not normal sizes.
export const MAX_IMAGE_CHARS = 1_500_000;
export const MAX_TOTAL_IMAGE_CHARS = 3_500_000;

// Used when the user sends a photo without any words.
export const DEFAULT_PHOTO_QUESTION = "What is in this photo?";

const DATA_URL_PATTERN =
  /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const SIGNATURE_BASE64_CHARS = 16;

// The first bytes of the file must match the format the data URL claims, so
// anything that is not a real picture is refused.
function matchesFormat(format: string, base64: string): boolean {
  if (base64.length < SIGNATURE_BASE64_CHARS || base64.length % 4 !== 0) {
    return false;
  }

  let head: string;

  try {
    head = atob(base64.slice(0, SIGNATURE_BASE64_CHARS));
  } catch {
    return false;
  }

  const bytes = Array.from(head, (char) => char.charCodeAt(0));

  switch (format) {
    case "jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "png":
      return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value,
      );
    case "webp":
      return (
        String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
      );
    default:
      return false;
  }
}

// Throws an error with a clear message when anything is wrong, so a photo is
// never silently dropped while the user thinks it was seen.
export function parseImages(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("Photos must be a list.");
  }

  if (value.length > MAX_IMAGES) {
    throw new Error(`At most ${MAX_IMAGES} photos can be attached.`);
  }

  const images: string[] = [];
  let total = 0;

  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("A photo is not valid.");
    }

    if (item.length > MAX_IMAGE_CHARS) {
      throw new Error("A photo is too large.");
    }

    const match = DATA_URL_PATTERN.exec(item);
    const format = match?.[1];
    const base64 = match?.[2];

    if (!format || !base64 || !matchesFormat(format, base64)) {
      throw new Error("Only jpeg, png and webp photos are supported.");
    }

    total += item.length;

    if (total > MAX_TOTAL_IMAGE_CHARS) {
      throw new Error("The photos are too large together.");
    }

    images.push(item);
  }

  return images;
}

// The content of a user message for the model: plain text, or text followed
// by the photos.
export function buildUserContent(
  text: string,
  images: readonly string[] | undefined,
): string | OAIContentPart[] {
  if (!images || images.length === 0) {
    return text;
  }

  return [
    { type: "text", text: text.trim() || DEFAULT_PHOTO_QUESTION },
    ...images.map(
      (url): OAIContentPart => ({ type: "image_url", image_url: { url } }),
    ),
  ];
}
