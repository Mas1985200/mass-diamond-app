// src/features/video/studio/photoIntake.ts
// Takes a photo the person made with the phone camera (or chose from the gallery)
// and makes it ready for the film: checks that it is a picture, turns it upright,
// shrinks it so even a weak phone can draw it smoothly, and gives it back as an
// address on the phone (blob:) that never leaves the device.
//
// The browser parts (decoding, drawing, making the address) are handed in as
// `PhotoDeps`, so the rules are tested without a browser.

export interface PhotoFile {
  readonly type: string;
  readonly size: number;
  readonly name?: string;
}

// A decoded picture, with the browser's own handle to draw it from.
export interface DecodedPhoto {
  readonly width: number;
  readonly height: number;
  readonly source: unknown;
  readonly close?: () => void;
}

export interface PhotoDeps {
  // Reads the file into a picture turned the way the person saw it. Throws when
  // the file cannot be read as a picture.
  readonly decode: (file: PhotoFile) => Promise<DecodedPhoto>;
  // Draws the picture at this size and gives it as a JPEG file (null: failed).
  readonly render: (photo: DecodedPhoto, width: number, height: number) => Promise<Blob | null>;
  readonly createUrl: (blob: Blob) => string;
  readonly revokeUrl?: (url: string) => void;
}

export type PhotoResult =
  | {
      readonly ok: true;
      // An address on this phone (blob:) for the studio's `imageUrl`.
      readonly url: string;
      readonly width: number;
      readonly height: number;
      readonly bytes: number;
    }
  | {
      readonly ok: false;
      readonly code: "not_image" | "too_large" | "too_small" | "unreadable" | "failed";
    };

// A phone photo is a few megabytes; this leaves room for the biggest cameras.
export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;
// The longest side after shrinking: enough for a full-HD film with some room to zoom.
export const MAX_PHOTO_SIDE = 1920;
export const MIN_PHOTO_SIDE = 64;

const IMAGE_NAME = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i;

// Some phones send a photo with no type; then the name decides. SVG is refused:
// it can carry scripts and is not a photo.
export function isPhotoFile(file: PhotoFile): boolean {
  const type = (file.type ?? "").toLowerCase();
  if (type === "image/svg+xml") return false;
  if (type.startsWith("image/")) return true;
  return type === "" && typeof file.name === "string" && IMAGE_NAME.test(file.name);
}

// The size after shrinking so the longest side is at most `max` (never bigger
// than the original), with whole pixels.
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_PHOTO_SIDE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > max ? max / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function importPhoto(file: PhotoFile, deps: PhotoDeps): Promise<PhotoResult> {
  if (!isPhotoFile(file)) return { ok: false, code: "not_image" };
  if (!(file.size > 0)) return { ok: false, code: "unreadable" };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, code: "too_large" };

  let photo: DecodedPhoto;
  try {
    photo = await deps.decode(file);
  } catch {
    return { ok: false, code: "unreadable" };
  }

  try {
    if (!(photo.width > 0) || !(photo.height > 0)) return { ok: false, code: "unreadable" };
    if (Math.max(photo.width, photo.height) < MIN_PHOTO_SIDE) return { ok: false, code: "too_small" };

    const size = fitWithin(photo.width, photo.height);
    const blob = await deps.render(photo, size.width, size.height);
    if (!blob || blob.size === 0) return { ok: false, code: "failed" };
    return {
      ok: true,
      url: deps.createUrl(blob),
      width: size.width,
      height: size.height,
      bytes: blob.size,
    };
  } catch {
    return { ok: false, code: "failed" };
  } finally {
    try {
      photo.close?.();
    } catch {
      // already released
    }
  }
}

// Gives the phone's memory back when the picture is no longer used.
export function releasePhoto(url: string, deps: Pick<PhotoDeps, "revokeUrl">): void {
  if (!url.startsWith("blob:")) return;
  try {
    deps.revokeUrl?.(url);
  } catch {
    // nothing to release
  }
}

// The part of the browser the real dependencies use.
export interface PhotoScope {
  readonly createImageBitmap?: (
    file: unknown,
    options?: { imageOrientation?: string },
  ) => Promise<{ width: number; height: number; close?: () => void }>;
  readonly document?: {
    createElement(tag: "canvas"): {
      width: number;
      height: number;
      getContext(kind: "2d"): {
        drawImage(source: never, x: number, y: number, width: number, height: number): void;
      } | null;
      toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
    };
  };
  readonly URL?: { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void };
}

export const PHOTO_JPEG_QUALITY = 0.9;

export function createBrowserPhotoDeps(scope: PhotoScope = globalThis as unknown as PhotoScope): PhotoDeps {
  return {
    async decode(file) {
      const create = scope.createImageBitmap;
      if (typeof create !== "function") throw new Error("no createImageBitmap");
      let bitmap;
      try {
        // Turned upright the way the person held the phone.
        bitmap = await create(file, { imageOrientation: "from-image" });
      } catch {
        bitmap = await create(file);
      }
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => bitmap.close?.(),
      };
    },
    render(photo, width, height) {
      const canvas = scope.document?.createElement("canvas");
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return Promise.resolve(null);
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(photo.source as never, 0, 0, width, height);
      return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", PHOTO_JPEG_QUALITY);
      });
    },
    createUrl(blob) {
      if (!scope.URL) throw new Error("no URL");
      return scope.URL.createObjectURL(blob);
    },
    revokeUrl(url) {
      scope.URL?.revokeObjectURL(url);
    },
  };
}
