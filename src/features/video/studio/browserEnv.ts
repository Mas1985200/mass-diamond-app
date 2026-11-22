// src/features/video/studio/browserEnv.ts
// Joins the studio to the real browser: makes the canvas, the recorder, the
// animation frame and the clock that `makeFilm` needs, and says whether this
// browser can make films at all.
//
// The browser's globals are read from `scope` (the real window by default), so
// the joining is tested with a fake one and never touches the page at import.

import type { FilmEnv } from "./makeFilm.ts";
import { browserImageLoader } from "./loadImages.ts";
import { pickRecordingType, type RecorderLike, type StreamLike } from "./recorder.ts";
import type { CanvasLike } from "./renderFrame.ts";

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

export function createBrowserEnv(scope: BrowserScope = realScope()): FilmEnv {
  return {
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
      createRecorder(stream, options) {
        const Recorder = scope.MediaRecorder;
        if (!Recorder) throw new Error("no MediaRecorder");
        return new Recorder(stream as never, options);
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
