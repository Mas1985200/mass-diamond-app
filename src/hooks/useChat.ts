import { useCallback, useRef, useState } from "react";

import {
  ChatClientError,
  sendChatMessage,
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

export interface UseChatResult {
  readonly messages: readonly ChatMessage[];
  readonly isSending: boolean;
  readonly error: ChatFailure | null;
  readonly canRetry: boolean;
  readonly sendMessage: (text: string) => Promise<boolean>;
  readonly retry: () => Promise<void>;
  readonly reset: () => void;
}

function createId(): string {
  return crypto.randomUUID();
}

function toFailure(caught: unknown): ChatFailure {
  if (caught instanceof ChatClientError) {
    return { code: caught.code, retryable: caught.retryable };
  }

  return { code: "UNKNOWN_ERROR", retryable: true };
}

export function useChat(): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<ChatFailure | null>(null);

  const conversationIdRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const failedTextRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const dispatchMessage = useCallback(
    async (text: string, appendUserMessage: boolean): Promise<boolean> => {
      if (sendingRef.current) {
        return false;
      }

      const generation = generationRef.current;

      sendingRef.current = true;
      failedTextRef.current = null;
      setIsSending(true);
      setError(null);

      if (appendUserMessage) {
        setMessages((previous) => [
          ...previous,
          { id: createId(), role: "user", content: text },
        ]);
      }

      try {
        const result = await sendChatMessage({
          message: text,
          conversationId: conversationIdRef.current,
        });

        if (generation !== generationRef.current) {
          return false;
        }

        conversationIdRef.current = result.conversationId;

        setMessages((previous) => [
          ...previous,
          { id: createId(), role: "assistant", content: result.content },
        ]);

        return true;
      } catch (caught) {
        if (generation !== generationRef.current) {
          return false;
        }

        if (caught instanceof ChatClientError) {
          if (caught.code === "CONVERSATION_NOT_FOUND") {
            conversationIdRef.current = null;
          } else if (caught.conversationId) {
            conversationIdRef.current = caught.conversationId;
          }
        }

        failedTextRef.current = text;
        setError(toFailure(caught));

        return false;
      } finally {
        if (generation === generationRef.current) {
          sendingRef.current = false;
          setIsSending(false);
        }
      }
    },
    [],
  );

  const sendMessage = useCallback(
    async (raw: string): Promise<boolean> => {
      const text = raw.trim();

      if (!text) {
        return false;
      }

      return dispatchMessage(text, true);
    },
    [dispatchMessage],
  );

  const retry = useCallback(async (): Promise<void> => {
    const text = failedTextRef.current;

    if (!text) {
      return;
    }

    await dispatchMessage(text, false);
  }, [dispatchMessage]);

  const reset = useCallback((): void => {
    generationRef.current += 1;
    conversationIdRef.current = null;
    failedTextRef.current = null;
    sendingRef.current = false;
    setMessages([]);
    setError(null);
    setIsSending(false);
  }, []);

  return {
    messages,
    isSending,
    error,
    canRetry: error !== null && error.retryable,
    sendMessage,
    retry,
    reset,
  };
}
