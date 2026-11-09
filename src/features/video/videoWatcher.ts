// src/features/video/videoWatcher.ts
// Watches one video until it is finished: asks the video function how it is
// doing, reports every change, and waits between asks (calmly at first, slower
// after failures, very slow while the page is hidden). No React and no timers
// of its own: the api, the waiting and "is the page hidden" are given in, so
// the whole loop is tested with a fake network and a fake clock.

import type { VideoApi } from "./videoApi.ts";
import {
  isFinalAnswerError,
  nextPollDelayMs,
  type VideoJob,
} from "./videoCard.ts";

export interface WatchState {
  // The last answer for the video (null before the first answer).
  readonly job: VideoJob | null;
  // The server says this video does not exist (or the person is signed out).
  readonly missing: boolean;
  // The last ask got no answer (weak or cut internet); asking goes on.
  readonly offline: boolean;
}

export interface WatchDeps {
  readonly api: Pick<VideoApi, "status">;
  // Waits `ms`, but may return earlier (the page became visible, the internet
  // came back) and must return when the signal is aborted.
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly isHidden: () => boolean;
}

export const START_STATE: WatchState = { job: null, missing: false, offline: false };

const isDone = (job: VideoJob): boolean =>
  job.status === "succeeded" || job.status === "failed" || job.status === "canceled";

// Runs until the video is finished, the answer is final, or the signal is
// aborted. `from` is what the card already knows (kept while asking again).
export async function watchVideo(
  deps: WatchDeps,
  jobId: string,
  onState: (state: WatchState) => void,
  signal: AbortSignal,
  from: WatchState = START_STATE,
): Promise<void> {
  let state = from;
  let workingAnswers = 0;
  let failuresInRow = 0;

  while (!signal.aborted) {
    const outcome = await deps.api.status(jobId, signal);
    if (signal.aborted || outcome.kind === "aborted") return;

    if (outcome.kind === "unreachable") {
      failuresInRow += 1;
      state = { ...state, offline: true };
    } else if (outcome.answer.ok) {
      const job = outcome.answer.job;
      failuresInRow = 0;
      state = { job, missing: false, offline: false };
      if (isDone(job)) {
        onState(state);
        return;
      }
      workingAnswers += 1;
    } else if (isFinalAnswerError(outcome.answer.code, outcome.answer.retryable)) {
      onState({ ...state, missing: true, offline: false });
      return;
    } else {
      failuresInRow += 1;
      state = { ...state, offline: true };
    }

    onState(state);
    await deps.wait(
      nextPollDelayMs({ workingAnswers, failuresInRow, hidden: deps.isHidden() }),
      signal,
    );
  }
}
