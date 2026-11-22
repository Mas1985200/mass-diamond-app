// src/features/video/studio/parallax.ts
// The "3D photo" effect: a flat photo with a depth map (near things bright, far
// things dark) is cut into layers by depth, and the camera moves so near layers
// shift more than far ones, as in real life. This file holds the numbers only:
// where the camera is, where each layer goes, and which pixels belong to which
// layer. The drawing and the depth model come in later files.
//
// Layers are cumulative: layer i holds every pixel at its depth or nearer, drawn
// from the farthest to the nearest. A layer that shifts never shows a hole, because
// the layer under it already holds the same pixels.

import type { StudioMotion } from "./types.ts";

// How far the nearest layer may shift, as a part of the frame size.
export const PARALLAX_STRENGTH = 0.04;
// Layers cut from a photo: more layers are smoother and slower to draw.
export const PARALLAX_LAYERS = 8;
// How far the camera comes closer in a zoom move.
export const PARALLAX_DOLLY = 0.2;
// The softness of a layer's edge, as a part of the depth range.
export const PARALLAX_FEATHER = 0.04;

export interface ParallaxCamera {
  // Sideways and up-down position, -1 to 1 (0 is the middle).
  readonly x: number;
  readonly y: number;
  // 0 (not closer) to PARALLAX_DOLLY (closest).
  readonly dolly: number;
}

// Where a layer is drawn: shifts as parts of the frame size, and the size.
export interface LayerPlacement {
  readonly dx: number;
  readonly dy: number;
  readonly scale: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function ease(p: number): number {
  const x = clamp(Number.isFinite(p) ? p : 0, 0, 1);
  return x * x * (3 - 2 * x);
}

// The camera at `progress` (0 to 1) of a scene for each kind of move. The camera
// goes the same way as the flat motion of motion.ts, so a film can mix both.
export function cameraAt(motion: StudioMotion, progress: number): ParallaxCamera {
  const p = ease(progress);
  switch (motion) {
    case "zoom-in":
      return { x: 0, y: 0, dolly: PARALLAX_DOLLY * p };
    case "zoom-out":
      return { x: 0, y: 0, dolly: PARALLAX_DOLLY * (1 - p) };
    case "pan-left":
      return { x: 1 - 2 * p, y: 0, dolly: 0 };
    case "pan-right":
      return { x: -1 + 2 * p, y: 0, dolly: 0 };
    case "pan-up":
      return { x: 0, y: 1 - 2 * p, dolly: 0 };
    case "pan-down":
      return { x: 0, y: -1 + 2 * p, dolly: 0 };
    default:
      return { x: 0, y: 0, dolly: 0 };
  }
}

// The depth of layer i (0 farthest ... count-1 nearest) for moving it: the middle
// of the band of depths it adds.
export function layerLevel(index: number, count: number): number {
  return clamp((index + 0.5) / Math.max(1, count), 0, 1);
}

// Every layer is drawn a little bigger than the frame, so that shifting it never
// shows its edge.
export function overscan(strength: number = PARALLAX_STRENGTH): number {
  return 1 + 2 * strength;
}

// Where to draw a layer of depth `level` (0 far, 1 near). Near layers shift
// against the camera more than far ones and grow faster when the camera comes
// closer; the middle depth stays still.
export function placeLayer(
  level: number,
  camera: ParallaxCamera,
  strength: number = PARALLAX_STRENGTH,
): LayerPlacement {
  const l = clamp(Number.isFinite(level) ? level : 0, 0, 1);
  const x = clamp(Number.isFinite(camera.x) ? camera.x : 0, -1, 1);
  const y = clamp(Number.isFinite(camera.y) ? camera.y : 0, -1, 1);
  const dolly = clamp(Number.isFinite(camera.dolly) ? camera.dolly : 0, 0, 1);
  const shift = (l - 0.5) * 2 * strength;
  return {
    dx: -x * shift,
    dy: -y * shift,
    scale: overscan(strength) * (1 + dolly * (0.35 + 0.65 * l)),
  };
}

// How much of layer `index` a pixel with this depth (0 to 255) belongs to, 0 to 255.
// The layer holds the pixels at its depth or nearer, with a soft edge.
export function layerAlpha(
  depth: number,
  index: number,
  count: number,
  feather: number = PARALLAX_FEATHER,
): number {
  const d = clamp(Number.isFinite(depth) ? depth : 0, 0, 255) / 255;
  const start = index / Math.max(1, count);
  // The farthest layer holds everything.
  if (index <= 0) return 255;
  if (feather <= 0) return d >= start ? 255 : 0;
  const t = clamp((d - (start - feather)) / (2 * feather), 0, 1);
  return Math.round(t * t * (3 - 2 * t) * 255);
}

// The mask of layer `index` for a whole depth map (one value 0 to 255 per pixel).
export function layerMask(
  depth: ArrayLike<number>,
  index: number,
  count: number,
  feather: number = PARALLAX_FEATHER,
): Uint8Array {
  const mask = new Uint8Array(depth.length);
  for (let i = 0; i < depth.length; i += 1) {
    mask[i] = layerAlpha(depth[i], index, count, feather);
  }
  return mask;
}

// The depth model may give any range (near is not always 255). This stretches a
// depth map so its darkest pixel is 0 and its brightest 255, which makes every
// layer hold something. A flat map (all the same) is returned as the middle.
export function normalizeDepth(depth: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(depth.length);
  if (depth.length === 0) return out;
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < depth.length; i += 1) {
    const v = depth[i];
    if (!Number.isFinite(v)) continue;
    if (v < low) low = v;
    if (v > high) high = v;
  }
  if (!(high > low)) {
    out.fill(128);
    return out;
  }
  const range = high - low;
  for (let i = 0; i < depth.length; i += 1) {
    const v = Number.isFinite(depth[i]) ? depth[i] : low;
    out[i] = Math.round(((v - low) / range) * 255);
  }
  return out;
}
