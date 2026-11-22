// src/features/video/studio/loadImages.ts
// Gets the picture of every scene ready before the film is drawn. Only safe kinds
// of address are loaded (https, pictures made on the phone, and small inline
// pictures); a picture used by several scenes is loaded once; a few load at the
// same time; a slow or broken picture fails alone and never stops the others.
//
// The real loading is handed in as a function, so the rules are tested without a
// browser. `browserImageLoader` is that function for the browser.

import type { ImageLike } from "./renderFrame.ts";
import type { StudioScene } from "./types.ts";

export type ImageLoader = (url: string) => Promise<ImageLike>;

export interface LoadImagesOptions {
  readonly loader: ImageLoader;
  // How many pictures load at the same time.
  readonly concurrency?: number;
  // How long one picture may take, in milliseconds.
  readonly timeoutMs?: number;
  // How many pictures are done, and how many there are.
  readonly onProgress?: (done: number, total: number) => void;
  readonly isCancelled?: () => boolean;
}

export interface LoadedImages {
  // The picture of each scene by the scene's index.
  readonly images: Map<number, ImageLike>;
  // The scenes whose picture could not be loaded.
  readonly failed: number[];
  readonly cancelled: boolean;
}

export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_TIMEOUT_MS = 20_000;

// Only these addresses may be loaded into the film.
export function isLoadableImageUrl(url: string): boolean {
  if (typeof url !== "string") return false;
  const text = url.trim();
  if (/^https:\/\/[^\s/]+/i.test(text)) return true;
  if (/^blob:/i.test(text)) return text.length > "blob:".length;
  return /^data:image\/(png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(text);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function usable(image: ImageLike | null | undefined): image is ImageLike {
  return !!image && image.width > 0 && image.height > 0;
}

export async function loadSceneImages(
  scenes: readonly StudioScene[],
  options: LoadImagesOptions,
): Promise<LoadedImages> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Each different address once.
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const scene of scenes) {
    const url = typeof scene.imageUrl === "string" ? scene.imageUrl.trim() : "";
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }

  const byUrl = new Map<string, ImageLike>();
  let done = 0;
  let cancelled = false;
  let next = 0;

  const worker = async () => {
    while (next < urls.length) {
      if (options.isCancelled?.()) {
        cancelled = true;
        return;
      }
      const url = urls[next];
      next += 1;
      if (isLoadableImageUrl(url)) {
        try {
          const image = await withTimeout(options.loader(url), timeoutMs);
          if (usable(image)) byUrl.set(url, image);
        } catch {
          // this picture fails alone
        }
      }
      done += 1;
      options.onProgress?.(done, urls.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  if (options.isCancelled?.()) cancelled = true;

  const images = new Map<number, ImageLike>();
  const failed: number[] = [];
  scenes.forEach((scene, index) => {
    const image = byUrl.get(typeof scene.imageUrl === "string" ? scene.imageUrl.trim() : "");
    if (image) images.set(index, image);
    else failed.push(index);
  });
  return { images, failed, cancelled };
}

// The loader for the browser. The picture is asked for with CORS so that the
// canvas stays clean and can be recorded.
export function browserImageLoader(url: string): Promise<ImageLike> {
  return new Promise<ImageLike>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image failed"));
    image.src = url;
  });
}
