// src/features/video/studio/makeFilm.ts
// Makes the film from a studio project, start to end: cleans the project, loads
// the pictures, then draws every frame and records it into one video file. This
// file only joins the studio's parts in the right order; the browser pieces (the
// canvas, the recorder, the clock, the picture loader) are handed in as `env`.
//
// A scene whose picture cannot be loaded stays black and is reported, so one bad
// picture never loses the whole film; a film with no picture at all is refused.
//
// With "3D photos" on (and a browser that can do it), the depth of every picture is
// found first, then the layers of each scene are made a little at a time while the
// film is recorded (see parallaxCache.ts). A picture whose layers cannot be made is
// simply drawn flat, so the 3D effect never costs a film.

import { loadSceneImages, type ImageLoader } from "./loadImages.ts";
import { recordProject, type RecorderDeps, type RecordingSource } from "./recorder.ts";
import { estimateDepth, type DepthEngine, type DepthMap } from "./depthModel.ts";
import { createParallaxCache, type ParallaxCache } from "./parallaxCache.ts";
import {
  createParallaxBuilder,
  type ParallaxDeps,
  type PreparedParallax,
} from "./parallaxLayers.ts";
import { renderFrame, type CanvasLike, type ImageLike } from "./renderFrame.ts";
import { buildTimeline } from "./timeline.ts";
import { studioSize, type StudioSize } from "./types.ts";
import { parseStudioProject, type StudioWarning } from "./validate.ts";

// What the browser gives for the 3D photo.
export interface ParallaxEnv {
  // The depth model (null or missing: a simple guess of the depth is used).
  readonly depthEngine?: DepthEngine | null;
  // How to read a picture and make a layer picture for it, or null if it cannot.
  readonly layerDeps: (image: ImageLike, size: StudioSize) => ParallaxDeps<unknown> | null;
  // Called when the layers of a scene are let go (free their memory here).
  readonly release?: (prepared: PreparedParallax<unknown>) => void;
}

export interface FilmEnv {
  // A canvas of this size: the part that is drawn on and the part that is recorded.
  readonly createCanvas: (size: StudioSize) => { canvas: RecordingSource; ctx: CanvasLike };
  readonly loader: ImageLoader;
  readonly recorder: Omit<RecorderDeps, "canvas">;
  // Present when this browser can make 3D photos.
  readonly parallax?: ParallaxEnv;
}

export interface FilmOptions {
  // Make the photos 3D. Needs `env.parallax`; without it the photos stay flat.
  readonly threeD?: boolean;
}

// "off": flat photos. "model": 3D with the depth found by the model. "approximate":
// 3D, but the depth is a simple guess (the model could not be used).
export type ThreeDMode = "off" | "model" | "approximate";

export type FilmStage = "loading" | "depth" | "recording";

export interface FilmCallbacks {
  // `progress` is 0 to 1 inside the stage.
  readonly onProgress?: (stage: FilmStage, progress: number) => void;
  readonly isCancelled?: () => boolean;
}

export type FilmResult =
  | {
      readonly ok: true;
      readonly blob: Blob;
      readonly mimeType: string;
      readonly seconds: number;
      readonly size: StudioSize;
      // Scenes (by place) left black because their picture could not be loaded.
      readonly failedScenes: number[];
      readonly threeD: ThreeDMode;
      // What had to be changed in the project before making it.
      readonly warnings: StudioWarning[];
    }
  | {
      readonly ok: false;
      readonly code: "invalid" | "no_images" | "cancelled" | "unsupported" | "failed";
    };

// The depth of a guess does not need many pixels, so it is made small.
const GUESS_MAX_SIDE = 256;
const CANCEL_POLL_MS = 200;

function guessSize(image: ImageLike): { width: number; height: number } {
  const scale = Math.min(1, GUESS_MAX_SIDE / Math.max(image.width, image.height));
  return {
    width: Math.max(2, Math.round(image.width * scale)),
    height: Math.max(2, Math.round(image.height * scale)),
  };
}

type DepthOutcome =
  | { readonly cancelled: true }
  | { readonly cancelled: false; readonly depths: Map<number, DepthMap>; readonly approximate: boolean };

