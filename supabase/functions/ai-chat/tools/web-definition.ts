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
            "Short, specific query with the user's spelling mistakes silently corrected. Write it in the language of the country or place the question is about (Persian for Iran, Spanish for Spain, Chinese for China), and in English when the subject is global; never choose it by the language the user wrote in, so the same question asked in any language sends the same query. For several prices put all items in ONE query.",
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
        country: {
          type: "string",
          description:
            "Optional. The two-letter code (ISO 3166-1, for example IR, US, DE, TR, IN) of the country the question is about, or GLOBAL when it is about no particular country. The app uses it to look first on well known news sites of that country; leave it out when unsure.",
        },
        topic: {
          type: "string",
          enum: ["general", "sports", "economy", "technology", "science", "health", "entertainment"],
          description:
            "Optional. The field of the question: sports, economy, technology, science, health, entertainment, or general for everything else (politics, society, events). Used with country to pick the sites searched first.",
        },
        local_query: {
          type: "string",
          description:
            "Optional. A second wording of the same search, used only when the first finds too little: written in the main language of that country or place when query is not already in it, otherwise in English. Leave it out when unsure; the app then translates the search itself when it needs to.",
        },
        language: {
          type: "string",
          description:
            "Required. The language you will write your answer in (the language of the user's message), as a short language tag (es, ru, de, zh, hi, fr, tr, ar, fa, en ...). The app then writes each result's date in that language.",
        },
      },
      required: ["query", "place_language", "language"],
    },
  },
};
