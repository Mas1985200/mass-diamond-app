// supabase/functions/ai-chat/index.ts
// Entry point: auth, conversation setup, memory, agent run, response.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TOTAL_TIMEOUT_MS } from "./config.ts";
import type { AIMessage, ToolContext } from "./types.ts";
import {
  describeError,
  getRequiredEnv,
  getTavilyKey,
  sleep,
} from "./lib/util.ts";
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
import { buildSystemPrompt, type MemoryContext } from "./prompt/system.ts";
import { addFact, loadFacts, loadRecentSummaries } from "./memory/store.ts";
import { summarizePreviousConversation } from "./memory/summary.ts";
import { startAgent } from "./agent.ts";
import { createSseResponse } from "./sse.ts";

const RECALL_PATTERN =
  /(کجا\s*بودیم|ادامه\s*بده|ادامه\s*اش|ادامه‌اش|یادته|یادت\s*هست|قبلا|قبلاً|دفعه\s*قبل|دفعه‌ی\s*قبل|where\s+were\s+we|pick\s+up\s+where|continue\s+where|last\s+time|remember\s+when)/i;
const RECALL_MAX_LENGTH = 300;

const BACKGROUND_DELAY_MS = 8_000;
const SUMMARY_TIMEOUT_MS = 20_000;

async function collectChunks(
  chunks: AsyncGenerator<string, void, void>,
): Promise<string> {
  let content = "";

  for await (const chunk of chunks) {
    content += chunk;
  }

  return content;
}

// Keeps a task alive after the response is sent when the runtime supports it.
function runInBackground(task: Promise<unknown>): void {
  const runtime = (
    globalThis as {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
    }
  ).EdgeRuntime;

  if (runtime?.waitUntil) {
    runtime.waitUntil(task);
  }
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
    const isNewConversation = !conversationId;

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

    const wantsRecall =
      message.length <= RECALL_MAX_LENGTH && RECALL_PATTERN.test(message);

    // A recall question in a brand new chat needs the previous chat's summary
    // right now, so it is created before the answer.
    if (isNewConversation && wantsRecall) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);

      try {
        await summarizePreviousConversation(
          adminClient,
          user.id,
          conversationId,
          controller.signal,
        );
      } finally {
        clearTimeout(timer);
      }
    }

    const [storedHistory, facts, summaries] = await Promise.all([
      loadHistory(adminClient, user.id, conversationId),
      loadFacts(adminClient, user.id),
      wantsRecall
        ? loadRecentSummaries(adminClient, user.id, conversationId)
        : Promise.resolve<string[]>([]),
    ]);

    const history = trimHistory(storedHistory);
    const memory: MemoryContext = { facts, summaries };
    const activeUserId = user.id;

    const ctx: ToolContext = {
      now: new Date(),
      timeZone: resolveTimeZone(body.timeZone),
      location,
      lang: /[\u0600-\u06FF]/.test(message) ? "fa" : "en",
      tavilyKey: getTavilyKey(),
      memory: {
        remember: (text: string) => addFact(adminClient, activeUserId, text),
      },
    };

    console.log(
      `request ${requestId}: web_search=${ctx.tavilyKey ? "on" : "off"}, location=${ctx.location ? "yes" : "no"}, history=${history.length}, facts=${facts.length}, summaries=${summaries.length}`,
    );

    // In a new chat the previous chat is summarized shortly after the answer
    // starts, so the next new chat can recall it.
    if (isNewConversation && !wantsRecall) {
      const currentId = conversationId;

      runInBackground(
        (async () => {
          await sleep(BACKGROUND_DELAY_MS);

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);

          try {
            await summarizePreviousConversation(
              adminClient,
              activeUserId,
              currentId,
              controller.signal,
            );
          } finally {
            clearTimeout(timer);
          }
        })(),
      );
    }

    const aiMessages: AIMessage[] = [
      { role: "system", content: buildSystemPrompt(ctx, memory) },
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
