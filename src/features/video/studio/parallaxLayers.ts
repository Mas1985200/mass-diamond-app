// src/features/video/studio/parallaxLayers.ts
// Cuts one photo into the layers of the "3D photo" effect. The photo is first fitted
// to the frame (the middle part, no black bars), the depth map is laid over it the
// same way, and every layer gets the pixels that belong to it (see parallax.ts).
//
// Pixels in, pixels out: reading the photo and making a picture from a layer are
// given by the caller (a canvas in the browser), so everything here is tested
// without a browser.

import {
  PARALLAX_FEATHER,
  PARALLAX_LAYERS,
  layerAlpha,
} from "./parallax.ts";
import type { DepthMap } from "./depthModel.ts";

export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  // RGBA, 4 numbers per pixel, row by row.
  readonly data: Uint8ClampedArray;
}

// The part of a photo that fills a frame (the middle, cropped to the frame's shape).
export interface CoverRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ParallaxDeps<T> {
  // The photo fitted to the frame (see coverRect), frame-sized. null: cannot read.
  readonly readPixels: () => PixelBuffer | null;
  // A picture from the pixels of one layer.
  readonly makeLayer: (pixels: PixelBuffer) => T;
}

export interface ParallaxOptions {
  readonly layers?: number;
  readonly feather?: number;
}

export interface PreparedParallax<T> {
  readonly width: number;
  readonly height: number;
  // From the farthest (index 0, holds everything) to the nearest.
  readonly layers: readonly T[];
}

export const MIN_LAYERS = 2;
export const MAX_LAYERS = 16;

// The middle part of a picture that fills a frame, or null for silly sizes.
export function coverRect(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): CoverRect | null {
  const ok = (n: number) => Number.isFinite(n) && n > 0;
  if (!ok(imageWidth) || !ok(imageHeight) || !ok(frameWidth) || !ok(frameHeight)) return null;
  const scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
  const width = frameWidth / scale;
  const height = frameHeight / scale;
  return {
    x: (imageWidth - width) / 2,
    y: (imageHeight - height) / 2,
    width,
    height,
  };
}

// The depth of every pixel of a frame, laid over the same part of the photo that
// the frame shows (bilinear, so it is smooth). One value 0..255 per frame pixel.
export function depthForFrame(
  depth: DepthMap,
  rect: CoverRect,
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): Uint8Array {
  const out = new Uint8Array(frameWidth * frameHeight);
  const dw = depth.width;
  const dh = depth.height;
  const maxX = dw - 1;
  const maxY = dh - 1;
  for (let y = 0; y < frameHeight; y += 1) {
    const v = (rect.y + ((y + 0.5) / frameHeight) * rect.height) / imageHeight;
    const fy = Math.min(maxY, Math.max(0, v * dh - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(maxY, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < frameWidth; x += 1) {
      const u = (rect.x + ((x + 0.5) / frameWidth) * rect.width) / imageWidth;
      const fx = Math.min(maxX, Math.max(0, u * dw - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(maxX, x0 + 1);
      const tx = fx - x0;
      const top = depth.data[y0 * dw + x0] * (1 - tx) + depth.data[y0 * dw + x1] * tx;
      const bottom = depth.data[y1 * dw + x0] * (1 - tx) + depth.data[y1 * dw + x1] * tx;
      out[y * frameWidth + x] = Math.round(top * (1 - ty) + bottom * ty);
    }
  }
  return out;
}

function validDepth(depth: DepthMap): boolean {
  return (
    Number.isInteger(depth.width) &&
    Number.isInteger(depth.height) &&
    depth.width >= 2 &&
    depth.height >= 2 &&
    depth.data.length === depth.width * depth.height
  );
}

// The layers of one photo, or null when it cannot be done (bad sizes, no pixels,
// a depth map that does not fit); the caller then draws the flat photo instead.
export function prepareParallax<T>(
  image: { readonly width: number; readonly height: number },
  depth: DepthMap,
  frame: { readonly width: number; readonly height: number },
  deps: ParallaxDeps<T>,
  options: ParallaxOptions = {},
): PreparedParallax<T> | null {
  const frameWidth = Math.round(frame.width);
  const frameHeight = Math.round(frame.height);
  const rect = coverRect(image.width, image.height, frameWidth, frameHeight);
  if (!rect || !validDepth(depth)) return null;

  const pixels = deps.readPixels();
  if (
    !pixels ||
    pixels.width !== frameWidth ||
    pixels.height !== frameHeight ||
    pixels.data.length !== frameWidth * frameHeight * 4
  ) {
    return null;
  }

  const requested = options.layers ?? PARALLAX_LAYERS;
  const count = Math.min(
    MAX_LAYERS,
    Math.max(MIN_LAYERS, Number.isFinite(requested) ? Math.round(requested) : PARALLAX_LAYERS),
  );
  const feather = options.feather ?? PARALLAX_FEATHER;

  const frameDepth = depthForFrame(depth, rect, image.width, image.height, frameWidth, frameHeight);
  const total = frameWidth * frameHeight;
  const layers: T[] = [];
  for (let index = 0; index < count; index += 1) {
    const data = new Uint8ClampedArray(pixels.data);
    if (index > 0) {
      // One table per layer: the mask value for each of the 256 depths.
      const table = new Uint8Array(256);
      for (let d = 0; d < 256; d += 1) table[d] = layerAlpha(d, index, count, feather);
      for (let i = 0; i < total; i += 1) {
        const alpha = 4 * i + 3;
        data[alpha] = Math.round((data[alpha] * table[frameDepth[i]]) / 255);
      }
    }
    layers.push(deps.makeLayer({ width: frameWidth, height: frameHeight, data }));
  }
  return { width: frameWidth, height: frameHeight, layers };
}
