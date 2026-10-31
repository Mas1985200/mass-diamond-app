// supabase/functions/ai-chat/config.ts
// Shared limits and defaults for the ai-chat function.

export const MAX_MESSAGE_LENGTH = 32_000;
export const MAX_HISTORY_MESSAGES = 40;
export const HISTORY_CHAR_BUDGET = 6_000;
export const HISTORY_MESSAGE_CAP = 1_200;
export const TOOL_RESULT_CHAR_CAP = 6_000;

export const CONNECT_TIMEOUT_MS = 12_000;
export const TOOL_TIMEOUT_MS = 8_000;
export const WIKI_TIMEOUT_MS = 4_000;
export const TOTAL_TIMEOUT_MS = 50_000;

export const MAX_TOOL_ROUNDS = 2;
export const MAX_CARDS = 10;
export const MAX_TOOL_CALLS_PER_ROUND = 8;
// Reasoning models spend part of this budget on thinking before they answer;
// at high effort the thinking can be long, so the room is generous.
export const MAX_OUTPUT_TOKENS = 4_500;
export const TEMPERATURE = 0.4;

// The public Nominatim service allows about one request per second.
export const NOMINATIM_MIN_GAP_MS = 1_100;

export const COOLDOWN_DEFAULT_MS = 20_000;
export const COOLDOWN_MAX_MS = 60_000;
export const MAX_QUEUE_WAIT_MS = 3_000;

export const WEB_CACHE_TTL_MS = 300_000;
export const WEB_CACHE_MAX_ENTRIES = 40;
// The search service is asked for more candidates than the model reads: the
// app keeps the best ones (relevant, fresh) and drops the rest, so a story
// that is not among the first few results is still found. News and other
// fresh data need the widest net, because that is where the newest item is
// often not the first one the service returns.
export const WEB_FETCH_RESULTS = 8;
export const WEB_FETCH_NEWS = 12;
// The most results the model reads.
export const WEB_MAX_RESULTS = 4;
export const WEB_NEWS_RESULTS = 5;
export const WEB_SNIPPET_CHARS = 900;

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export const GROQ_DEFAULT_MODELS: readonly string[] = [
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
];

export const NOMINATIM_USER_AGENT =
  "MassDiamond/1.0 (https://mass-diamond.netlify.app)";
