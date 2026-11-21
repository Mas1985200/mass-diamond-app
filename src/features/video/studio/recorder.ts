// src/features/video/studio/recorder.ts
// Turns the drawn frames into one video file on the person's phone. The canvas is
// recorded while the film is drawn in real time (a film of 5 minutes takes 5
// minutes to make), so nothing is sent anywhere, nothing is paid, and any number
// of people can do it at the same time.
//
// The browser parts (the canvas stream, the recorder, the clock, the animation
// frame) are handed in, so the rules here (which file type, how big, when to stop,
// what to do when something fails or is cancelled) are tested without a browser.
// Keep the tab open while recording: browsers pause drawing in a hidden tab.

import {
  STUDIO_FPS,
  type StudioQuality,
  type StudioSize,
} from "./types.ts";

export interface StreamLike {
  getTracks(): { stop(): void }[];
}

// A canvas that can be recorded.
export interface RecordingSource {
  captureStream(fps: number): StreamLike;
}

export interface RecorderLike {
  ondataavailable: ((event: { data: { size: number } }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(timesliceMs?: number): void;
  stop(): void;
}

export interface RecorderOptions {
  readonly mimeType: string;
  readonly videoBitsPerSecond: number;
}

export interface RecorderDeps {
  readonly canvas: RecordingSource;
  readonly createRecorder: (stream: StreamLike, options: RecorderOptions) => RecorderLike;
  readonly isTypeSupported: (mimeType: string) => boolean;
  // Calls `callback` at the next screen frame; returns a way to cancel it.
  readonly nextFrame: (callback: () => void) => () => void;
  // The clock in milliseconds.
  readonly now: () => number;
}

export interface RecordOptions {
  // Length of the film in seconds.
  readonly seconds: number;
  readonly size: StudioSize;
  readonly quality: StudioQuality;
  // Draws the frame at this moment (seconds) on the canvas.
  readonly drawAt: (seconds: number) => void;
  // How far the recording is, 0 to 1.
  readonly onProgress?: (progress: number) => void;
  // Asked at every frame; true stops the recording.
  readonly isCancelled?: () => boolean;
}

export type RecordFailure = {
  readonly ok: false;
  readonly code: "unsupported" | "invalid" | "cancelled" | "failed";
};

export type RecordResult =
  | { readonly ok: true; readonly blob: Blob; readonly mimeType: string; readonly seconds: number }
  | RecordFailure;

// The best file type this browser can record. MP4 plays on every phone, so it
// comes first; WebM is the fallback.
const RECORDING_TYPES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

export function pickRecordingType(isSupported: (mimeType: string) => boolean): string | null {
  for (const type of RECORDING_TYPES) {
    let supported = false;
    try {
      supported = isSupported(type);
    } catch {
      supported = false;
    }
    if (supported) return type;
  }
  return null;
}

const BITS_PER_PIXEL: Record<StudioQuality, number> = {
  draft: 0.08,
  standard: 0.1,
  high: 0.14,
};
const MIN_BITRATE = 500_000;
const MAX_BITRATE = 20_000_000;

// Bits per second for the recorder: more pixels and better quality get more.
export function videoBitrate(size: StudioSize, quality: StudioQuality): number {
  const bits = size.width * size.height * STUDIO_FPS * (BITS_PER_PIXEL[quality] ?? BITS_PER_PIXEL.standard);
  if (!Number.isFinite(bits)) return MIN_BITRATE;
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, bits)));
}

// How often the recorder hands over what it has, so nothing waits for the end.
const TIMESLICE_MS = 1000;

export function recordProject(deps: RecorderDeps, options: RecordOptions): Promise<RecordResult> {
  const { seconds, size, quality, drawAt, onProgress, isCancelled } = options;
  if (!(seconds > 0) || !Number.isFinite(seconds) || !(size.width > 0) || !(size.height > 0)) {
    return Promise.resolve({ ok: false, code: "invalid" });
  }
  const mimeType = pickRecordingType(deps.isTypeSupported);
  if (!mimeType) return Promise.resolve({ ok: false, code: "unsupported" });

  return new Promise<RecordResult>((resolve) => {
    let stream: StreamLike;
    let recorder: RecorderLike;
    try {
      stream = deps.canvas.captureStream(STUDIO_FPS);
      recorder = deps.createRecorder(stream, {
        mimeType,
        videoBitsPerSecond: videoBitrate(size, quality),
      });
    } catch {
      resolve({ ok: false, code: "unsupported" });
      return;
    }

    const chunks: { size: number }[] = [];
    let settled = false;
    let cancelFrame: (() => void) | null = null;
    // How the recording ended; the file itself is built when the recorder stops.
    let outcome: { readonly ok: true } | RecordFailure | null = null;

    const release = () => {
      cancelFrame?.();
      cancelFrame = null;
      try {
        for (const track of stream.getTracks()) track.stop();
      } catch {
        // already stopped
      }
    };
    const settle = (result: RecordResult) => {
      if (settled) return;
      settled = true;
      release();
      resolve(result);
    };
    // Stops the recorder and answers when it has handed over its last data.
    const finish = (result: { readonly ok: true } | RecordFailure) => {
      if (outcome) return;
      outcome = result;
      cancelFrame?.();
      cancelFrame = null;
      try {
        recorder.stop();
      } catch {
        settle(result.ok ? { ok: false, code: "failed" } : result);
      }
    };

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => finish({ ok: false, code: "failed" });
    recorder.onstop = () => {
      const result = outcome ?? ({ ok: false, code: "failed" } as RecordFailure);
      if (!result.ok) {
        settle(result);
        return;
      }
      if (chunks.length === 0) {
        settle({ ok: false, code: "failed" });
        return;
      }
      settle({
        ok: true,
        blob: new Blob(chunks as unknown as BlobPart[], { type: mimeType }),
        mimeType,
        seconds,
      });
    };

    let started = 0;
    let lastFrameDrawn = false;
    const step = () => {
      cancelFrame = null;
      if (outcome) return;
      if (isCancelled?.()) {
        finish({ ok: false, code: "cancelled" });
        return;
      }
      try {
        const elapsed = Math.max(0, (deps.now() - started) / 1000);
        if (lastFrameDrawn) {
          // One more screen frame passed after the last drawing: it is recorded.
          finish({ ok: true });
          return;
        }
        if (elapsed >= seconds) {
          drawAt(seconds);
          onProgress?.(1);
          lastFrameDrawn = true;
        } else {
          drawAt(elapsed);
          onProgress?.(elapsed / seconds);
        }
      } catch {
        finish({ ok: false, code: "failed" });
        return;
      }
      cancelFrame = deps.nextFrame(step);
    };

    try {
      drawAt(0);
      recorder.start(TIMESLICE_MS);
      started = deps.now();
      cancelFrame = deps.nextFrame(step);
    } catch {
      finish({ ok: false, code: "failed" });
    }
  });
}
