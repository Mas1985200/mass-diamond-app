// src/features/video/studio/parallaxDraw.ts
// Draws a 3D photo: its layers from the farthest to the nearest, each one shifted and
// sized by the camera (near layers move more than far ones). It draws into the
// middle of the current canvas space, so the same zoom or slide of a scene change
// (timeline.ts) still works around it.

import type { CanvasLike, FrameSize } from "./renderFrame.ts";
import {
  PARALLAX_STRENGTH,
  cameraAt,
  layerLevel,
  placeLayer,
  type LayerPlacement,
} from "./parallax.ts";
import type { StudioMotion } from "./types.ts";

// The layers of one photo (see parallaxLayers.ts), whatever the picture type is.
export interface DrawableParallax {
  readonly width: number;
  readonly height: number;
  readonly layers: readonly unknown[];
}

// Where every layer goes at `progress` (0 to 1) of a scene, farthest first.
export function parallaxPlacements(
  motion: StudioMotion,
  progress: number,
  count: number,
  strength: number = PARALLAX_STRENGTH,
): LayerPlacement[] {
  const camera = cameraAt(motion, progress);
  const placements: LayerPlacement[] = [];
  for (let index = 0; index < count; index += 1) {
    placements.push(placeLayer(layerLevel(index, count), camera, strength));
  }
  return placements;
}

// Draws the layers around the point (0, 0) of the current space: the caller has
// already moved that point to the middle of the frame.
export function drawParallax(
  ctx: CanvasLike,
  size: FrameSize,
  prepared: DrawableParallax,
  motion: StudioMotion,
  progress: number,
): void {
  const count = prepared.layers.length;
  if (count === 0) return;
  const placements = parallaxPlacements(motion, progress, count);
  for (let index = 0; index < count; index += 1) {
    const place = placements[index];
    ctx.save();
    ctx.translate(place.dx * size.width, place.dy * size.height);
    ctx.scale(place.scale, place.scale);
    ctx.drawImage(
      prepared.layers[index] as never,
      0,
      0,
      prepared.width,
      prepared.height,
      -size.width / 2,
      -size.height / 2,
      size.width,
      size.height,
    );
    ctx.restore();
  }
}
