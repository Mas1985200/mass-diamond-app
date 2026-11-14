// src/features/video/useVideoModels.ts
// React hooks of the video model chooser: one loads the list of models from
// the video function (once per visit, then kept), the other keeps the person's
// pick on this device. All rules live in videoModels.ts, videoModelStore.ts
// and videoApi.ts; this file only joins them to React and to the browser.

import { useCallback, useEffect, useMemo, useState } from "react";

import { videoModelsApi } from "./videoClient.ts";
import {
  DEFAULT_CREDITS_PER_SECOND,
  resolveChoice,
  type CreditsPerSecond,
  type VideoModel,
} from "./videoModels.ts";
import {
  readSavedModel,
  writeSavedModel,
  type KeyValueStorage,
} from "./videoModelStore.ts";

export type ModelsStatus = "loading" | "ready" | "failed";

export interface VideoModelsState {
  readonly status: ModelsStatus;
  readonly models: readonly VideoModel[];
  readonly prices: CreditsPerSecond;
}

interface Loaded {
  readonly models: readonly VideoModel[];
  readonly prices: CreditsPerSecond;
}

// The list does not change while the app is open, so it is asked for once.
let cached: Loaded | null = null;

function startState(): VideoModelsState {
  return cached
    ? { status: "ready", models: cached.models, prices: cached.prices }
    : { status: "loading", models: [], prices: DEFAULT_CREDITS_PER_SECOND };
}

// Loads the models while "enabled" is true (the video mode is on). When the
// list cannot be loaded the state is "failed" and the chooser stays hidden, so
// a video can still be made with the automatic choice.
export function useVideoModels(enabled: boolean): VideoModelsState {
  const [state, setState] = useState<VideoModelsState>(startState);

  useEffect(() => {
    if (!enabled || cached) {
      return;
    }

    const controller = new AbortController();

    void videoModelsApi.models(controller.signal).then((outcome) => {
      if (controller.signal.aborted) {
        return;
      }

      const answer = outcome.kind === "answer" ? outcome.answer : null;

      if (answer && answer.ok) {
        cached = { models: answer.models, prices: answer.creditsPerSecond };
        setState({
          status: "ready",
          models: answer.models,
          prices: answer.creditsPerSecond,
        });
      } else {
        setState((previous) => ({ ...previous, status: "failed" }));
      }
    });

    return () => controller.abort();
  }, [enabled]);

  return state;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface VideoModelChoice {
  // The model in use: "auto" or the id of a model that is ready.
  readonly choice: string;
  readonly choose: (id: string) => void;
}

// The pick is saved on this device. A saved pick that is no longer usable
// (the model is gone or not connected) quietly becomes "auto".
export function useVideoModelChoice(
  models: readonly VideoModel[],
): VideoModelChoice {
  const [saved, setSaved] = useState<string | null>(() =>
    readSavedModel(browserStorage()),
  );

  const choice = useMemo(() => resolveChoice(saved, models), [saved, models]);

  const choose = useCallback((id: string): void => {
    setSaved(id);
    writeSavedModel(browserStorage(), id);
  }, []);

  return { choice, choose };
}

// end of useVideoModels.ts
