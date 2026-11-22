// src/features/video/studio/useFilmMaker.ts
// React hook of the film-making screen: keeps the list of photos (filmDraft.ts),
// takes photos from the phone (photoIntake.ts), makes the film (makeFilm.ts) with
// its progress and cancelling, and cleans up every address it made on the phone.
// All the rules live in those files; this file only joins them to React and to
// the browser.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { canMakeFilm, createBrowserEnv } from "./browserEnv.ts";
import {
  EMPTY_DRAFT,
  draftReducer,
  draftSummary,
  draftToProject,
  type DraftSummary,
  type FilmDraft,
  type PhotoChanges,
} from "./filmDraft.ts";
import { makeFilm, type FilmStage } from "./makeFilm.ts";
import { createBrowserPhotoDeps, importPhoto, releasePhoto } from "./photoIntake.ts";
import type { StudioErrorCode } from "./studioTexts.ts";
import type { StudioAspect, StudioQuality } from "./types.ts";
import type { StudioWarning } from "./validate.ts";

export type FilmPhase = "editing" | "making" | "done";

export interface FilmProgress {
  readonly stage: FilmStage;
  // 0 to 1 inside the stage.
  readonly value: number;
}

export interface FilmOutput {
  // An address on this phone (blob:) to play and download the film from.
  readonly url: string;
  readonly mimeType: string;
  readonly seconds: number;
  readonly fileName: string;
  readonly warnings: StudioWarning[];
  readonly failedScenes: number;
}

export interface FilmMakerHandle {
  readonly draft: FilmDraft;
  readonly summary: DraftSummary;
  // False when this browser cannot record films.
  readonly supported: boolean;
  readonly phase: FilmPhase;
  readonly progress: FilmProgress | null;
  readonly error: StudioErrorCode | null;
  readonly output: FilmOutput | null;
  readonly addPhotos: (files: ArrayLike<File>) => Promise<void>;
  readonly removePhoto: (id: string) => void;
  readonly movePhoto: (id: string, direction: -1 | 1) => void;
  readonly updatePhoto: (id: string, changes: PhotoChanges) => void;
  readonly setShape: (aspectRatio: StudioAspect) => void;
  readonly setQuality: (quality: StudioQuality) => void;
  readonly setTitle: (title: string) => void;
  readonly make: () => void;
  readonly cancel: () => void;
  // Back to an empty screen for a new film.
  readonly reset: () => void;
  // Back to the photos of the same film, to change something and make it again.
  readonly edit: () => void;
}

// Keeps the screen awake while the film is recorded: a sleeping screen would stop
// the drawing. Not every browser can; then the person just keeps the phone awake.
async function keepAwake(): Promise<() => void> {
  try {
    const lock = await navigator.wakeLock?.request("screen");
    return () => {
      void lock?.release().catch(() => undefined);
    };
  } catch {
    return () => undefined;
  }
}

function fileNameFor(mimeType: string): string {
  return mimeType.includes("mp4") ? "mass-diamond-film.mp4" : "mass-diamond-film.webm";
}

