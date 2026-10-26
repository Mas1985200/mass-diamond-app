// src/hooks/useVoiceInput.ts
// Voice input: records a short message with the microphone, sends it to the
// `transcribe` Edge Function and hands the text to the caller. It works in
// every browser that can record (it does not depend on the browser's own
// speech recognition, which needs foreign servers).

import { useCallback, useEffect, useRef, useState } from "react";

import {
  MAX_ATTEMPTS,
  mayTryAgain,
  retryPauseMs,
  shouldKeepRecording,
} from "../features/voice/retryPolicy";
import { normalizeTranscript } from "../features/voice/textNormalizer";
import { supabase } from "../lib/supabase";

export type VoiceState = "idle" | "recording" | "transcribing";

export type VoiceErrorCode =
  | "unsupported"
  | "permission"
  | "no_microphone"
  | "auth"
  | "no_speech"
  | "rate_limited"
  | "network"
  | "failed";

export interface VoiceInputOptions {
  // ISO code of the spoken language ("fa", "en"); empty = auto-detect.
  readonly language: string;
  // Called once with the recognized text, cleaned for reading (letter forms,
  // spacing, half-spaces, punctuation). `raw` is the text exactly as the server
  // returned it, for a caller that wants to keep it.
  readonly onText: (text: string, raw: string) => void;
  // Optional: words the same person wrote earlier (the unsent draft, recent
  // messages). It is asked for when the recording is sent and helps the server
  // choose the right words, names and spelling.
  readonly getContext?: () => string;
}

export interface VoiceInput {
  readonly supported: boolean;
  readonly state: VoiceState;
  readonly error: VoiceErrorCode | null;
  readonly seconds: number;
  // True when the last recording could not be turned into text because of a
  // connection or service problem and is still kept (in memory only), so
  // `retry` can send it again without speaking again.
  readonly canRetry: boolean;
  readonly start: () => Promise<void>;
  readonly stop: () => void;
  readonly cancel: () => void;
  readonly retry: () => void;
  readonly clearError: () => void;
}

const MAX_RECORD_SECONDS = 60;
const MIN_AUDIO_BYTES = 800;
const AUDIO_BITS_PER_SECOND = 32_000;
const MAX_CONTEXT_SEND_CHARS = 600;
// The server does two steps (speech model, then a repair step), so a normal
// answer can take several seconds. A request that is stuck (weak or
// interrupted connection) is still given up and tried again with the same
// recording (see retryPolicy.ts for how often and how long), so the user never
// waits for nothing.
const ATTEMPT_TIMEOUT_MS = 20_000;

const MIME_CANDIDATES: readonly string[] = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function isVoiceSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "";
}

function micErrorCode(failure: unknown): VoiceErrorCode {
  const name =
    typeof failure === "object" &&
    failure !== null &&
    "name" in failure &&
    typeof (failure as { name: unknown }).name === "string"
      ? (failure as { name: string }).name
      : "";

  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "SecurityError"
  ) {
    return "permission";
  }

  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError"
  ) {
    return "no_microphone";
  }

  return "failed";
}

// One id per recording, the same for every try of that recording, so the server
// can recognize a repeated request.
function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// A recording kept in memory after a failure (never stored on the device).
interface PendingRecording {
  readonly blob: Blob;
  readonly requestId: string;
}

function transcribeUrl(): string | null {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;

  return base ? `${base.replace(/\/+$/, "")}/functions/v1/transcribe` : null;
}

// `retry` says whether asking again with the same recording can help.
type Reply =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly code: VoiceErrorCode;
      readonly retry: boolean;
    };

function readReply(payload: unknown): Reply {
  if (typeof payload !== "object" || payload === null) {
    // Not an answer of our function (for example a gateway error page).
    return { ok: false, code: "failed", retry: true };
  }

  const record = payload as {
    success?: unknown;
    text?: unknown;
    error?: unknown;
  };

  if (record.success === true && typeof record.text === "string") {
    return { ok: true, text: record.text.trim() };
  }

  const detail =
    typeof record.error === "object" && record.error !== null
      ? (record.error as { code?: unknown; retryable?: unknown })
      : null;
  const serverCode = typeof detail?.code === "string" ? detail.code : "";

  if (serverCode === "RATE_LIMITED") {
    return { ok: false, code: "rate_limited", retry: false };
  }

  if (serverCode === "AUTH_REQUIRED") {
    return { ok: false, code: "auth", retry: false };
  }

  if (serverCode === "AUDIO_TOO_SHORT") {
    return { ok: false, code: "no_speech", retry: false };
  }

  return { ok: false, code: "failed", retry: detail?.retryable === true };
}

