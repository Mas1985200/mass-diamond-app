// supabase/functions/transcribe/usage.ts
// Two small helpers that protect the speech service from waste and abuse.
// Pure code (no network, no Deno), so they are tested directly.
//
// Both keep their state in the memory of the running function instance. That
// is a real limit: the platform may run several instances at once, and every
// instance has its own counters, and they start empty again when an instance
// is replaced. They stop quick repeated use and double work on a warm
// instance, which is the common case; they are not a hard global quota.

type Clock = () => number;

// ---------------------------------------------------------------------------
// Rate limit: at most `max` requests per `windowMs` for each key (the user).
// ---------------------------------------------------------------------------

export interface RateDecision {
  readonly allowed: boolean;
  // When not allowed: whole seconds until the next request would be accepted.
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  readonly check: (key: string) => RateDecision;
}

const MAX_TRACKED_KEYS = 5_000;

export function createRateLimiter(
  max: number,
  windowMs: number,
  now: Clock = Date.now,
): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    check(key: string): RateDecision {
      const current = now();
      const recent = (hits.get(key) ?? []).filter(
        (time) => current - time < windowMs,
      );

      if (recent.length >= max) {
        hits.set(key, recent);

        const oldest = recent[0] ?? current;

        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((oldest + windowMs - current) / 1000),
          ),
        };
      }

      recent.push(current);

      // Re-inserted so the map stays ordered by last use.
      hits.delete(key);
      hits.set(key, recent);

      if (hits.size > MAX_TRACKED_KEYS) {
        const oldestKey = hits.keys().next().value;

        if (oldestKey !== undefined) {
          hits.delete(oldestKey);
        }
      }

      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

// ---------------------------------------------------------------------------
// Replay guard: the same request (same key) is worked on once.
//  - while it is running, another request with the same key waits for that
//    same work instead of starting a second one;
//  - after it ended well, the same key gets the same answer for `ttlMs`;
//  - an answer that is not worth keeping (an error) is never kept, so asking
//    again really tries again.
// ---------------------------------------------------------------------------

export interface ReplayGuard<T> {
  readonly run: (key: string, work: () => Promise<T>) => Promise<T>;
}

export function createReplayGuard<T>(
  ttlMs: number,
  maxEntries: number,
  keep: (value: T) => boolean,
  now: Clock = Date.now,
): ReplayGuard<T> {
  const running = new Map<string, Promise<T>>();
  const finished = new Map<string, { readonly value: T; readonly until: number }>();

  function remember(key: string, value: T): void {
    finished.delete(key);
    finished.set(key, { value, until: now() + ttlMs });

    while (finished.size > maxEntries) {
      const oldestKey = finished.keys().next().value;

      if (oldestKey === undefined) {
        break;
      }

      finished.delete(oldestKey);
    }
  }

  return {
    run(key: string, work: () => Promise<T>): Promise<T> {
      const done = finished.get(key);

      if (done) {
        if (done.until > now()) {
          return Promise.resolve(done.value);
        }

        finished.delete(key);
      }

      const active = running.get(key);

      if (active) {
        return active;
      }

      const started = work().then(
        (value) => {
          running.delete(key);

          if (keep(value)) {
            remember(key, value);
          }

          return value;
        },
        (failure: unknown) => {
          running.delete(key);

          throw failure;
        },
      );

      running.set(key, started);

      return started;
    },
  };
}
