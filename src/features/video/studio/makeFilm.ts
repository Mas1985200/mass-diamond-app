// src/features/video/studio/makeFilm.ts
// Makes the film from a studio project, start to end: cleans the project, loads
// the pictures, then draws every frame and records it into one video file. This
// file only joins the studio's parts in the right order; the browser pieces (the
// canvas, the recorder, the clock, the picture loader) are handed in as `env`.
//
// A scene whose picture cannot be loaded stays black and is reported, so one bad
// picture never loses the whole film; a film with no picture at all is refused.

import { loadSceneImages, type ImageLoader } from "./loadImages.ts";
import { recordProject, type RecorderDeps, type RecordingSource } from "./recorder.ts";
import { renderFrame, type CanvasLike } from "./renderFrame.ts";
import { buildTimeline } from "./timeline.ts";
import { studioSize, type StudioSize } from "./types.ts";
import { parseStudioProject, type StudioWarning } from "./validate.ts";

export interface FilmEnv {
  // A canvas of this size: the part that is drawn on and the part that is recorded.
  readonly createCanvas: (size: StudioSize) => { canvas: RecordingSource; ctx: CanvasLike };
  readonly loader: ImageLoader;
  readonly recorder: Omit<RecorderDeps, "canvas">;
}

export type FilmStage = "loading" | "recording";

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
      // What had to be changed in the project before making it.
      readonly warnings: StudioWarning[];
    }
  | {
      readonly ok: false;
      readonly code: "invalid" | "no_images" | "cancelled" | "unsupported" | "failed";
    };

export async function makeFilm(
  input: unknown,
  env: FilmEnv,
  callbacks: FilmCallbacks = {},
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

  let target: { canvas: RecordingSource; ctx: CanvasLike };
  try {
    target = env.createCanvas(size);
  } catch {
    return { ok: false, code: "unsupported" };
  }

  const recorded = await recordProject(
    { ...env.recorder, canvas: target.canvas },
    {
      seconds: timeline.totalSeconds,
      size,
      quality: project.quality,
      drawAt: (time) => {
        renderFrame(target.ctx, size, timeline, loaded.images, time);
      },
      onProgress: (progress) => callbacks.onProgress?.("recording", progress),
      isCancelled: callbacks.isCancelled,
    },
  );
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
    warnings,
  };
}