type Attempt =
  | { readonly kind: "reply"; readonly reply: Reply }
  | { readonly kind: "network" };

// One request. A connection that fails, or does not answer within the time
// limit, is reported as "network" so the caller can try once more.
async function sendOnce(
  url: string,
  anonKey: string,
  token: string,
  blob: Blob,
  requestId: string,
  language: string,
  context: string,
  controllerRef: { current: AbortController | null },
): Promise<Attempt> {
  const form = new FormData();

  form.append("audio", blob, "recording");
  form.append("request_id", requestId);

  if (language) {
    form.append("language", language);
  }

  if (context) {
    form.append("context", context);
  }

  const controller = new AbortController();

  // Kept so that cancelling stops the request that is running right now.
  controllerRef.current = controller;

  const timer = window.setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      body: form,
      signal: controller.signal,
    });

    const payload: unknown = await response.json().catch(() => null);

    return { kind: "reply", reply: readReply(payload) };
  } catch {
    return { kind: "network" };
  } finally {
    window.clearTimeout(timer);
  }
}

export function useVoiceInput(options: VoiceInputOptions): VoiceInput {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<VoiceErrorCode | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [canRetry, setCanRetry] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Every recording gets a number; a result that arrives for an older number
  // (cancelled, or replaced) is thrown away.
  const sessionRef = useRef(0);
  // Synchronous lock: two quick taps never start two recordings.
  const busyRef = useRef(false);
  const tickRef = useRef<number | null>(null);
  const limitRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // The recording that failed for a connection or service reason, kept in
  // memory so it can be sent again. Cleared by success, cancel, a new
  // recording and leaving the screen.
  const pendingRef = useRef<PendingRecording | null>(null);
  const onTextRef = useRef(options.onText);
  const languageRef = useRef(options.language);
  const getContextRef = useRef(options.getContext);

  useEffect(() => {
    onTextRef.current = options.onText;
    languageRef.current = options.language;
    getContextRef.current = options.getContext;
  });

  const keepPending = useCallback((pending: PendingRecording | null): void => {
    pendingRef.current = pending;
    setCanRetry(pending !== null);
  }, []);

  const release = useCallback((): void => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }

    if (limitRef.current !== null) {
      window.clearTimeout(limitRef.current);
      limitRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const transcribe = useCallback(
    async (
      session: number,
      blob: Blob,
      requestId: string,
    ): Promise<void> => {
      const url = transcribeUrl();
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
        | string
        | undefined;

      let code: VoiceErrorCode | null = null;
      let text = "";
      // Whether sending this same recording again could still help (see
      // shouldKeepRecording in retryPolicy.ts).
      let serviceSaidRetry = false;

      // What the person wrote before is read now, not when the recording
      // started, so words typed while speaking are included too.
      let context = "";

      try {
        const getContext = getContextRef.current;

        context = getContext
          ? getContext().trim().slice(-MAX_CONTEXT_SEND_CHARS)
          : "";
      } catch {
        context = "";
      }

      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (!token) {
          code = "auth";
        } else if (!url || !anonKey) {
          code = "failed";
        } else {
          const startedAt = Date.now();

          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            // No connection at all: no request is sent and nothing waits for a
            // timeout. The recording is kept, so it can be sent again later.
            if (isOffline()) {
              code = "network";
              serviceSaidRetry = true;
              break;
            }

            const result = await sendOnce(
              url,
              anonKey,
              token,
              blob,
              requestId,
              languageRef.current,
              context,
              abortRef,
            );

            // Cancelled or replaced while waiting: nothing to show.
            if (session !== sessionRef.current) {
              return;
            }

            let retryable = false;

            if (result.kind === "network") {
              code = "network";
              retryable = true;
            } else if (result.reply.ok) {
              code = null;
              text = result.reply.text;
              break;
            } else {
              code = result.reply.code;
              retryable = result.reply.retry;
            }

            serviceSaidRetry = retryable;

            if (!retryable || !mayTryAgain(attempt, Date.now() - startedAt)) {
              break;
            }

            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, retryPauseMs(attempt));
            });

            if (session !== sessionRef.current) {
              return;
            }
          }
        }
      } catch {
        code = "network";
        serviceSaidRetry = true;
      }

      if (session !== sessionRef.current) {
        return;
      }

      abortRef.current = null;
      busyRef.current = false;
      setState("idle");
      setSeconds(0);

      // A connection or service problem: the recording is kept for a retry.
      // Any other outcome (text, nothing heard, not signed in) frees it.
      keepPending(
        code !== null && shouldKeepRecording(code, serviceSaidRetry)
          ? { blob, requestId }
          : null,
      );

      if (code) {
        setError(code);
        return;
      }

      // The cleaning only fixes the surface of the text (it never changes the
      // words); the text exactly as received is handed over as well.
      const cleaned = normalizeTranscript(text, languageRef.current);

      if (!cleaned) {
        setError("no_speech");
        return;
      }

      onTextRef.current(cleaned, text);
    },
    [keepPending],
  );

  const finish = useCallback(
    (session: number, mimeType: string): void => {
      release();

      if (session !== sessionRef.current) {
        chunksRef.current = [];
        return;
      }

      const blob = new Blob(chunksRef.current, {
        type: mimeType || "audio/webm",
      });

      chunksRef.current = [];
      recorderRef.current = null;

      if (blob.size < MIN_AUDIO_BYTES) {
        busyRef.current = false;
        setState("idle");
        setSeconds(0);
        setError("no_speech");
        return;
      }

      setState("transcribing");
      void transcribe(session, blob, newRequestId());
    },
    [release, transcribe],
  );

  const start = useCallback(async (): Promise<void> => {
    if (busyRef.current) {
      return;
    }

    if (!isVoiceSupported()) {
      setError("unsupported");
      return;
    }

    busyRef.current = true;
    setError(null);
    // A new recording replaces the one that was waiting for a retry.
    keepPending(null);

    const session = sessionRef.current + 1;

    sessionRef.current = session;

    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (failure) {
      if (session === sessionRef.current) {
        busyRef.current = false;
        setError(micErrorCode(failure));
      }

      return;
    }

    // Cancelled while the phone was asking for permission.
    if (session !== sessionRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const mime = pickMimeType();
    let recorder: MediaRecorder;

    try {
      recorder = mime
        ? new MediaRecorder(stream, {
            mimeType: mime,
            audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
          })
        : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      busyRef.current = false;
      setError("unsupported");
      return;
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event: BlobEvent): void => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = (): void => {
      finish(session, recorder.mimeType || mime);
    };

    recorder.onerror = (): void => {
      release();

      if (session === sessionRef.current) {
        chunksRef.current = [];
        recorderRef.current = null;
        busyRef.current = false;
        setState("idle");
        setSeconds(0);
        setError("failed");
      }
    };

    try {
      recorder.start();
    } catch {
      release();
      recorderRef.current = null;
      busyRef.current = false;
      setError("failed");
      return;
    }

    const startedAt = Date.now();

    setSeconds(0);
    setState("recording");

    tickRef.current = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    limitRef.current = window.setTimeout(() => {
      if (recorder.state === "recording") {
        recorder.stop();
      }
    }, MAX_RECORD_SECONDS * 1000);
  }, [finish, keepPending, release]);

  // Sends the kept recording again (same request id). Does nothing while
  // another recording or request is running, or when nothing is kept.
  const retry = useCallback((): void => {
    const pending = pendingRef.current;

    if (!pending || busyRef.current) {
      return;
    }

    busyRef.current = true;
    setError(null);

    const session = sessionRef.current + 1;

    sessionRef.current = session;
    setSeconds(0);
    setState("transcribing");
    void transcribe(session, pending.blob, pending.requestId);
  }, [transcribe]);

  const stop = useCallback((): void => {
    const recorder = recorderRef.current;

    if (recorder && recorder.state === "recording") {
      recorder.stop();
    }
  }, []);

  const cancel = useCallback((): void => {
    sessionRef.current += 1;

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const recorder = recorderRef.current;

    recorderRef.current = null;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    release();
    chunksRef.current = [];
    // Cancelling also throws away a recording that was waiting for a retry.
    keepPending(null);
    busyRef.current = false;
    setState("idle");
    setSeconds(0);
  }, [keepPending, release]);

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  // Leaving the screen never leaves the microphone on.
  useEffect(() => {
    return () => {
      sessionRef.current += 1;

      if (abortRef.current) {
        abortRef.current.abort();
      }

      const recorder = recorderRef.current;

      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }

      release();
      pendingRef.current = null;
    };
  }, [release]);

  return {
    supported: isVoiceSupported(),
    state,
    error,
    seconds,
    canRetry,
    start,
    stop,
    cancel,
    retry,
    clearError,
  };
}
