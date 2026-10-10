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
      "Look up a place on the map. Use it ONLY when the user names a specific place or address to locate, or asks for nearby places of a category (near-me). Never use it for questions about the conversation itself, such as 'where were we' or 'کجا بودیم' (these mean 'what were we talking about'); answer those from the conversation history instead. The app shows the map card first. If the user asks about SEVERAL places in one message (for example one per line, or joined with 'و' or commas), make exactly ONE call with intent specific_place and put every place in the places list, in the order asked (up to 8). Never look up only the first place and never promise to look at the others later. Write no text before the call; the app writes every answer itself. For a specific place, first use your own knowledge to work out exactly which place the user means, then fill in country_code, local_name, display_name, region and approx_lat/approx_lon whenever you are sure of them; the app uses them to find and verify the right place on the map and to write the card in the user's language.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "ONE place only. specific_place: the full, well-known name of the place in English (or its best-known international spelling) together with its type and its city or country, with any spelling mistakes of the user corrected, for example 'Lake Chitgar, Tehran, Iran' instead of just 'Chitgar'. If the user gives only a short or ambiguous name and no region, choose the most famous place in the world that has that name. Never add details you are unsure of. nearby_search: English category word (pharmacy, restaurant).",
        },
        intent: {
          type: "string",
          enum: ["specific_place", "nearby_search"],
          description:
            "specific_place for one or several named places or addresses; nearby_search for near-me category questions.",
        },
        country_code: {
          type: "string",
          description:
            "ONE specific place only. Two-letter ISO 3166-1 code of the country where the place is, in lowercase (for example ir, kz, cn, ae). Give it only when you are sure.",
        },
        local_name: {
          type: "string",
          description:
            "ONE specific place only. The place's official name in the local language and script of its country (for example Chinese characters for a place in China, Cyrillic for Kazakhstan). Give it only when it differs from the English name and you are sure of it.",
        },
        display_name: {
          type: "string",
          description:
            "ONE specific place only. The place's name exactly as it should be shown to the user, written in the user's language (for example the Persian name when the user writes Persian). Give it whenever you are sure of it.",
        },
        region: {
          type: "string",
          description:
            "ONE specific place only. Where the place is: city, province or state, and country, written in the user's language (for example 'Isfahan, Iran' in the user's own language). Give it whenever you are sure of it.",
        },
        approx_lat: {
          type: "number",
          description:
            "ONE specific place only. Approximate latitude of the place in decimal degrees, from your own knowledge. Give it only for well-known places when you are fairly sure it is within about 20 km. Never guess.",
        },
        approx_lon: {
          type: "number",
          description:
            "ONE specific place only. Approximate longitude of the place in decimal degrees, from your own knowledge. Give it only together with approx_lat and under the same condition.",
        },
        places: {
          type: "array",
          description:
            "SEVERAL specific places in one message: every place the user asked about, in the order asked, up to 8. Each item has the same fields as a single place. When this list is given, the single-place fields above are not used.",
          items: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  "The full, well-known name of this place in English (or its best-known international spelling) together with its type and its city or country, with spelling mistakes corrected.",
              },
              country_code: {
                type: "string",
                description:
                  "Two-letter ISO 3166-1 code of the country where this place is, in lowercase. Give it only when you are sure.",
              },
              local_name: {
                type: "string",
                description:
                  "This place's official name in the local language and script of its country. Give it only when it differs from the English name and you are sure of it.",
              },
              display_name: {
                type: "string",
                description:
                  "This place's name exactly as it should be shown to the user, written in the user's language. Give it whenever you are sure of it.",
              },
              region: {
                type: "string",
                description:
                  "Where this place is: city, province or state, and country, written in the user's language. Give it whenever you are sure of it.",
              },
              approx_lat: {
                type: "number",
                description:
                  "Approximate latitude of this place in decimal degrees, from your own knowledge, only when you are fairly sure it is within about 20 km. Never guess.",
              },
              approx_lon: {
                type: "number",
                description:
                  "Approximate longitude of this place in decimal degrees, only together with approx_lat and under the same condition.",
              },
            },
            required: ["query"],
          },
        },
      },
      required: ["intent"],
    },
  },
};

export const MARKET_PRICES_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_market_prices",
    description:
      "Live market prices from a structured feed: currencies (dollar, euro, pound, Tether, yuan and any other currency by its 3-letter code), gold, gold coins, silver, and a few global prices (gold ounce, Brent oil, base metals, Bitcoin, Ethereum). ALWAYS use this FIRST for any price or exchange-rate question, for example dollar, euro, gold, coin, Tether or Bitcoin price. Iranian prices are already in toman: report the returned number exactly as it is, never multiply or divide it and never convert it to rial. Global items are in US dollars. Put every asked item in ONE call. Use web_search with fresh=true only when this tool returns an error or lists an item under not_found or unavailable.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "string" },
          description:
            "Up to 8 item keys. Allowed keys: usd, eur, gbp, usdt, usd_center, eur_center, cny_center, gold18, gold24, mesghal, coin_emami, coin_bahar, coin_half, coin_quarter, coin_gram, silver_gram, gold_ounce, silver_ounce, brent, copper, aluminium, zinc, nickel, lead, tin, btc, eth. Any other currency can be asked by its 3-letter ISO code in lowercase, for example kwd, cny, jpy, try. Use usd for the plain 'dollar' price. Use gold18 for the plain 'gold' price.",
        },
      },
      required: ["items"],
    },
  },
};

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
  const tools: ToolDefinition[] = [
    GET_DATETIME_TOOL,
    FIND_PLACE_TOOL,
    MARKET_PRICES_TOOL,
  ];

  if (ctx.tavilyKey) {
    tools.push(WEB_SEARCH_TOOL);
  }

  if (ctx.memory) {
    tools.push(REMEMBER_TOOL);
  }

  return tools;
}
