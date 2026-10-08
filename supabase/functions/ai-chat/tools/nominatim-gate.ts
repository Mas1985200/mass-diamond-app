// supabase/functions/ai-chat/tools/nominatim-gate.ts
// The public Nominatim service allows about one request per second. Every
// request to it waits here first, so several places asked in one message are
// looked up one after another instead of all at once.

import { NOMINATIM_MIN_GAP_MS } from "../config.ts";

let nextSlotAt = 0;

export async function waitForNominatimSlot(
  signal: AbortSignal,
): Promise<void> {
  const now = Date.now();
  const startAt = Math.max(now, nextSlotAt);

  // Reserve the slot before waiting, so concurrent callers queue up.
  nextSlotAt = startAt + NOMINATIM_MIN_GAP_MS;

  const waitMs = startAt - now;

  if (waitMs <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("The request was aborted while waiting."));
      return;
    }

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("The request was aborted while waiting."));
    };

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, waitMs);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
