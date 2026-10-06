// supabase/functions/ai-chat/index.ts
// Entry point: auth, conversation setup, agent run, response.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TOTAL_TIMEOUT_MS } from "./config.ts";
import type { AIMessage, ToolContext } from "./types.ts";
import { describeError, getRequiredEnv, getTavilyKey } from "./lib/util.ts";
import { baseHeaders, jsonResponse } from "./lib/http.ts";
import { resolveTimeZone } from "./lib/time.ts";
import {
  AUTH_INVALID_MESSAGE,
  AUTH_REQUIRED_MESSAGE,
  UUID_PATTERN,
  authenticateUser,
  extractLocationTag,
  parseRequestBody,
  validateMessage,
} from "./request.ts";
import {
  conversationExists,
  createConversation,
  loadHistory,
  saveExchange,
  touchConversation,
} from "./history/store.ts";
import { trimHistory } from "./history/trim.ts";
import { buildSystemPrompt } from "./prompt/system.ts";
import { startAgent } from "./agent.ts";
import { createSseResponse } from "./sse.ts";

async function collectChunks(
  chunks: AsyncGenerator<string, void, void>,
): Promise<string> {
  let content = "";

  for await (const chunk of chunks) {
    content += chunk;
  }

  return content;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const requestId = crypto.randomUUID();

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: baseHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse(
      {
        success: false,
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Only POST requests are allowed.",
          retryable: false,
        },
        requestId,
      },
      405,
    );
  }

  try {
    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const supabaseAnonKey = getRequiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

    const user = await authenticateUser(request, supabaseUrl, supabaseAnonKey);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const rawBody: unknown = await request.json();
    const body = parseRequestBody(rawBody);
    const extracted = extractLocationTag(body.message ?? "");
    const message = validateMessage(extracted.text);
    const location = body.location ?? extracted.location;

    let conversationId = body.conversationId;

    if (conversationId) {
      const exists =
        UUID_PATTERN.test(conversationId) &&
        (await conversationExists(adminClient, user.id, conversationId));

      if (!exists) {
        return jsonResponse(
          {
            success: false,
            error: {
              code: "CONVERSATION_NOT_FOUND",
              message:
                "The requested conversation does not exist or does not belong to the current user.",
              retryable: false,
            },
            requestId,
          },
          404,
        );
      }
    } else {
      conversationId = await createConversation(adminClient, user.id);
    }

    const history = trimHistory(
      await loadHistory(adminClient, user.id, conversationId),
    );

    const ctx: ToolContext = {
      now: new Date(),
      timeZone: resolveTimeZone(body.timeZone),
      location,
      lang: /[\u0600-\u06FF]/.test(message) ? "fa" : "en",
      tavilyKey: getTavilyKey(),
    };

    console.log(
      `request ${requestId}: web_search=${ctx.tavilyKey ? "on" : "off"}, location=${ctx.location ? "yes" : "no"}, history=${history.length}`,
    );

    const aiMessages: AIMessage[] = [
      { role: "system", content: buildSystemPrompt(ctx) },
      ...history,
      { role: "user", content: message },
    ];

    const master = new AbortController();
    const totalTimer = setTimeout(() => master.abort(), TOTAL_TIMEOUT_MS);

    let started: Awaited<ReturnType<typeof startAgent>>;

    try {
      started = await startAgent(aiMessages, ctx, master.signal);
    } catch (error) {
      clearTimeout(totalTimer);
      throw error;
    }

    if (!started.success) {
      clearTimeout(totalTimer);

      console.error(
        `request ${requestId}: AI start failed: ${started.error.slice(0, 300)}`,
      );

      return jsonResponse(
        {
          success: false,
          error: {
            code: "AI_PROVIDER_ERROR",
            message: started.error.slice(0, 300),
            retryable: started.retryable,
          },
          requestId,
          conversationId,
        },
        502,
      );
    }

    if (body.stream) {
      return createSseResponse({
        chunks: started.chunks,
        provider: started.provider,
        model: started.model,
        requestId,
        conversationId,
        userId: user.id,
        userMessage: message,
        adminClient,
        master,
        totalTimer,
      });
    }

    let content: string;

    try {
      content = (await collectChunks(started.chunks)).trim();
    } catch (error) {
      console.error(
        `request ${requestId}: generation failed: ${describeError(error).slice(0, 300)}`,
      );

      return jsonResponse(
        {
          success: false,
          error: {
            code: "AI_PROVIDER_ERROR",
            message: describeError(error).slice(0, 300),
            retryable: true,
          },
          requestId,
          conversationId,
        },
        502,
      );
    } finally {
      clearTimeout(totalTimer);
    }

    if (!content) {
      return jsonResponse(
        {
          success: false,
          error: {
            code: "AI_PROVIDER_ERROR",
            message: "The AI provider returned an empty response.",
            retryable: true,
          },
          requestId,
          conversationId,
        },
        502,
      );
    }

    try {
      await saveExchange(adminClient, user.id, conversationId, message, content);
      await touchConversation(adminClient, user.id, conversationId);
    } catch (saveError) {
      console.error(
        `request ${requestId}: failed to save the exchange: ${describeError(saveError)}`,
      );
    }

    return jsonResponse({
      success: true,
      requestId,
      conversationId,
      message: { role: "assistant", content },
      provider: started.provider,
      model: started.model,
    });
  } catch (error) {
    const message = describeError(error);

    const isAuthError =
      message === AUTH_REQUIRED_MESSAGE || message === AUTH_INVALID_MESSAGE;

    console.error(`request ${requestId}: failed: ${message.slice(0, 300)}`);

    return jsonResponse(
      {
        success: false,
        error: {
          code: isAuthError ? "AUTH_REQUIRED" : "INTERNAL_ERROR",
          message,
          retryable: !isAuthError,
        },
        requestId,
      },
      isAuthError ? 401 : 500,
    );
  }
});
