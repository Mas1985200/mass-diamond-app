// src/lib/imageAttach.ts
// Photos the user attaches to a chat message. Every photo is shrunk on the
// phone before it is sent (long side at most 1280 px, JPEG), so uploads stay
// small and fast and the free AI quota is not wasted on huge files.

export const MAX_PHOTOS = 3;

const MAX_SIDE = 1280;
const THUMB_SIDE = 160;
const START_QUALITY = 0.8;
const MIN_QUALITY = 0.5;
const QUALITY_STEP = 0.15;
const SHRINK_FACTOR = 0.75;
const MIN_SIDE = 320;
// The server accepts up to 1 500 000 characters per photo; stay well below.
const MAX_DATA_URL_CHARS = 900_000;
const MAX_FILE_BYTES = 30 * 1024 * 1024;

export interface AttachedPhoto {
  readonly id: string;
  // The shrunk photo that is sent to the assistant (JPEG data URL).
  readonly dataUrl: string;
  // A tiny preview for the screen and the saved conversation.
  readonly thumb: string;
}

export type AttachErrorCode = "unsupported" | "unreadable" | "limit";

export class AttachError extends Error {
  readonly code: AttachErrorCode;

  constructor(code: AttachErrorCode) {
    super(code);
    this.name = "AttachError";
    this.code = code;
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AttachError("unreadable"));
    };

    image.src = url;
  });
}

function draw(
  image: HTMLImageElement,
  longSide: number,
): HTMLCanvasElement {
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  if (width <= 0 || height <= 0) {
    throw new AttachError("unreadable");
  }

  const scale = Math.min(1, longSide / Math.max(width, height));
  const canvas = document.createElement("canvas");

  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext("2d");

  if (!context) {
    throw new AttachError("unreadable");
  }

  // Transparent pictures (png, webp) become white instead of black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas;
}

function encode(canvas: HTMLCanvasElement, quality: number): string {
  const url = canvas.toDataURL("image/jpeg", quality);

  if (!url.startsWith("data:image/jpeg;base64,")) {
    throw new AttachError("unreadable");
  }

  return url;
}

// Makes one photo ready: decoded, turned upright, shrunk and encoded.
export async function prepareImage(file: File): Promise<AttachedPhoto> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new AttachError("unsupported");
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new AttachError("unreadable");
  }

  const image = await loadImage(file);

  let side = MAX_SIDE;
  let quality = START_QUALITY;
  let dataUrl = encode(draw(image, side), quality);

  // Still too big (a very detailed photo): lower the quality, then the size.
  while (dataUrl.length > MAX_DATA_URL_CHARS) {
    if (quality - QUALITY_STEP >= MIN_QUALITY) {
      quality -= QUALITY_STEP;
    } else if (side * SHRINK_FACTOR >= MIN_SIDE) {
      side = Math.round(side * SHRINK_FACTOR);
    } else {
      throw new AttachError("unreadable");
    }

    dataUrl = encode(draw(image, side), quality);
  }

  return {
    id: crypto.randomUUID(),
    dataUrl,
    thumb: encode(draw(image, THUMB_SIDE), 0.7),
  };
}

export interface AddResult {
  readonly photos: readonly AttachedPhoto[];
  // The first problem met, or null when every file was added.
  readonly error: AttachErrorCode | null;
}

// Adds the chosen files to the photos already attached, never going over the
// limit. A file that cannot be read is skipped; the others are still added.
export async function addImages(
  current: readonly AttachedPhoto[],
  files: readonly File[],
): Promise<AddResult> {
  const room = Math.max(0, MAX_PHOTOS - current.length);
  const photos: AttachedPhoto[] = [...current];
  let error: AttachErrorCode | null = files.length > room ? "limit" : null;

  for (const file of files.slice(0, room)) {
    try {
      photos.push(await prepareImage(file));
    } catch (caught) {
      error ??= caught instanceof AttachError ? caught.code : "unreadable";
    }
  }

  return { photos, error };
}
