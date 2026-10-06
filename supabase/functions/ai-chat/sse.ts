// supabase/functions/ai-chat/sse.ts
// Streams the model answer to the client as Server-Sent Events and saves the
// exchange only after a successful, non-empty answer.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { describeError } from "./lib/util.ts";
import { sseHeaders } from "./lib/http.ts";
import { saveExchange, touchConversation } from "./history/store.ts";

export type SseInput = {
  readonly chunks: AsyncGenerator<string, void, void>;
  readonly provider: string;
  readonly model: string;
  readonly requestId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly userMessage: string;
  readonly adminClient: SupabaseClient;
  readonly master: AbortController;
  readonly totalTimer: number;
};

export function createSseResponse(input: SseInput): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // The client disconnected; nothing more to send.
        }
      };

      const sendError = (message: string): void => {
        send("error", {
          error: {
            code: "AI_PROVIDER_ERROR",
            message: message.slice(0, 300),
            retryable: true,
          },
          requestId: input.requestId,
          conversationId: input.conversationId,
        });
      };

      send("meta", {
        requestId: input.requestId,
        conversationId: input.conversationId,
        provider: input.provider,
        model: input.model,
      });

      let content = "";

      try {
        for await (const chunk of input.chunks) {
          content += chunk;
          send("delta", { text: chunk });
        }

        const finalContent = content.trim();

        if (!finalContent) {
          console.error(
            `request ${input.requestId}: the AI provider returned an empty response.`,
          );

          sendError("The AI provider returned an empty response.");

          return;
        }

        try {
          await saveExchange(
            input.adminClient,
            input.userId,
            input.conversationId,
            input.userMessage,
            finalContent,
          );

          await touchConversation(
            input.adminClient,
            input.userId,
            input.conversationId,
          );
        } catch (saveError) {
          console.error(
            `request ${input.requestId}: failed to save the exchange: ${describeError(saveError)}`,
          );
        }

        send("done", {
          requestId: input.requestId,
          conversationId: input.conversationId,
          provider: input.provider,
          model: input.model,
          content: finalContent,
        });
      } catch (error) {
        console.error(
          `request ${input.requestId}: stream failed: ${describeError(error).slice(0, 300)}`,
        );

        sendError(describeError(error));
      } finally {
        clearTimeout(input.totalTimer);

        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      clearTimeout(input.totalTimer);
      input.master.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: sseHeaders,
  });
}
