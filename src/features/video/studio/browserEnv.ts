// src/features/video/studio/browserEnv.ts
// Joins the studio to the real browser: makes the canvas, the recorder, the
// animation frame and the clock that `makeFilm` needs, and says whether this
// browser can make films at all.
//
// The browser's globals are read from `scope` (the real window by default), so
// the joining is tested with a fake one and never touches the page at import.
//
// It also gives the 3D photo its browser side: a scratch canvas to read the pixels of a
// picture, a canvas for each layer (freed when the layer is let go), and the depth
// model, which is only downloaded the first time a 3D film needs it.

import { DEPTH_TIMEOUT_MS, createTransformersEngine, type DepthEngine } from "./depthModel.ts";
import type { FilmEnv, ParallaxEnv } from "./makeFilm.ts";
import { browserImageLoader } from "./loadImages.ts";
import { coverRect, type PixelBuffer } from "./parallaxLayers.ts";
import { pickRecordingType, type RecorderLike, type StreamLike } from "./recorder.ts";
import type { CanvasLike, ImageLike } from "./renderFrame.ts";

// The part of the browser this file uses.
export interface BrowserScope {
  readonly document?: {
    createElement(tag: "canvas"): {
      width: number;
      height: number;
      getContext(kind: "2d", options?: { alpha?: boolean }): unknown;
      captureStream?: (fps?: number) => unknown;
    };
  };
  readonly MediaRecorder?: {
    new (stream: never, options: { mimeType: string; videoBitsPerSecond: number }): RecorderLike;
    isTypeSupported(mimeType: string): boolean;
  };
  readonly requestAnimationFrame?: (callback: () => void) => number;
  readonly cancelAnimationFrame?: (handle: number) => void;
  readonly performance?: { now(): number };
}

// The part of a 2D canvas the 3D photo uses.
interface PixelContext {
  drawImage(
    image: never,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  getImageData(x: number, y: number, width: number, height: number): PixelBuffer;
  createImageData(width: number, height: number): { readonly data: Uint8ClampedArray };
  putImageData(data: never, x: number, y: number): void;
}

interface ScratchCanvas {
  width: number;
  height: number;
}

function realScope(): BrowserScope {
  return globalThis as unknown as BrowserScope;
}

function isTypeSupported(scope: BrowserScope, mimeType: string): boolean {
  try {
    return !!scope.MediaRecorder && scope.MediaRecorder.isTypeSupported(mimeType);
  } catch {
    return false;
  }
}

// True when this browser has everything a film needs.
export function canMakeFilm(scope: BrowserScope = realScope()): boolean {
  if (!scope.document || !scope.MediaRecorder) return false;
  if (typeof scope.requestAnimationFrame !== "function") return false;
  if (typeof scope.performance?.now !== "function") return false;
  return pickRecordingType((type) => isTypeSupported(scope, type)) !== null;
}

// A canvas of this size with its pixel context, or null when the browser refuses.
function makeScratch(
  scope: BrowserScope,
  width: number,
  height: number,
): { canvas: ScratchCanvas; ctx: PixelContext } | null {
  const document = scope.document;
  if (!document) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true }) as PixelContext | null;
  return ctx ? { canvas, ctx } : null;
}

// The depth model is slow to start and may be blocked (no internet, a filtered site).
// After one failure or one wait that is too long, it answers "no" at once for the
// rest of the film, so a blocked model costs one wait and not one wait per photo.
export function rememberFailure(engine: DepthEngine, timeoutMs: number = DEPTH_TIMEOUT_MS - 10_000): DepthEngine {
  let failed = false;
  return {
    async estimate(url) {
      if (failed) throw new Error("depth model unavailable");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          engine.estimate(url),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("depth model too slow")), timeoutMs);
          }),
        ]);
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}

// One model for the page: it is made once and reused by every film.
let sharedEngine: DepthEngine | null = null;
function getSharedEngine(): DepthEngine {
  if (!sharedEngine) sharedEngine = createTransformersEngine();
  return sharedEngine;
}

export interface BrowserEnvOptions {
  // The depth model. Missing: the real one (downloaded when first needed). null: none,
  // the depth is a simple guess.
  readonly depthEngine?: DepthEngine | null;
}

function createParallaxEnv(scope: BrowserScope, options: BrowserEnvOptions): ParallaxEnv | undefined {
  if (!scope.document) return undefined;
  const engine = options.depthEngine === undefined ? getSharedEngine() : options.depthEngine;
  return {
    depthEngine: engine ? rememberFailure(engine) : null,
    layerDeps(image: ImageLike, size) {
      return {
        // The photo fitted to the frame: its middle part, scaled to the frame.
        readPixels() {
          const rect = coverRect(image.width, image.height, size.width, size.height);
          const scratch = makeScratch(scope, size.width, size.height);
          if (!rect || !scratch) return null;
          try {
            scratch.ctx.drawImage(
              image as never,
              rect.x,
              rect.y,
              rect.width,
              rect.height,
              0,
              0,
              size.width,
              size.height,
            );
            return scratch.ctx.getImageData(0, 0, size.width, size.height);
          } finally {
            // The scratch canvas is not needed again: let its memory go at once.
            scratch.canvas.width = 0;
            scratch.canvas.height = 0;
          }
        },
        // One layer as a canvas that can be drawn like a picture.
        makeLayer(pixels) {
          const layer = makeScratch(scope, pixels.width, pixels.height);
          if (!layer) throw new Error("no canvas for a layer");
          const data = layer.ctx.createImageData(pixels.width, pixels.height);
          data.data.set(pixels.data);
          layer.ctx.putImageData(data as never, 0, 0);
          return layer.canvas;
        },
      };
    },
    release(prepared) {
      for (const layer of prepared.layers) {
        const canvas = layer as Partial<ScratchCanvas> | null;
        if (canvas && typeof canvas === "object" && "width" in canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    },
  };
}

export function createBrowserEnv(
  scope: BrowserScope = realScope(),
  options: BrowserEnvOptions = {},
): FilmEnv {
  return {
    parallax: createParallaxEnv(scope, options),
    createCanvas(size) {
      const document = scope.document;
      if (!document) throw new Error("no document");
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("no 2d canvas");
      if (typeof canvas.captureStream !== "function") throw new Error("no captureStream");
      return {
        canvas: canvas as unknown as { captureStream(fps: number): StreamLike },
        ctx: ctx as CanvasLike,
      };
    },
    loader: browserImageLoader,
    recorder: {
      createRecorder(stream, recorderOptions) {
        const Recorder = scope.MediaRecorder;
        if (!Recorder) throw new Error("no MediaRecorder");
        return new Recorder(stream as never, recorderOptions);
      },
      isTypeSupported: (mimeType) => isTypeSupported(scope, mimeType),
      nextFrame(callback) {
        const request = scope.requestAnimationFrame;
        if (typeof request !== "function") throw new Error("no animation frame");
        const handle = request.call(scope, () => callback());
        return () => scope.cancelAnimationFrame?.call(scope, handle);
      },
      now: () => (scope.performance ? scope.performance.now() : Date.now()),
    },
  };
}
