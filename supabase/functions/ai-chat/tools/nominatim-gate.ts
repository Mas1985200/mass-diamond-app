// supabase/functions/ai-chat/tools/nominatim-gate.ts
// The public Nominatim service allows about one request per second. Every
// request to it waits here first, so several places asked in one message are
// looked up one after another instead of all at once.
// When the service refuses our requests (status 403 or 429) it is skipped for
// a while: new requests fail at once and requests already waiting are
// cancelled, so a refusal never costs a minute of waiting.

import { NOMINATIM_MIN_GAP_MS } from "../config.ts";

const BLOCK_DURATION_MS = 600_000;
const BLOCKED_MESSAGE =
  "Nominatim is skipped for a while because it refused our requests.";
const ABORTED_MESSAGE = "The request was aborted while waiting.";

let nextSlotAt = 0;
let blockedUntil = 0;

// Waiting requests; each entry cancels one waiter because of a block.
const pending = new Set<() => void>();

export function isNominatimBlocked(): boolean {
  return Date.now() < blockedUntil;
}

// Call this with the HTTP status of every Nominatim answer.
export function reportNominatimStatus(status: number): void {
  if (status !== 403 && status !== 429) {
    return;
  }

  blockedUntil = Date.now() + BLOCK_DURATION_MS;
  nextSlotAt = Date.now();

  console.error(
    `Nominatim answered status ${status}; it is skipped for ${BLOCK_DURATION_MS / 60_000} minutes.`,
  );

  for (const giveUp of [...pending]) {
    giveUp();
  }
}

export async function waitForNominatimSlot(
  signal: AbortSignal,
): Promise<void> {
  if (isNominatimBlocked()) {
    throw new Error(BLOCKED_MESSAGE);
  }

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
      reject(new Error(ABORTED_MESSAGE));
      return;
    }

    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      pending.delete(giveUp);
    };

    const giveUp = (): void => {
      cleanup();
      reject(new Error(BLOCKED_MESSAGE));
    };

    const onAbort = (): void => {
      cleanup();
      reject(new Error(ABORTED_MESSAGE));
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, waitMs);

    pending.add(giveUp);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
