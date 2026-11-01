// supabase/functions/ai-chat/tools/web-definition.ts
// The web_search tool schema sent to the model (see tools/web.ts for the code
// that runs it).

import type { ToolDefinition } from "../types.ts";

export const WEB_SEARCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current information: news, weather, sports, and prices that get_market_prices does not cover. Never use it for the date, the time or where a place is. Never use it for dollar, euro, gold, coin, Tether or Bitcoin prices unless get_market_prices failed.",
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
        news: {
          type: "boolean",
          description:
            "Set true for news and current events (what happened, headlines, breaking stories). Then only news articles with their publication dates are searched, not website home pages or menus.",
        },
        place_language: {
          type: "string",
          description:
            "Required. The short language tag of the main language of the country or place the question is about, for example fa for Iran, tr for Turkey, ja for Japan, es for Mexico. When the question is not about a particular country or place, give the language you answer in. The app uses it, only when the first search finds too little, to search once more in that language, so it never costs anything when the first search is enough.",
        },
        local_query: {
          type: "string",
          description:
            "Optional. The same search already written in the main language of that country or place, when you can write it well (for example a Spanish question about the Iranian economy gets query in Spanish and local_query in Persian). Leave it out when place_language is the language of query; the app then translates the search itself when it needs to.",
        },
        language: {
          type: "string",
          description:
            "The language you will write your answer in, as a short language tag (es, ru, de, zh, hi, fr, tr, ar, fa, en ...). The app then writes each result's date in that language.",
        },
      },
      required: ["query", "place_language"],
    },
  },
};
