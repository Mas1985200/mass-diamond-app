import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "../lib/supabase";
import {
  ChatClientError,
  streamChatMessage,
  type ChatErrorCode,
} from "../lib/chatClient";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly content: string;
}

export interface ChatFailure {
  readonly code: ChatErrorCode;
  readonly retryable: boolean;
}

export interface ChatLocation {
  readonly lat: number;
  readonly lon: number;
}

export interface SendOptions {
  readonly location?: ChatLocation;
}

export interface UseChatResult {
  readonly messages: readonly ChatMessage[];
  readonly isSending: boolean;
  readonly isStreaming: boolean;
  readonly error: ChatFailure | null;
  readonly canRetry: boolean;
  readonly sendMessage: (
    text: string,
    options?: SendOptions,
  ) => Promise<boolean>;
  readonly retry: () => Promise<void>;
  readonly reset: () => void;
}

const FRAME_MS = 15;
const MAX_CHARS_PER_TICK = 4;
const BACKLOG_DIVISOR = 120;
const MARKER_SOURCE = ":::md-(?:clock|card)~[^\\s]*?:::";

// The conversation is kept in this tab's session storage, so a page reload
// (for example the browser's pull-to-refresh) brings it back instead of
// wiping it. It is cleared on "back", on sign-out and after a while.
const SESSION_STORAGE_KEY = "md-chat-session-v1";
const SESSION_VERSION = 1;
const SESSION_MAX_AGE_MS = 43_200_000;
const SESSION_MAX_CHARS = 600_000;

interface SavedSession {
  readonly v: number;
  readonly userId: string | null;
  readonly conversationId: string | null;
  readonly messages: readonly ChatMessage[];
  readonly savedAt: number;
}

function createId(): string {
  return crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clearSavedSession(): void {
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage can be unavailable; the chat still works without it.
  }
}

function parseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: ChatMessage[] = [];

  for (const raw of value) {
    if (!isRecord(raw)) {
      continue;
    }

    const id = raw.id;
    const role = raw.role;
    const content = raw.content;

    if (
      typeof id === "string" &&
      id.length > 0 &&
      (role === "user" || role === "assistant") &&
      typeof content === "string"
    ) {
      result.push({ id, role, content });
    }
  }

  return result;
}

function loadSavedSession(): SavedSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed) || parsed.v !== SESSION_VERSION) {
      return null;
    }

    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;

    if (Date.now() - savedAt > SESSION_MAX_AGE_MS) {
      clearSavedSession();
      return null;
    }

    const messages = parseMessages(parsed.messages);

    if (messages.length === 0) {
      return null;
    }

    return {
      v: SESSION_VERSION,
      userId: typeof parsed.userId === "string" ? parsed.userId : null,
      conversationId:
        typeof parsed.conversationId === "string"
          ? parsed.conversationId
          : null,
      messages,
      savedAt,
    };
  } catch {
    return null;
  }
}

function saveSession(
  userId: string | null,
  conversationId: string | null,
  messages: readonly ChatMessage[],
): void {
  try {
    let kept = messages;

    const serialize = (list: readonly ChatMessage[]): string =>
      JSON.stringify({
        v: SESSION_VERSION,
        userId,
        conversationId,
        messages: list,
        savedAt: Date.now(),
      });

    let json = serialize(kept);

    // Drop the oldest messages if the conversation grew too large to store.
    while (json.length > SESSION_MAX_CHARS && kept.length > 2) {
      kept = kept.slice(1);
      json = serialize(kept);
    }

    window.sessionStorage.setItem(SESSION_STORAGE_KEY, json);
  } catch {
    // Storage can be full or unavailable; the chat still works without it.
  }
}

function toFailure(caught: unknown): ChatFailure {
  if (caught instanceof ChatClientError) {
    return { code: caught.code, retryable: caught.retryable };
  }

  return { code: "UNKNOWN_ERROR", retryable: true };
}

function avoidSplitSurrogate(text: string, index: number): number {
  if (index <= 0 || index >= text.length) {
    return index;
  }

  const code = text.charCodeAt(index - 1);

  return code >= 0xd800 && code <= 0xdbff ? index + 1 : index;
}

