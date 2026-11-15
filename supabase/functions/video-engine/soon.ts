// supabase/functions/video-engine/soon.ts
// Answers a request quickly while slow work goes on in the background.
//
// Some engines (the Gradio Space) can only be followed by ONE connection that
// stays open until the video is ready: closing it cancels the work. Following
// it takes longer than the app is willing to wait for one answer, so the
// request waits a little, and when the work is not done yet it answers with the
// state as it is now and lets the work finish by itself (keepAlive asks the
// runtime not to stop it). The next request from the app sees the result.
//
// Pure code: the clock, the work and the keep-alive door are all given in.

export interface SoonDeps<T> {
  // The slow work, already started.
  readonly work: Promise<T>;
  // How long to wait for it before answering without it.
  readonly waitMs: number;
  // The answer to give when the work is not done yet.
  readonly fallback: () => Promise<T>;
  // Keeps the work running after the answer is sent.
  readonly keepAlive: (task: Promise<unknown>) => void;
  // Called when the work fails after the answer was already sent.
  readonly onLateError?: (error: unknown) => void;
}

const LATE = Symbol("late");

export async function answerSoon<T>(deps: SoonDeps<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), deps.waitMs);
  });

  try {
    const first = await Promise.race([deps.work, late]);
    if (first !== LATE) return first;
  } finally {
    clearTimeout(timer);
  }

  deps.keepAlive(
    deps.work.then(
      () => undefined,
      (error) => deps.onLateError?.(error),
    ),
  );
  return deps.fallback();
}

// end of soon.ts
