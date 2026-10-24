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
const REQUEST_TIMEOUT_MS = 35_000;
const AUDIO_BITS_PER_SECOND = 32_000;

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

type Reply =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: VoiceErrorCode };

function readReply(payload: unknown): Reply {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, code: "failed" };
  }

  const record = payload as {
    success?: unknown;
    text?: unknown;
    error?: unknown;
  };

  if (record.success === true && typeof record.text === "string") {
    return { ok: true, text: record.text.trim() };
  }

  const serverCode =
    typeof record.error === "object" &&
    record.error !== null &&
    typeof (record.error as { code?: unknown }).code === "string"
      ? (record.error as { code: string }).code
      : "";

  if (serverCode === "RATE_LIMITED") {
    return { ok: false, code: "rate_limited" };
  }

  if (serverCode === "AUTH_REQUIRED") {
    return { ok: false, code: "auth" };
  }

  if (serverCode === "AUDIO_TOO_SHORT") {
    return { ok: false, code: "no_speech" };
  }

  return { ok: false, code: "failed" };
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
          const form = new FormData();

          form.append("audio", blob, "recording");

          if (languageRef.current) {
            form.append("language", languageRef.current);
          }

          const controller = new AbortController();
          const timer = window.setTimeout(
            () => controller.abort(),
            REQUEST_TIMEOUT_MS,
          );

          abortRef.current = controller;

          try {
            const response = await fetch(url, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
              body: form,
              signal: controller.signal,
            });

            const reply = readReply(
              await response.json().catch(() => null),
            );

            if (reply.ok) {
              text = reply.text;
            } else {
              code = reply.code;
            }
          } finally {
            window.clearTimeout(timer);
          }
        }
      } catch {
        code = "network";
      }

      // Cancelled or replaced while waiting: nothing to show.
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
