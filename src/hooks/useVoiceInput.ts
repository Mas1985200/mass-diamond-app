// src/hooks/useVoiceInput.ts
// Voice input: records a short message with the microphone, sends it to the
// `transcribe` Edge Function and hands the text to the caller. It works in
// every browser that can record (it does not depend on the browser's own
// speech recognition, which needs foreign servers).

import { useCallback, useEffect, useRef, useState } from "react";

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
  // Called once with the recognized text.
  readonly onText: (text: string) => void;
}

export interface VoiceInput {
  readonly supported: boolean;
  readonly state: VoiceState;
  readonly error: VoiceErrorCode | null;
  readonly seconds: number;
  readonly start: () => Promise<void>;
  readonly stop: () => void;
  readonly cancel: () => void;
  readonly clearError: () => void;
}

const MAX_RECORD_SECONDS = 60;
const MIN_AUDIO_BYTES = 800;
// Speech recognition downsamples to 16 kHz mono, so a clean mono recording at
// a generous bitrate gives it the most to work with (60 s stays below 0.5 MB).
const AUDIO_BITS_PER_SECOND = 64_000;
// A normal answer takes a few seconds. A request that is stuck (weak or
// interrupted connection) is given up quickly and tried once more with the
// same recording, so the user never waits half a minute for nothing.
const ATTEMPT_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 2;
const RETRY_PAUSE_MS = 500;

// The phone's automatic gain and echo canceller are made for calls: they pump
// the volume and distort loud speech, which makes recognition worse. They are
// switched off; noise suppression stays on for noisy places.
const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: true,
  autoGainControl: false,
  channelCount: { ideal: 1 },
};

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
  language: string,
  controllerRef: { current: AbortController | null },
): Promise<Attempt> {
  const form = new FormData();

  form.append("audio", blob, "recording");

  if (language) {
    form.append("language", language);
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
  const onTextRef = useRef(options.onText);
  const languageRef = useRef(options.language);

  useEffect(() => {
    onTextRef.current = options.onText;
    languageRef.current = options.language;
  });

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
    async (session: number, blob: Blob): Promise<void> => {
      const url = transcribeUrl();
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
        | string
        | undefined;

      let code: VoiceErrorCode | null = null;
      let text = "";

      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (!token) {
          code = "auth";
        } else if (!url || !anonKey) {
          code = "failed";
        } else {
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            const result = await sendOnce(
              url,
              anonKey,
              token,
              blob,
              languageRef.current,
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

            if (!retryable || attempt === MAX_ATTEMPTS) {
              break;
            }

            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, RETRY_PAUSE_MS);
            });

            if (session !== sessionRef.current) {
              return;
            }
          }
        }
      } catch {
        code = "network";
      }

      if (session !== sessionRef.current) {
        return;
      }

      abortRef.current = null;
      busyRef.current = false;
      setState("idle");
      setSeconds(0);

      if (code) {
        setError(code);
        return;
      }

      if (!text) {
        setError("no_speech");
        return;
      }

      onTextRef.current(text);
    },
    [],
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
      void transcribe(session, blob);
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

    const session = sessionRef.current + 1;

    sessionRef.current = session;

    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: MIC_CONSTRAINTS,
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
  }, [finish, release]);

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
    busyRef.current = false;
    setState("idle");
    setSeconds(0);
  }, [release]);

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
    };
  }, [release]);

  return {
    supported: isVoiceSupported(),
    state,
    error,
    seconds,
    start,
    stop,
    cancel,
    clearError,
  };
}
