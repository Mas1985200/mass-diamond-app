// src/features/video/studio/parallaxCache.ts
// Keeps the 3D layers of the scenes that are on screen or about to be, and nothing
// more: layers are big (several full pictures per photo), so a scene that is over
// is let go, and a scene that is coming is made a little at a time, one small step
// between two frames, so the recording never stops to wait for it.
//
// Time only goes forward while a film is recorded. The cache knows nothing about
// canvases: how a builder is made and how layers are let go are given by the caller.

import type { ParallaxBuilder, PreparedParallax } from "./parallaxLayers.ts";
import type { Timeline } from "./timeline.ts";

export interface ParallaxCacheOptions<T> {
  readonly timeline: Timeline;
  // The builder of scene `index`, or null when that scene cannot be 3D (no depth,
  // no picture): it is then drawn flat.
  readonly makeBuilder: (index: number) => ParallaxBuilder<T> | null;
  // Called when the layers of a scene are let go (free the canvases here).
  readonly release?: (prepared: PreparedParallax<T>) => void;
  // How many seconds ahead a scene is started.
  readonly lookaheadSeconds?: number;
}

export interface ParallaxCache<T> {
  // Does up to `steps` small steps of work for the scenes needed at `time`, and lets
  // go of the scenes that are over. Call it once between frames.
  tick(time: number, steps?: number): void;
  // Works until every scene needed at `time` is ready (or known to be flat). Used
  // before the recording starts, so the first scenes are never late.
  settle(time: number): void;
  // The layers that are ready, by scene index. The same object until something changes.
  ready(): ReadonlyMap<number, PreparedParallax<T>>;
  // Lets go of everything.
  dispose(): void;
}

export const DEFAULT_LOOKAHEAD_SECONDS = 2;

interface Entry<T> {
  builder: ParallaxBuilder<T> | null;
  prepared: PreparedParallax<T> | null;
  // Cannot be 3D: draw flat.
  flat: boolean;
}

export function createParallaxCache<T>(options: ParallaxCacheOptions<T>): ParallaxCache<T> {
  const { timeline, makeBuilder, release } = options;
  const lookahead =
    options.lookaheadSeconds !== undefined &&
    Number.isFinite(options.lookaheadSeconds) &&
    options.lookaheadSeconds >= 0
      ? options.lookaheadSeconds
      : DEFAULT_LOOKAHEAD_SECONDS;
  const lastIndex = timeline.scenes.length - 1;

  const entries = new Map<number, Entry<T>>();
  let snapshot: Map<number, PreparedParallax<T>> | null = null;

  const letGo = (index: number) => {
    const entry = entries.get(index);
    if (!entry) return;
    entries.delete(index);
    if (entry.prepared) {
      snapshot = null;
      release?.(entry.prepared);
    }
  };

  // Scenes on screen at `time` or starting within the look-ahead, in order.
  const needed = (time: number): number[] => {
    const list: number[] = [];
    for (const planned of timeline.scenes) {
      const over = planned.end <= time && planned.index !== lastIndex;
      if (!over && planned.start <= time + lookahead) list.push(planned.index);
    }
    return list;
  };

  const unresolved = (index: number): boolean => {
    const entry = entries.get(index);
    return !entry || (!entry.prepared && !entry.flat);
  };

  const work = (time: number, budget: number): void => {
    // Let go of the scenes that are over.
    for (const planned of timeline.scenes) {
      if (planned.end <= time && planned.index !== lastIndex) letGo(planned.index);
    }
    let left = budget;
    for (const index of needed(time)) {
      if (left <= 0) break;
      if (!unresolved(index)) continue;
      let entry = entries.get(index);
      if (!entry) {
        let builder: ParallaxBuilder<T> | null = null;
        try {
          builder = makeBuilder(index);
        } catch {
          builder = null;
        }
        entry = { builder, prepared: null, flat: builder === null };
        entries.set(index, entry);
        if (entry.flat) continue; // nothing to build: costs no step
      }
      const builder = entry.builder;
      if (!builder) continue;
      // The scene first in line gets the steps; the next one waits for its turn.
      while (left > 0 && builder.state === "working") {
        builder.step();
        left -= 1;
      }
      if (builder.state === "done") {
        entry.prepared = builder.result();
        entry.flat = entry.prepared === null;
        entry.builder = null;
        snapshot = null;
      } else if (builder.state === "failed") {
        entry.flat = true;
        entry.builder = null;
      }
    }
  };

  return {
    tick(time, steps = 1) {
      if (!Number.isFinite(time)) return;
      work(time, Math.max(1, Math.floor(steps)));
    },
    settle(time) {
      if (!Number.isFinite(time)) return;
      // Every scene needs at most (steps of a builder) turns; the guard only stops a
      // builder that never finishes.
      for (let guard = 0; guard < 100_000; guard += 1) {
        work(time, 1);
        if (!needed(time).some(unresolved)) return;
      }
    },
    ready() {
      if (!snapshot) {
        snapshot = new Map();
        for (const [index, entry] of entries) {
          if (entry.prepared) snapshot.set(index, entry.prepared);
        }
      }
      return snapshot;
    },
    dispose() {
      for (const index of Array.from(entries.keys())) letGo(index);
      snapshot = null;
    },
  };
}
