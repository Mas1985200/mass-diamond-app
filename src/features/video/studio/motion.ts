// src/features/video/studio/motion.ts
// The camera over a still picture: for a moment of a scene, which part of the
// picture is shown. The picture always fills the whole frame (nothing empty at
// the edges, nothing stretched): the shown part has the shape of the frame and
// stays inside the picture.
//
// Pure numbers: no canvas, no browser, so every rule here is tested.

import type { StudioMotion } from "./types.ts";

// The part of the picture to show, in the pixels of the picture.
export interface SourceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// How much closer the camera gets in a zoom, and how close it stays while
// panning (1.2: the shown part is a fifth smaller than the whole fitted picture).
export const MOTION_ZOOM = 1.2;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// Slow start and slow end, so the camera does not jerk.
function ease(p: number): number {
  const x = clamp(p, 0, 1);
  return x * x * (3 - 2 * x);
}

// The biggest part of the picture with the shape of the frame.
function fitted(imageW: number, imageH: number, frameW: number, frameH: number) {
  const frameRatio = frameW / frameH;
  return imageW / imageH > frameRatio
    ? { width: imageH * frameRatio, height: imageH }
    : { width: imageW, height: imageW / frameRatio };
}

// Which part of the picture to show at `progress` (0 to 1) of the scene. Sizes
// that cannot be used (zero, negative, not a number) give null: there is nothing
// to draw.
export function sourceRect(
  motion: StudioMotion,
  progress: number,
  imageW: number,
  imageH: number,
  frameW: number,
  frameH: number,
): SourceRect | null {
  for (const n of [imageW, imageH, frameW, frameH]) {
    if (!Number.isFinite(n) || n <= 0) return null;
  }
  const p = ease(Number.isFinite(progress) ? progress : 0);
  const base = fitted(imageW, imageH, frameW, frameH);

  let zoom = 1;
  // Where the shown part sits inside the free space: 0 is the left or top edge,
  // 1 the right or bottom edge, 0.5 the centre.
  let anchorX = 0.5;
  let anchorY = 0.5;

  switch (motion) {
    case "zoom-in":
      zoom = 1 + (MOTION_ZOOM - 1) * p;
      break;
    case "zoom-out":
      zoom = MOTION_ZOOM - (MOTION_ZOOM - 1) * p;
      break;
    case "pan-left": // the camera goes left: the picture seems to move right
      zoom = MOTION_ZOOM;
      anchorX = 1 - p;
      break;
    case "pan-right":
      zoom = MOTION_ZOOM;
      anchorX = p;
      break;
    case "pan-up":
      zoom = MOTION_ZOOM;
      anchorY = 1 - p;
      break;
    case "pan-down":
      zoom = MOTION_ZOOM;
      anchorY = p;
      break;
    default: // "still"
      break;
  }

  const width = base.width / zoom;
  const height = base.height / zoom;
  return {
    x: (imageW - width) * anchorX,
    y: (imageH - height) * anchorY,
    width,
    height,
  };
}