function skipMarker(text: string, index: number): number {
  if (index <= 0 || index >= text.length) {
    return index;
  }

  const pattern = new RegExp(MARKER_SOURCE, "g");

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (start >= index) {
      break;
    }

    if (index < end) {
      return end;
    }
  }

  return index;
}

function withLocationTag(text: string, location: ChatLocation | null): string {
  if (!location) {
    return text;
  }

  return `${text}\n\n:::md-loc~${location.lat.toFixed(4)}~${location.lon.toFixed(4)}:::`;
}

export function useChat(): UseChatResult {
  // Read the saved conversation once, before the first render.
  const restoredRef = useRef<SavedSession | null | undefined>(undefined);

  if (restoredRef.current === undefined) {
    restoredRef.current = loadSavedSession();
  }

  const restored: SavedSession | null = restoredRef.current ?? null;
  const lastRestored = restored
    ? restored.messages[restored.messages.length - 1]
    : undefined;
  const unanswered = lastRestored !== undefined && lastRestored.role === "user";

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    restored ? [...restored.messages] : [],
  );
  const [isSending, setIsSending] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<ChatFailure | null>(() =>
    unanswered ? { code: "NETWORK_ERROR", retryable: true } : null,
  );

  const conversationIdRef = useRef<string | null>(
    restored?.conversationId ?? null,
  );
  const userIdRef = useRef<string | null>(restored?.userId ?? null);
  const sendingRef = useRef(false);
  const failedTextRef = useRef<string | null>(
    unanswered && lastRestored ? lastRestored.content : null,
  );
  const failedLocationRef = useRef<ChatLocation | null>(null);
  const generationRef = useRef(0);

  const abortRef = useRef<AbortController | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const targetRef = useRef("");
  const shownRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const drainWaitersRef = useRef<Array<() => void>>([]);

  const stopLoop = useCallback((): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const resolveDrain = useCallback((): void => {
    const waiters = drainWaitersRef.current;

    drainWaitersRef.current = [];

    for (const waiter of waiters) {
      waiter();
    }
  }, []);

  const resetStreamState = useCallback((): void => {
    stopLoop();
    targetRef.current = "";
    shownRef.current = 0;
    assistantIdRef.current = null;
    lastTickRef.current = 0;
  }, [stopLoop]);

  const startLoop = useCallback((): void => {
    if (rafRef.current !== null) {
      return;
    }

    const step = (now: number): void => {
      rafRef.current = null;

      if (now - lastTickRef.current < FRAME_MS) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      lastTickRef.current = now;

      const target = targetRef.current;
      const shown = shownRef.current;
      const backlog = target.length - shown;

      if (backlog <= 0) {
        resolveDrain();
        return;
      }

      const amount = Math.min(
        MAX_CHARS_PER_TICK,
        Math.max(1, Math.ceil(backlog / BACKLOG_DIVISOR)),
      );

      const afterSurrogate = avoidSplitSurrogate(
        target,
        Math.min(target.length, shown + amount),
      );

      const next = skipMarker(target, afterSurrogate);

      shownRef.current = next;

      const visible = target.slice(0, next);
      const assistantId = assistantIdRef.current;

      if (assistantId !== null) {
        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantId
              ? { ...message, content: visible }
              : message,
          ),
        );
      }

      if (next < target.length) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        resolveDrain();
      }
    };

    rafRef.current = requestAnimationFrame(step);
  }, [resolveDrain]);

  const waitForDrain = useCallback((): Promise<void> => {
    if (shownRef.current >= targetRef.current.length) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      drainWaitersRef.current.push(resolve);
      startLoop();
    });
  }, [startLoop]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopLoop();
    };
  }, [stopLoop]);

  const dispatchMessage = useCallback(
    async (
      text: string,
      appendUserMessage: boolean,
      location: ChatLocation | null,
    ): Promise<boolean> => {
      if (sendingRef.current) {
        return false;
      }

      const generation = generationRef.current;
      const controller = new AbortController();

      sendingRef.current = true;
      abortRef.current = controller;
      failedTextRef.current = null;
      failedLocationRef.current = null;
      resetStreamState();
      setIsSending(true);
      setIsStreaming(false);
      setError(null);

      if (appendUserMessage) {
        setMessages((previous) => [
          ...previous,
          { id: createId(), role: "user", content: text },
        ]);
      }

      try {
        const result = await streamChatMessage({
          message: withLocationTag(text, location),
          conversationId: conversationIdRef.current,
          signal: controller.signal,
          onMeta: (meta) => {
            if (generation !== generationRef.current) {
              return;
            }

            conversationIdRef.current = meta.conversationId;
          },
          onDelta: (delta) => {
            if (generation !== generationRef.current) {
              return;
            }

            targetRef.current += delta;

            if (assistantIdRef.current === null) {
              const assistantId = createId();

              assistantIdRef.current = assistantId;
              shownRef.current = 0;
              setIsStreaming(true);
              setMessages((previous) => [
                ...previous,
                { id: assistantId, role: "assistant", content: "" },
              ]);
            }

            startLoop();
          },
        });

        if (generation !== generationRef.current) {
          return false;
        }

        conversationIdRef.current = result.conversationId;

        await waitForDrain();

        if (generation !== generationRef.current) {
          return false;
        }

        const existingId = assistantIdRef.current;
        const finalContent = result.content;

        if (existingId === null) {
          setMessages((previous) => [
            ...previous,
            { id: createId(), role: "assistant", content: finalContent },
          ]);
        } else {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === existingId
                ? { ...message, content: finalContent }
                : message,
            ),
          );
        }

        return true;
      } catch (caught) {
        if (generation !== generationRef.current) {
          return false;
        }

        stopLoop();

        const partialId = assistantIdRef.current;

        if (partialId !== null) {
          setMessages((previous) =>
            previous.filter((message) => message.id !== partialId),
          );
        }

        if (caught instanceof ChatClientError) {
          if (caught.code === "CONVERSATION_NOT_FOUND") {
            conversationIdRef.current = null;
          } else if (caught.conversationId) {
            conversationIdRef.current = caught.conversationId;
          }
        }

        failedTextRef.current = text;
        failedLocationRef.current = location;
        setError(toFailure(caught));

        return false;
      } finally {
        if (generation === generationRef.current) {
          sendingRef.current = false;
          abortRef.current = null;
          resetStreamState();
          setIsSending(false);
          setIsStreaming(false);
        }
      }
    },
    [resetStreamState, startLoop, stopLoop, waitForDrain],
  );

  const sendMessage = useCallback(
    async (raw: string, options?: SendOptions): Promise<boolean> => {
      const text = raw.trim();

      if (!text) {
        return false;
      }

      return dispatchMessage(text, true, options?.location ?? null);
    },
    [dispatchMessage],
  );

  const retry = useCallback(async (): Promise<void> => {
    const text = failedTextRef.current;

    if (!text) {
      return;
    }

    await dispatchMessage(text, false, failedLocationRef.current);
  }, [dispatchMessage]);

  const reset = useCallback((): void => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    resetStreamState();
    resolveDrain();
    clearSavedSession();
    conversationIdRef.current = null;
    failedTextRef.current = null;
    failedLocationRef.current = null;
    sendingRef.current = false;
    setMessages([]);
    setError(null);
    setIsSending(false);
    setIsStreaming(false);
  }, [resetStreamState, resolveDrain]);

  // Save the conversation whenever it settles. While a reply is being typed
  // out nothing is saved; the finished reply is saved when it completes.
  useEffect(() => {
    if (isStreaming) {
      return;
    }

    if (messages.length === 0) {
      clearSavedSession();
      return;
    }

    saveSession(userIdRef.current, conversationIdRef.current, messages);
  }, [messages, isStreaming]);

  // A saved conversation belongs to the account that wrote it: it is dropped
  // on sign-out and when a different account is signed in.
  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) {
        return;
      }

      const currentUserId = data.session?.user.id ?? null;
      const savedUserId = restoredRef.current?.userId ?? null;

      if (
        savedUserId !== null &&
        currentUserId !== null &&
        savedUserId !== currentUserId
      ) {
        reset();
      }

      if (currentUserId !== null) {
        userIdRef.current = currentUserId;
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_OUT") {
          clearSavedSession();
          userIdRef.current = null;
          return;
        }

        const id = session?.user.id;

        if (id) {
          userIdRef.current = id;
        }
      },
    );

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [reset]);

  return {
    messages,
    isSending,
    isStreaming,
    error,
    canRetry: error !== null && error.retryable,
    sendMessage,
    retry,
    reset,
  };
}
