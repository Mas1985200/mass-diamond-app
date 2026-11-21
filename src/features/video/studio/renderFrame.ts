// src/features/video/studio/renderFrame.ts
// Draws one frame of the film on a canvas: a black background, then the pictures
// the timeline asks for (each with its camera part, transparency, shift and zoom)
// and the caption of each scene on top of its picture.
//
// It only needs the few canvas calls listed below (CanvasLike), so it is tested
// with a small fake and works the same on a screen canvas and an offscreen one.

import { sourceRect } from "./motion.ts";
import { layersAt, type Layer, type Timeline } from "./timeline.ts";

export interface ImageLike {
  readonly width: number;
  readonly height: number;
}

// The part of the canvas drawing interface this file uses.
export interface CanvasLike {
  globalAlpha: number;
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  direction: CanvasDirection;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
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
}

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

// How long a caption takes to appear and to disappear, in seconds.
export const CAPTION_FADE_SECONDS = 0.4;
const CAPTION_MAX_LINES = 4;
const CAPTION_WIDTH_SHARE = 0.86;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// Splits a text into lines that fit `maxWidth`, breaking between words. A single
// word longer than the line stays whole on its own line. Too many lines end with
// "…". Works for any language: words are split at spaces.
export function wrapCaption(
  text: string,
  maxWidth: number,
  measure: (line: string) => number,
  maxLines: number = CAPTION_MAX_LINES,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word;
    if (line && measure(attempt) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = attempt;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
  return kept;
}

// 0 to 1: the caption fades in at the start of its scene and out at the end.
function captionAlpha(layer: Layer, sceneSeconds: number): number {
  const elapsed = layer.sceneProgress * sceneSeconds;
  const remaining = sceneSeconds - elapsed;
  return clamp(Math.min(elapsed, remaining) / CAPTION_FADE_SECONDS, 0, 1);
}

function drawCaption(ctx: CanvasLike, size: FrameSize, text: string, alpha: number): void {
  if (alpha <= 0) return;
  const fontSize = Math.max(12, Math.round(Math.min(size.width, size.height) * 0.06));
  ctx.font = `600 ${fontSize}px system-ui, "Noto Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = "inherit";

  const lines = wrapCaption(text, size.width * CAPTION_WIDTH_SHARE, (l) => ctx.measureText(l).width);
  if (lines.length === 0) return;

  const lineHeight = fontSize * 1.35;
  const blockHeight = lineHeight * lines.length + fontSize * 0.8;
  const bottom = size.height - size.height * 0.06;
  const top = bottom - blockHeight;

  const base = ctx.globalAlpha;
  ctx.globalAlpha = base * alpha * 0.55;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, top, size.width, blockHeight);

  ctx.globalAlpha = base * alpha;
  ctx.fillStyle = "#ffffff";
  lines.forEach((line, i) => {
    ctx.fillText(line, size.width / 2, top + fontSize * 0.4 + lineHeight * (i + 0.5));
  });
  ctx.globalAlpha = base;
}

// Draws the frame at `time` seconds. `images` has the loaded picture of each
// scene by its index. Returns the indexes of the scenes that had to be drawn but
// have no picture yet (the caller may wait and draw again).
export function renderFrame(
  ctx: CanvasLike,
  size: FrameSize,
  timeline: Timeline,
  images: ReadonlyMap<number, ImageLike>,
  time: number,
): number[] {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size.width, size.height);

  const missing: number[] = [];
  for (const layer of layersAt(timeline, time)) {
    const planned = timeline.scenes[layer.index];
    const image = images.get(layer.index);
    if (!image) {
      missing.push(layer.index);
      continue;
    }
    const rect = sourceRect(
      planned.scene.motion,
      layer.sceneProgress,
      image.width,
      image.height,
      size.width,
      size.height,
    );
    if (!rect) {
      missing.push(layer.index);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = layer.alpha;
    ctx.translate(size.width / 2 + layer.offsetX * size.width, size.height / 2);
    ctx.scale(layer.scale, layer.scale);
    ctx.drawImage(
      image as never,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      -size.width / 2,
      -size.height / 2,
      size.width,
      size.height,
    );
    const caption = planned.scene.caption?.trim();
    if (caption) {
      // The caption is drawn in the same shifted and zoomed space as its picture.
      ctx.translate(-size.width / 2, -size.height / 2);
      drawCaption(ctx, size, caption, captionAlpha(layer, planned.seconds));
    }
    ctx.restore();
  }

  ctx.restore();
  return missing;
}