// The depth of every loaded picture, one after the other. Cancelling is noticed
// between pictures and also while the model works (it can take a while the first time).
async function findDepths(
  scenes: readonly { readonly imageUrl: string }[],
  images: ReadonlyMap<number, ImageLike>,
  engine: DepthEngine | null | undefined,
  callbacks: FilmCallbacks,
): Promise<DepthOutcome> {
  const depths = new Map<number, DepthMap>();
  let approximate = false;
  const indexes = Array.from(images.keys()).sort((a, b) => a - b);
  const controller = new AbortController();
  const timer = setInterval(() => {
    if (callbacks.isCancelled?.()) controller.abort();
  }, CANCEL_POLL_MS);
  try {
    let done = 0;
    for (const index of indexes) {
      if (callbacks.isCancelled?.()) return { cancelled: true };
      const image = images.get(index);
      if (image) {
        const result = await estimateDepth(scenes[index].imageUrl, guessSize(image), {
          engine,
          signal: controller.signal,
        });
        depths.set(index, result.depth);
        if (result.source === "fallback") approximate = true;
      }
      done += 1;
      callbacks.onProgress?.("depth", done / indexes.length);
    }
    return { cancelled: false, depths, approximate };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { cancelled: true };
    throw error;
  } finally {
    clearInterval(timer);
  }
}

export async function makeFilm(
  input: unknown,
  env: FilmEnv,
  callbacks: FilmCallbacks = {},
  options: FilmOptions = {},
): Promise<FilmResult> {
  const parsed = parseStudioProject(input);
  if (!parsed.ok) return { ok: false, code: "invalid" };
  const { project, warnings } = parsed;
  const timeline = buildTimeline(project);
  const size = studioSize(project.aspectRatio, project.quality);

  const loaded = await loadSceneImages(project.scenes, {
    loader: env.loader,
    isCancelled: callbacks.isCancelled,
    onProgress: (done, total) => callbacks.onProgress?.("loading", total > 0 ? done / total : 1),
  });
  if (loaded.cancelled) return { ok: false, code: "cancelled" };
  if (loaded.images.size === 0) return { ok: false, code: "no_images" };

  // 3D photos: the depth of every picture first, then layers made as the film goes.
  const parallaxEnv = options.threeD ? env.parallax : undefined;
  let cache: ParallaxCache<unknown> | null = null;
  let threeD: ThreeDMode = "off";
  if (parallaxEnv) {
    const found = await findDepths(project.scenes, loaded.images, parallaxEnv.depthEngine, callbacks);
    if (found.cancelled) return { ok: false, code: "cancelled" };
    threeD = found.approximate ? "approximate" : "model";
    cache = createParallaxCache<unknown>({
      timeline,
      makeBuilder: (index) => {
        const image = loaded.images.get(index);
        const depth = found.depths.get(index);
        if (!image || !depth) return null;
        const deps = parallaxEnv.layerDeps(image, size);
        return deps ? createParallaxBuilder(image, depth, size, deps) : null;
      },
      release: parallaxEnv.release,
    });
  }

  let target: { canvas: RecordingSource; ctx: CanvasLike };
  try {
    target = env.createCanvas(size);
  } catch {
    cache?.dispose();
    return { ok: false, code: "unsupported" };
  }

  // The first scenes are ready before the recording starts, so none is ever late.
  cache?.settle(0);

  let recorded: Awaited<ReturnType<typeof recordProject>>;
  try {
    recorded = await recordProject(
      { ...env.recorder, canvas: target.canvas },
      {
        seconds: timeline.totalSeconds,
        size,
        quality: project.quality,
        drawAt: (time) => {
          // One small step of layer work between frames, then the frame itself.
          cache?.tick(time);
          renderFrame(target.ctx, size, timeline, loaded.images, time, cache?.ready());
        },
        onProgress: (progress) => callbacks.onProgress?.("recording", progress),
        isCancelled: callbacks.isCancelled,
      },
    );
  } finally {
    cache?.dispose();
  }
  if (!recorded.ok) {
    return { ok: false, code: recorded.code === "invalid" ? "failed" : recorded.code };
  }
  return {
    ok: true,
    blob: recorded.blob,
    mimeType: recorded.mimeType,
    seconds: recorded.seconds,
    size,
    failedScenes: loaded.failed,
    threeD,
    warnings,
  };
}
