// src/features/video/studio/timeline.ts
// The clock of the studio: when each scene starts and ends, and what must be
// drawn at any moment (which pictures, how transparent, how far shifted or
// zoomed). The scene that is leaving and the scene that is coming overlap while
// they change; the change belongs to the scene that is leaving ("fade" means
// that scene fades into the next one).
//
// Pure numbers: no canvas, no browser, so every rule here is tested. The drawing
// code only follows what this file says.

import {
  STUDIO_FPS,
  STUDIO_LIMITS,
  type StudioProject,
  type StudioScene,
} from "./types.ts";

export interface PlannedScene {
  readonly index: number;
  readonly scene: StudioScene;
  // Seconds from the start of the video.
  readonly start: number;
  readonly end: number;
  readonly seconds: number;
  // How long the change from the scene before into this one takes (0: none).
  readonly overlapIn: number;
  // How long the change from this scene into the next one takes (0: none).
  readonly overlapOut: number;
}

export interface Timeline {
  readonly scenes: readonly PlannedScene[];
  readonly totalSeconds: number;
}

// One picture to draw, in the order given (the first is drawn first).
export interface Layer {
  readonly index: number;
  // How far the scene has gone, 0 to 1 (the camera motion follows it).
  readonly sceneProgress: number;
  // 0 (invisible) to 1 (solid).
  readonly alpha: number;
  // Shift to the right as a part of the frame width (-1: one whole frame left).
  readonly offsetX: number;
  // 1 is the normal size.
  readonly scale: number;
}

export interface NarrationCue {
  readonly index: number;
  readonly start: number;
  readonly text: string;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// Whole milliseconds, so the same project always gives the same times.
function ms(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function cleanSeconds(value: number): number {
  if (!Number.isFinite(value)) return STUDIO_LIMITS.minSceneSeconds;
  return clamp(value, STUDIO_LIMITS.minSceneSeconds, STUDIO_LIMITS.maxSceneSeconds);
}

// Soft start and soft end: 0 stays 0, 1 stays 1.
export function smoothstep(p: number): number {
  const x = clamp(p, 0, 1);
  return x * x * (3 - 2 * x);
}

export function buildTimeline(project: StudioProject): Timeline {
  const scenes = project.scenes;
  const count = scenes.length;
  const seconds = scenes.map((scene) => cleanSeconds(scene.seconds));

  // The change after scene i. Half of the shorter of the two scenes at most, so
  // a scene is never in two changes at the same moment.
  const overlap: number[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    const scene = scenes[i];
    const wanted =
      scene.transition === "cut" || !Number.isFinite(scene.transitionSeconds)
        ? 0
        : clamp(scene.transitionSeconds, 0, STUDIO_LIMITS.maxTransitionSeconds);
    overlap.push(ms(Math.min(wanted, seconds[i] / 2, seconds[i + 1] / 2)));
  }

  const planned: PlannedScene[] = [];
  let start = 0;
  for (let i = 0; i < count; i += 1) {
    const overlapIn = i > 0 ? overlap[i - 1] : 0;
    const overlapOut = i < count - 1 ? overlap[i] : 0;
    const end = ms(start + seconds[i]);
    planned.push({
      index: i,
      scene: scenes[i],
      start,
      end,
      seconds: seconds[i],
      overlapIn,
      overlapOut,
    });
    start = ms(end - overlapOut);
  }

  return {
    scenes: planned,
    totalSeconds: planned.length > 0 ? planned[planned.length - 1].end : 0,
  };
}

export function totalFrames(totalSeconds: number, fps: number = STUDIO_FPS): number {
  if (!(totalSeconds > 0) || !(fps > 0)) return 0;
  return Math.max(1, Math.ceil(totalSeconds * fps));
}

// The moment of a frame, in seconds.
export function frameTime(frame: number, fps: number = STUDIO_FPS): number {
  return fps > 0 ? Math.max(0, frame) / fps : 0;
}

function progressOf(planned: PlannedScene, time: number): number {
  return clamp((time - planned.start) / planned.seconds, 0, 1);
}

const SOLID = { alpha: 1, offsetX: 0, scale: 1 } as const;

// What to draw at `time` (seconds). Before the start it is the first moment, after
// the end it is the last one. An empty project draws nothing.
export function layersAt(timeline: Timeline, time: number): Layer[] {
  const scenes = timeline.scenes;
  if (scenes.length === 0) return [];

  const t = Number.isFinite(time) ? clamp(time, 0, timeline.totalSeconds) : 0;
  const last = scenes[scenes.length - 1];
  if (t >= last.end) {
    return [{ index: last.index, sceneProgress: 1, ...SOLID }];
  }

  const active = scenes.filter((planned) => planned.start <= t && t < planned.end);
  if (active.length === 1) {
    const only = active[0];
    return [{ index: only.index, sceneProgress: progressOf(only, t), ...SOLID }];
  }

  // Two scenes overlap: the one leaving and the one coming.
  const leaving = active[0];
  const coming = active[1];
  const p = smoothstep((t - coming.start) / coming.overlapIn);
  const leavingLayer = { index: leaving.index, sceneProgress: progressOf(leaving, t) };
  const comingLayer = { index: coming.index, sceneProgress: progressOf(coming, t) };

  switch (leaving.scene.transition) {
    case "slide-left":
      return [
        { ...leavingLayer, alpha: 1, offsetX: -p, scale: 1 },
        { ...comingLayer, alpha: 1, offsetX: 1 - p, scale: 1 },
      ];
    case "slide-right":
      return [
        { ...leavingLayer, alpha: 1, offsetX: p, scale: 1 },
        { ...comingLayer, alpha: 1, offsetX: -(1 - p), scale: 1 },
      ];
    case "zoom":
      // The coming scene is under; the leaving one grows and fades away.
      return [
        { ...comingLayer, ...SOLID },
        { ...leavingLayer, alpha: 1 - p, offsetX: 0, scale: 1 + 0.3 * p },
      ];
    default:
      // "fade": the coming scene appears over the leaving one.
      return [
        { ...leavingLayer, ...SOLID },
        { ...comingLayer, alpha: p, offsetX: 0, scale: 1 },
      ];
  }
}

// When each narration must start (the start of its scene), for the player.
export function narrationCues(timeline: Timeline): NarrationCue[] {
  const cues: NarrationCue[] = [];
  for (const planned of timeline.scenes) {
    const text = planned.scene.narration?.trim();
    if (text) cues.push({ index: planned.index, start: planned.start, text });
  }
  return cues;
}
