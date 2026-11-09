// src/features/video/useVideoJob.ts
// React hook of the video card: watches one video (videoWatcher.ts) while the
// card is on the screen, and offers "cancel" and "ask again now". All rules
// live in videoWatcher.ts and videoCard.ts; this file only joins them to React
// and to the browser (page visibility, the internet coming back).

import { useCallback, useEffect, useRef, useState } from "react";

import { videoApi } from "./videoClient.ts";
import { viewOf, type CardView, type VideoJob } from "./videoCard.ts";
import {
  START_STATE,
  watchVideo,
  type WatchDeps,
  type WatchState,
} from "./videoWatcher.ts";

// Waits, but wakes up early when the page becomes visible again or the
// internet comes back, and always ends when the card goes away.
function browserWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const onVisible = (): void => {
      if (!document.hidden) {
        finish();
      }
    };

    const finish = (): void => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", finish);
      signal.removeEventListener("abort", finish);
      resolve();
    };

    const timer = setTimeout(finish, ms);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", finish);
    signal.addEventListener("abort", finish, { once: true });
  });
}

const DEPS: WatchDeps = {
  api: videoApi,
  wait: browserWait,
  isHidden: () => document.hidden,
};

export interface VideoJobHandle {
  readonly view: CardView;
  readonly job: VideoJob | null;
  // The last ask got no answer (weak internet); it is retried by itself.
  readonly offline: boolean;
  readonly canceling: boolean;
  readonly cancel: () => void;
  // Asks again right now (for example when the link of the video expired).
  readonly reload: () => void;
}

export function useVideoJob(jobId: string): VideoJobHandle {
  const [state, setState] = useState<WatchState>(START_STATE);
  const [canceling, setCanceling] = useState(false);
  const [round, setRound] = useState(0);

  const stateRef = useRef<WatchState>(START_STATE);
  const aliveRef = useRef(true);

  const publish = useCallback((next: WatchState): void => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    aliveRef.current = true;

    return () => {
      aliveRef.current = false;
    };
  }, []);

  // The card is made for one video (its parent gives it a key with the job id),
  // so the watching starts from nothing, and "reload" starts it again from what
  // is already known.
  useEffect(() => {
    const controller = new AbortController();

    void watchVideo(
      DEPS,
      jobId,
      (next) => {
        if (!controller.signal.aborted) {
          publish(next);
        }
      },
      controller.signal,
      { ...stateRef.current, missing: false },
    );

    return () => controller.abort();
  }, [jobId, round, publish]);

  const cancel = useCallback((): void => {
    setCanceling(true);

    void videoApi.cancel(jobId).then((outcome) => {
      if (!aliveRef.current) {
        return;
      }

      setCanceling(false);

      if (outcome.kind === "answer" && outcome.answer.ok) {
        publish({ job: outcome.answer.job, missing: false, offline: false });
      }
    });
  }, [jobId, publish]);

  const reload = useCallback((): void => {
    setRound((current) => current + 1);
  }, []);

  return {
    view: viewOf(state.job, state.missing),
    job: state.job,
    offline: state.offline,
    canceling,
    cancel,
    reload,
  };
}