export function useFilmMaker(): FilmMakerHandle {
  const [draft, dispatch] = useReducer(draftReducer, EMPTY_DRAFT);
  const [phase, setPhase] = useState<FilmPhase>("editing");
  const [progress, setProgress] = useState<FilmProgress | null>(null);
  const [error, setError] = useState<StudioErrorCode | null>(null);
  const [output, setOutput] = useState<FilmOutput | null>(null);

  const supported = useMemo(() => canMakeFilm(), []);
  const summary = useMemo(() => draftSummary(draft), [draft]);

  const photoDeps = useMemo(() => createBrowserPhotoDeps(), []);
  const counterRef = useRef(0);
  const cancelledRef = useRef(false);
  const makingRef = useRef(false);
  const aliveRef = useRef(true);
  const draftRef = useRef(draft);
  const outputRef = useRef<FilmOutput | null>(null);
  draftRef.current = draft;
  outputRef.current = output;

  // Everything made on the phone is given back when the screen goes away.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      cancelledRef.current = true;
      for (const photo of draftRef.current.photos) releasePhoto(photo.url, photoDeps);
      if (outputRef.current) releasePhoto(outputRef.current.url, photoDeps);
    };
  }, [photoDeps]);

  const addPhotos = useCallback(
    async (files: ArrayLike<File>): Promise<void> => {
      setError(null);
      for (let i = 0; i < files.length; i += 1) {
        const result = await importPhoto(files[i], photoDeps);
        if (!aliveRef.current) {
          if (result.ok) releasePhoto(result.url, photoDeps);
          return;
        }
        if (result.ok) {
          counterRef.current += 1;
          dispatch({
            type: "add",
            id: `photo-${counterRef.current}`,
            url: result.url,
            width: result.width,
            height: result.height,
          });
        } else {
          setError(result.code);
        }
      }
    },
    [photoDeps],
  );

  const removePhoto = useCallback(
    (id: string): void => {
      const photo = draftRef.current.photos.find((item) => item.id === id);
      if (photo) releasePhoto(photo.url, photoDeps);
      dispatch({ type: "remove", id });
    },
    [photoDeps],
  );

  const movePhoto = useCallback((id: string, direction: -1 | 1): void => {
    dispatch({ type: "move", id, direction });
  }, []);
  const updatePhoto = useCallback((id: string, changes: PhotoChanges): void => {
    dispatch({ type: "update", id, changes });
  }, []);
  const setShape = useCallback((aspectRatio: StudioAspect): void => {
    dispatch({ type: "setShape", aspectRatio });
  }, []);
  const setQuality = useCallback((quality: StudioQuality): void => {
    dispatch({ type: "setQuality", quality });
  }, []);
  const setTitle = useCallback((title: string): void => {
    dispatch({ type: "setTitle", title });
  }, []);

  const dropOutput = useCallback((): void => {
    if (outputRef.current) releasePhoto(outputRef.current.url, photoDeps);
    setOutput(null);
  }, [photoDeps]);

  const make = useCallback((): void => {
    if (makingRef.current || !supported) return;
    const current = draftRef.current;
    if (!draftSummary(current).canMake) return;

    makingRef.current = true;
    cancelledRef.current = false;
    dropOutput();
    setError(null);
    setPhase("making");
    setProgress({ stage: "loading", value: 0 });

    let lastStage: FilmStage | null = null;
    let lastPercent = -1;

    void (async () => {
      const release = await keepAwake();
      try {
        const result = await makeFilm(draftToProject(current), createBrowserEnv(), {
          isCancelled: () => cancelledRef.current,
          // The drawing reports every frame; the screen is updated only when the
          // percent or the stage changes.
          onProgress: (stage, value) => {
            const percent = Math.floor(value * 100);
            if (stage === lastStage && percent === lastPercent) return;
            lastStage = stage;
            lastPercent = percent;
            if (aliveRef.current) setProgress({ stage, value });
          },
        });
        // The screen is gone: no address was made yet, so there is nothing to free.
        if (!aliveRef.current) return;
        if (result.ok) {
          setOutput({
            url: URL.createObjectURL(result.blob),
            mimeType: result.mimeType,
            seconds: result.seconds,
            fileName: fileNameFor(result.mimeType),
            warnings: result.warnings,
            failedScenes: result.failedScenes.length,
          });
          setPhase("done");
        } else {
          setError(result.code);
          setPhase("editing");
        }
      } catch {
        if (aliveRef.current) {
          setError("failed");
          setPhase("editing");
        }
      } finally {
        release();
        makingRef.current = false;
        if (aliveRef.current) setProgress(null);
      }
    })();
  }, [supported, dropOutput]);

  const cancel = useCallback((): void => {
    cancelledRef.current = true;
  }, []);

  const edit = useCallback((): void => {
    dropOutput();
    setError(null);
    setPhase("editing");
  }, [dropOutput]);

  const reset = useCallback((): void => {
    cancelledRef.current = true;
    for (const photo of draftRef.current.photos) releasePhoto(photo.url, photoDeps);
    dropOutput();
    setError(null);
    setPhase("editing");
    dispatch({ type: "reset" });
  }, [photoDeps, dropOutput]);

  return {
    draft,
    summary,
    supported,
    phase,
    progress,
    error,
    output,
    addPhotos,
    removePhoto,
    movePhoto,
    updatePhoto,
    setShape,
    setQuality,
    setTitle,
    make,
    cancel,
    reset,
    edit,
  };
}
