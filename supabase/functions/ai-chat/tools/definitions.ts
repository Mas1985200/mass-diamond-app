// supabase/functions/ai-chat/tools/definitions.ts
// Tool schemas sent to the model.

import type { ToolContext, ToolDefinition } from "../types.ts";

export const GET_DATETIME_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_datetime",
    description:
      "Exact current date, weekday and time for the user's place or any other place. Always use it for date, weekday, time or time-in-another-place questions; never use web_search for them.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description:
            'IANA id of the asked place (e.g. Asia/Tokyo). If any city, country or region is named you MUST pass its id. Pass "local" only when no other place is mentioned.',
        },
        place_label: {
          type: "string",
          description:
            "Place as 'City, Country' in the user's language. Required when timezone is not \"local\".",
        },
        show_clock: {
          type: "boolean",
          description:
            "true for time-of-day questions (shows a clock card); false for date or weekday only.",
        },
      },
      required: ["timezone", "show_clock"],
    },
  },
};

export const FIND_PLACE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "find_place",
    description:
      "Look up a place on the map. Use it ONLY when the user names a specific place or address to locate, or asks for nearby places of a category (near-me). Never use it for questions about the conversation itself, such as 'where were we' or 'کجا بودیم' (these mean 'what were we talking about'); answer those from the conversation history instead. The app shows the map card first.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "specific_place: full name plus city, region or country, with any spelling mistakes of the user corrected. nearby_search: English category word (pharmacy, restaurant).",
        },
        intent: {
          type: "string",
          enum: ["specific_place", "nearby_search"],
          description:
            "specific_place for one named place or address; nearby_search for near-me category questions.",
        },
      },
      required: ["query", "intent"],
    },
  },
};

export const WEB_SEARCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current information: news, prices, exchange rates, weather, sports. Never use it for the date, the time or where a place is.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Short, specific query with the user's spelling mistakes silently corrected. For several prices put all items in ONE query.",
        },
        fresh: {
          type: "boolean",
          description:
            "Set true when the answer must reflect today's or this week's data: prices, exchange rates, gold and coin rates, weather, live scores, breaking news. Old pages are then excluded so outdated numbers are never used. Set false for general knowledge or background questions.",
        },
      },
      required: ["query"],
    },
  },
};

export const REMEMBER_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "remember",
    description:
      "Save ONE short, durable fact about the user for future conversations: their name, what they like to be called, long-term interests, ongoing projects or goals, language or style preferences. Use it when the user shares such a fact about themselves or asks you to remember something. Never save sensitive data: health, money, passwords, ID, card or phone numbers, exact home address, religion, politics, sexuality, or anything about other people. Never save temporary or trivial details.",
    parameters: {
      type: "object",
      properties: {
        fact: {
          type: "string",
          description:
            "One short sentence in the user's language, for example 'اسم کاربر مسعود است' or 'User is building a travel app'.",
        },
      },
      required: ["fact"],
    },
  },
};

export function buildToolDefinitions(ctx: ToolContext): ToolDefinition[] {
  const tools: ToolDefinition[] = [GET_DATETIME_TOOL, FIND_PLACE_TOOL];

  if (ctx.tavilyKey) {
    tools.push(WEB_SEARCH_TOOL);
  }

  if (ctx.memory) {
    tools.push(REMEMBER_TOOL);
  }

  return tools;
}
