// src/features/voice/retryPolicy.ts
// When and how long to wait before asking the speech service again.
// Pure functions (no timers, no network), so they are tested directly.

// One request plus at most two more. A recording that still fails is kept so
// the person can send it again without speaking again.
export const MAX_ATTEMPTS = 3;

// The pause grows with every failure: 600 ms, 1.2 s, 2.4 s ... never above the
// cap.
export const RETRY_BASE_MS = 600;
export const RETRY_MAX_PAUSE_MS = 4_000;

// The person never waits longer than this for the automatic tries together.
export const TOTAL_BUDGET_MS = 45_000;

// `attempt` is the number (1, 2, ...) of the try that has just failed.
export function retryPauseMs(attempt: number): number {
  const number = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;

  return Math.min(RETRY_BASE_MS * 2 ** (number - 1), RETRY_MAX_PAUSE_MS);
}

// True when another automatic try fits: the limit of tries is not reached and
// waiting for the next pause still leaves the total time within the budget.
export function mayTryAgain(attempt: number, elapsedMs: number): boolean {
  return (
    attempt < MAX_ATTEMPTS &&
    elapsedMs + retryPauseMs(attempt) < TOTAL_BUDGET_MS
  );
}
