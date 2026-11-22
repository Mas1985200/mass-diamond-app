// src/features/video/studio/depthModel.ts
// How far away is every part of a photo? The phone works it out itself with a small
// depth model (downloaded once, then kept by the browser, no server, no cost). If the
// model cannot be loaded (no internet, blocked, an old phone) or gives nonsense, a
// simple guess is used instead (the bottom of a photo is usually nearer than the top,
// and the middle nearer than the sides), so a photo always gets a 3D effect.
//
// The model itself is injected (DepthEngine), so every rule here is tested without
// downloading anything. Depth values follow parallax.ts: 255 is near, 0 is far.

import { normalizeDepth } from "./parallax.ts";

export interface DepthMap {
  readonly width: number;
  readonly height: number;
  // One value per pixel, row by row, 0 (far) to 255 (near).
  readonly data: Uint8Array;
}

// What a model gives back: a number per pixel, larger = nearer, any range.
export interface RawDepth {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

export interface DepthEngine {
  // `url` is a picture the browser can open (blob: or https:).
  estimate(url: string): Promise<RawDepth>;
}

export type DepthSource = "model" | "fallback";

export interface DepthResult {
  readonly depth: DepthMap;
  readonly source: DepthSource;
}

export interface DepthDeps {
  // No engine: the guess is used.
  readonly engine?: DepthEngine | null;
  // First use downloads the model, so this is generous.
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export const DEPTH_TIMEOUT_MS = 120_000;
export const DEPTH_MAX_SIDE = 1024;
export const DEPTH_MODEL_ID = "onnx-community/depth-anything-v2-small";
export const TRANSFORMERS_URL =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";

// A guess from the shape of the picture alone. Never fails.
export function fallbackDepth(width: number, height: number): DepthMap {
  const w = Math.max(2, Math.min(DEPTH_MAX_SIDE, Math.floor(Number.isFinite(width) ? width : 2)));
  const h = Math.max(2, Math.min(DEPTH_MAX_SIDE, Math.floor(Number.isFinite(height) ? height : 2)));
  const raw = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const ground = y / (h - 1); // the bottom is nearer
    for (let x = 0; x < w; x += 1) {
      const dx = (x / (w - 1)) * 2 - 1;
      const dy = (y / (h - 1)) * 2 - 1;
      const middle = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) / 1.4143); // the middle is nearer
      raw[y * w + x] = 0.65 * ground + 0.35 * middle;
    }
  }
  return { width: w, height: h, data: normalizeDepth(raw) };
}

function isUsable(raw: RawDepth | null | undefined): raw is RawDepth {
  if (!raw) return false;
  const { width, height, data } = raw;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (width < 2 || height < 2) return false;
  if (width > 8192 || height > 8192) return false;
  if (!data || data.length !== width * height) return false;
  // A map that is mostly not-a-number is useless; a few bad numbers are repaired.
  let bad = 0;
  for (let i = 0; i < data.length; i += 1) {
    if (!Number.isFinite(data[i])) bad += 1;
  }
  return bad * 20 <= data.length;
}

function abortError(): Error {
  const error = new Error("cancelled");
  error.name = "AbortError";
  return error;
}

function raceWith<T>(
  work: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const timer = setTimeout(
      () => finish(() => reject(new Error("timeout"))),
      timeoutMs,
    );
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort);
    }
    work.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

// The depth of one photo. Cancelling throws an AbortError; every other problem
// quietly gives the guess (source "fallback"), because a 3D photo from a guess is
// better than no film.
export async function estimateDepth(
  url: string,
  size: { readonly width: number; readonly height: number },
  deps: DepthDeps = {},
): Promise<DepthResult> {
  const { signal } = deps;
  if (signal?.aborted) throw abortError();
  const guess = (): DepthResult => ({
    depth: fallbackDepth(size.width, size.height),
    source: "fallback",
  });
  const engine = deps.engine;
  if (!engine) return guess();

  const timeoutMs =
    deps.timeoutMs !== undefined && deps.timeoutMs > 0 ? deps.timeoutMs : DEPTH_TIMEOUT_MS;
  try {
    const raw = await raceWith(
      Promise.resolve().then(() => engine.estimate(url)),
      timeoutMs,
      signal,
    );
    if (!isUsable(raw)) return guess();
    return {
      depth: { width: raw.width, height: raw.height, data: normalizeDepth(raw.data) },
      source: "model",
    };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw abortError();
    }
    return guess();
  }
}

// ---- The real model (browser only, loaded the first time it is needed) ----

interface TensorLike {
  readonly data: ArrayLike<number>;
  readonly dims: readonly number[];
}

type DepthPipeline = (url: string) => Promise<{ predicted_depth?: TensorLike }>;

interface TransformersModule {
  pipeline(task: string, model: string, options?: Record<string, unknown>): Promise<DepthPipeline>;
}

export type TransformersLoader = () => Promise<TransformersModule>;

const browserLoader: TransformersLoader = async () =>
  (await import(/* @vite-ignore */ TRANSFORMERS_URL)) as TransformersModule;

// One engine for the whole session: the model is made once and reused.
export function createTransformersEngine(
  load: TransformersLoader = browserLoader,
  modelId: string = DEPTH_MODEL_ID,
): DepthEngine {
  let pending: Promise<DepthPipeline> | null = null;
  const getPipeline = (): Promise<DepthPipeline> => {
    if (!pending) {
      pending = load()
        .then((lib) => lib.pipeline("depth-estimation", modelId))
        .catch((error) => {
          pending = null; // try again next time (the network may come back)
          throw error;
        });
    }
    return pending;
  };
  return {
    async estimate(url: string): Promise<RawDepth> {
      const run = await getPipeline();
      const out = await run(url);
      const tensor = out.predicted_depth;
      if (!tensor || tensor.dims.length < 2) throw new Error("no depth");
      const height = tensor.dims[tensor.dims.length - 2];
      const width = tensor.dims[tensor.dims.length - 1];
      return { width, height, data: tensor.data };
    },
  };
}
