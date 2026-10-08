// supabase/functions/ai-chat/tools/registry.ts
// Dispatches a tool call from the model to its implementation.

import type { ToolContext, ToolOutcome } from "../types.ts";
import { describeError, isRecord } from "../lib/util.ts";
import { runGetDatetime } from "./datetime.ts";
import { runFindPlace } from "./places.ts";
import { runWebSearch } from "./web.ts";
import { runRemember } from "./remember.ts";
import { runMarketPrices } from "./prices.ts";

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function executeTool(
  name: string,
  rawArguments: string,
  ctx: ToolContext,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const args = parseToolArguments(rawArguments);

  try {
    switch (name) {
      case "get_datetime":
        return runGetDatetime(args, ctx);
      case "find_place":
        return await runFindPlace(args, ctx, signal);
      case "web_search":
        return await runWebSearch(args, ctx, signal);
      case "get_market_prices":
        return await runMarketPrices(args, ctx, signal);
      case "remember":
        return await runRemember(args, ctx);
      default:
        return { data: { error: `Unknown tool: ${name}` } };
    }
  } catch (error) {
    console.error(`tool ${name} threw: ${describeError(error)}`);

    return { data: { error: describeError(error) } };
  }
}
