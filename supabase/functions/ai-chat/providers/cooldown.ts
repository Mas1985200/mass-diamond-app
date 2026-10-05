// supabase/functions/ai-chat/providers/cooldown.ts
// Per-model cooldown memory so a rate-limited model is skipped immediately.

import { COOLDOWN_DEFAULT_MS, COOLDOWN_MAX_MS } from "../config.ts";

const readyAt = new Map<string, number>();

export function markCooldown(model: string, ms: number | null): void {
  const wait = Math.min(ms ?? COOLDOWN_DEFAULT_MS, COOLDOWN_MAX_MS);

  readyAt.set(model, Date.now() + wait);
}

export function cooldownLeftMs(model: string): number {
  const left = (readyAt.get(model) ?? 0) - Date.now();

  return left > 0 ? left : 0;
}

export function soonestReadyMs(models: readonly string[]): number {
  let soonest = Number.POSITIVE_INFINITY;

  for (const model of models) {
    soonest = Math.min(soonest, cooldownLeftMs(model));
  }

  return Number.isFinite(soonest) ? soonest : 0;
}

// Parses Groq's "Please try again in 1m2.5s" style hints.
export function parseRetryDelayMs(errorText: string): number | null {
  const match = /try again in\s+((?:\d+(?:\.\d+)?(?:ms|s|m|h))+)/i.exec(
    errorText,
  );

  if (!match || !match[1]) {
    return null;
  }

  let total = 0;

  for (const part of match[1].matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/gi)) {
    const value = Number(part[1]);
    const unit = (part[2] ?? "").toLowerCase();

    total +=
      unit === "ms"
        ? value
        : unit === "s"
          ? value * 1_000
          : unit === "m"
            ? value * 60_000
            : value * 3_600_000;
  }

  return Number.isFinite(total) && total > 0 ? Math.ceil(total) : null;
}
