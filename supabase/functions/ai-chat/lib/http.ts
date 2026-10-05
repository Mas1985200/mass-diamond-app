// supabase/functions/ai-chat/lib/http.ts
// HTTP helpers: CORS headers, JSON responses, abortable attempts, SSE reader.

import { CONNECT_TIMEOUT_MS } from "../config.ts";

export const baseHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const jsonHeaders: Record<string, string> = {
  ...baseHeaders,
  "Content-Type": "application/json",
};

export const sseHeaders: Record<string, string> = {
  ...baseHeaders,
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

export function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");

  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match?.[1] ?? null;
}

export type Attempt = {
  readonly signal: AbortSignal;
  readonly clearConnectTimer: () => void;
};

// An abort signal that fires when the master signal fires or when the
// connect timeout elapses. Call clearConnectTimer() once headers arrive.
export function createAttempt(
  master: AbortSignal,
  timeoutMs: number = CONNECT_TIMEOUT_MS,
): Attempt {
  const controller = new AbortController();

  if (master.aborted) {
    controller.abort();
  } else {
    master.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clearConnectTimer: () => clearTimeout(timer),
  };
}

export async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf("\n");

      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);

        if (line.startsWith("data:")) {
          yield line.slice(5).trim();
        }

        newlineIndex = buffer.indexOf("\n");
      }
    }

    const rest = buffer.trim();

    if (rest.startsWith("data:")) {
      yield rest.slice(5).trim();
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
