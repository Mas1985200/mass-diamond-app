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
        local_query: {
          type: "string",
          description:
            "Required. The same search written in the main language of the country or place the question is about, so that pages from that place are found. Examples: a Spanish question about the Iranian economy gets query in Spanish and local_query in Persian; an English question about Turkish politics gets local_query in Turkish; a German question about Japanese cars gets local_query in Japanese. Never copy query when the place's language is another one. Write the same as query only when the place's main language is the language of query, or the question is not about a particular country or place. The app uses it only when the first search finds too little, so it never costs anything when the first search is enough.",
        },
        language: {
          type: "string",
          description:
            "The language you will write your answer in, as a short language tag (es, ru, de, zh, hi, fr, tr, ar, fa, en ...). The app then writes each result's date in that language.",
        },
      },
      required: ["query", "local_query"],
    },
  },
};
