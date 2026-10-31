// tests/web/search.test.ts
// Behavior tests for supabase/functions/ai-chat/tools/web.ts.
// The network is replaced by a fake fetch, so nothing real is called.
// Runner: node:test (built in). No dependencies.

import test from "node:test";
import assert from "node:assert/strict";

import {
  TOOL_RESULT_CHAR_CAP,
  WEB_FETCH_NEWS,
  WEB_FETCH_RESULTS,
  WEB_MAX_RESULTS,
  WEB_NEWS_RESULTS,
  WEB_SNIPPET_CHARS,
} from "../../supabase/functions/ai-chat/config.ts";
import {
  runWebSearch,
  tavilySearch,
} from "../../supabase/functions/ai-chat/tools/web.ts";
import type { ToolContext } from "../../supabase/functions/ai-chat/types.ts";

type FakeCall = { readonly url: string; readonly init: RequestInit };

// Replaces fetch for one test and returns what was asked plus a restore().
function fakeFetch(respond: (call: FakeCall) => Response | Promise<Response>): {
  readonly calls: FakeCall[];
  readonly restore: () => void;
} {
  const original = globalThis.fetch;
  const calls: FakeCall[] = [];

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };

    calls.push(call);

    return await respond(call);
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const signal = new AbortController().signal;

const context: ToolContext = {
  now: new Date("2026-10-14T10:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "en",
  tavilyKey: "test-key",
};

test("tavilySearch: keeps the address, the host and the published date", async () => {
  const fake = fakeFetch(() =>
    jsonResponse({
      results: [
        {
          title: "First story",
          url: "https://www.news-a.com/world/1?x=1",
          content: "Body A",
          published_date: "Wed, 14 Oct 2026 08:00:00 GMT",
        },
        { title: "Second story", url: "http://news-b.org/2", content: "Body B" },
      ],
    }),
  );

  try {
    const results = await tavilySearch("q keeps-fields", "key", 4, signal);

    assert.ok(results);
    assert.equal(results.length, 2);
    assert.deepEqual(results[0], {
      title: "First story",
      source: "news-a.com",
      url: "https://www.news-a.com/world/1?x=1",
      published: "Wed, 14 Oct 2026 08:00:00 GMT",
      snippet: "Body A",
    });
    assert.equal(results[1]?.published, "");
    assert.equal(results[1]?.url, "http://news-b.org/2");
  } finally {
    fake.restore();
  }
});

test("tavilySearch: unsafe, malformed or untitled results are dropped", async () => {
  const fake = fakeFetch(() =>
    jsonResponse({
      results: [
        { title: "Bad scheme", url: "javascript:alert(1)", content: "x" },
        { title: "Bad scheme 2", url: "ftp://example.com/a", content: "x" },
        { title: "No url", content: "x" },
        { title: "", url: "https://example.com/untitled", content: "x" },
        "not an object",
        { title: "Good", url: "https://good.example/ok", content: "x" },
      ],
    }),
  );

  try {
    const results = await tavilySearch("q drops-bad", "key", 4, signal);

    assert.ok(results);
    assert.deepEqual(
      results.map((result) => result.url),
      ["https://good.example/ok"],
    );
  } finally {
    fake.restore();
  }
});

test("tavilySearch: the request keeps its current shape", async () => {
  const fake = fakeFetch(() => jsonResponse({ results: [] }));

  try {
    await tavilySearch("q request-shape", "secret-key", 4, signal, true);

    const call = fake.calls[0];

    assert.ok(call);
    assert.equal(call.url, "https://api.tavily.com/search");

    const headers = call.init.headers as Record<string, string>;

    assert.equal(headers.Authorization, "Bearer secret-key");

    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;

    assert.deepEqual(body, {
      query: "q request-shape",
      max_results: 4,
      search_depth: "basic",
      include_answer: false,
      time_range: "week",
    });
  } finally {
    fake.restore();
  }
});

test("tavilySearch: a failed status or a thrown error gives null", async () => {
  const failing = fakeFetch(() => jsonResponse({ error: "no" }, 500));

  try {
    assert.equal(await tavilySearch("q status-500", "key", 4, signal), null);
  } finally {
    failing.restore();
  }

  const throwing = fakeFetch(() => {
    throw new Error("network down");
  });

  try {
    assert.equal(await tavilySearch("q throws", "key", 4, signal), null);
  } finally {
    throwing.restore();
  }
});

test("tavilySearch: an unexpected body shape gives an empty list", async () => {
  const fake = fakeFetch(() => jsonResponse({ unexpected: true }));

  try {
    assert.deepEqual(await tavilySearch("q odd-shape", "key", 4, signal), []);
  } finally {
    fake.restore();
  }
});

test("runWebSearch: the model gets text, date, age and no address or site name", async () => {
  const fake = fakeFetch(() =>
    jsonResponse({
      results: [
        {
          title: "Story",
          url: "https://www.news-a.com/world/1",
          content: "Body",
          published_date: "2026-10-14",
        },
        { title: "Other", url: "https://news-b.org/2", content: "Body 2" },
      ],
    }),
  );

  try {
    const outcome = await runWebSearch(
      { query: "q run-ok" },
      context,
      signal,
    );

    assert.deepEqual(outcome.data, {
      as_of: "2026-10-14",
      results: [
        {
          title: "Story",
          snippet: "Body",
          published: "Wednesday, October 14, 2026",
          when: "today",
          age_days: 0,
        },
        { title: "Other", snippet: "Body 2", when: "date not stated" },
      ],
    });

    const text = JSON.stringify(outcome.data);

    assert.ok(!text.includes("http"));
    assert.ok(!text.includes("news-a"));
    assert.ok(!text.includes("news-b"));
  } finally {
    fake.restore();
  }
});

test("runWebSearch: the date is written by the app in the user's own calendar", async () => {
  const fake = fakeFetch(() =>
    jsonResponse({
      results: [
        {
          title: "Story",
          url: "https://news-a.com/1",
          content: "Body",
          published_date: "2026-10-14",
        },
        {
          title: "Odd",
          url: "https://news-b.org/2",
          content: "Body 2",
          published_date: "sometime last week",
        },
      ],
    }),
  );

  try {
    const outcome = await runWebSearch(
      { query: "q run-calendar" },
      { ...context, lang: "fa" },
      signal,
    );
    const data = outcome.data as {
      results: Record<string, unknown>[];
    };

    // A date the app could read is written by the app, not the page's own text.
    assert.equal(data.results[0]?.published, "چهارشنبه، ۲۲ مهر ۱۴۰۵");
    // A date that cannot be read is passed on as the page wrote it.
    assert.equal(data.results[1]?.published, "sometime last week");
  } finally {
    fake.restore();
  }
});

test("runWebSearch: news that is not from today carries the app's own note", async () => {
  const fake = fakeFetch(() =>
    jsonResponse({
      results: [
        {
          title: "Football story",
          url: "https://news-a.com/1",
          content: "football news body",
          published_date: "2026-10-11",
        },
      ],
    }),
  );

  try {
    const outcome = await runWebSearch(
      { query: "football news", news: true },
      context,
      signal,
    );
    const data = outcome.data as {
      note?: string;
      results: Array<{ when: string; age_days?: number }>;
    };

    assert.equal(data.results[0]?.when, "3 days ago");
    assert.match(data.note ?? "", /None of these results is from today/);
  } finally {
    fake.restore();
  }
});

test("runWebSearch: true and false written as text still count", async () => {
  const fake = fakeFetch(() => jsonResponse({ results: [] }));

  try {
    await runWebSearch(
      { query: "q string-flags", news: "True", fresh: "True" },
      context,
      signal,
    );

    const body = JSON.parse(String(fake.calls[0]?.init.body)) as Record<
      string,
      unknown
    >;

    assert.equal(body.topic, "news");
    assert.equal(body.time_range, "week");
  } finally {
    fake.restore();
  }

  const off = fakeFetch(() => jsonResponse({ results: [] }));

  try {
    await runWebSearch(
      { query: "q string-flags-off", news: "false", fresh: "no" },
      context,
      signal,
    );

    const body = JSON.parse(String(off.calls[0]?.init.body)) as Record<
      string,
      unknown
    >;

    assert.equal("topic" in body, false);
    assert.equal("time_range" in body, false);
  } finally {
    off.restore();
  }
});

test("runWebSearch: a long result is cut at the snippet limit, not at 400", async () => {
  assert.ok(WEB_SNIPPET_CHARS >= 900);

  const fake = fakeFetch(() =>
    jsonResponse({
      results: [
        {
          title: "Long",
          url: "https://long.example/a",
          content: "x".repeat(WEB_SNIPPET_CHARS + 500),
        },
      ],
    }),
  );

  try {
    const outcome = await runWebSearch(
      { query: "q run-long" },
      context,
      signal,
    );
    const data = outcome.data as {
      results: Array<{ snippet: string }>;
    };

    assert.equal(data.results[0]?.snippet.length, WEB_SNIPPET_CHARS);
  } finally {
    fake.restore();
  }
});

test("runWebSearch: the largest possible answer fits the tool-result cap", async () => {
  // The widest case: news, the most candidates, the most results kept.
  const results = Array.from({ length: WEB_FETCH_NEWS }, (_, index) => ({
    title: "T".repeat(200),
    url: `https://site-${index}.example/${"p".repeat(300)}`,
    content: "ک".repeat(WEB_SNIPPET_CHARS * 2),
    published_date: "Wed, 14 Oct 2026 08:00:00 GMT",
  }));
  const fake = fakeFetch(() => jsonResponse({ results }));

  try {
    const outcome = await runWebSearch(
      { query: "q run-largest", news: true },
      { ...context, lang: "fa" },
      signal,
    );
    const data = outcome.data as { results: unknown[] };

    assert.equal(data.results.length, WEB_NEWS_RESULTS);
    // The agent cuts tool text at TOOL_RESULT_CHAR_CAP; a cut in the middle of
    // the JSON would hide the last results from the model.
    assert.ok(JSON.stringify(outcome.data).length <= TOOL_RESULT_CHAR_CAP);
  } finally {
    fake.restore();
  }
});

test("runWebSearch: more candidates are fetched than the model reads, most for news", async () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      // Different words in every title, so the stories are not merged as one.
      title: `Alpha${index} Bravo${index} Charlie${index} Delta${index} football`,
      url: `https://site-${index}.example/a`,
      content: `football league story ${index}`,
      published_date: "2026-10-14",
    }));

  const plain = fakeFetch(() => jsonResponse({ results: many(WEB_FETCH_RESULTS) }));

  try {
    const outcome = await runWebSearch(
      { query: "football league story" },
      context,
      signal,
    );
    const body = JSON.parse(String(plain.calls[0]?.init.body)) as Record<
      string,
      unknown
    >;

    assert.equal(body.max_results, WEB_FETCH_RESULTS);
    assert.equal(
      (outcome.data as { results: unknown[] }).results.length,
      WEB_MAX_RESULTS,
    );
  } finally {
    plain.restore();
  }

  const news = fakeFetch(() => jsonResponse({ results: many(WEB_FETCH_NEWS) }));

  try {
    const outcome = await runWebSearch(
      { query: "football league story", news: true },
      context,
      signal,
    );
    const body = JSON.parse(String(news.calls[0]?.init.body)) as Record<
      string,
      unknown
    >;

    assert.equal(body.max_results, WEB_FETCH_NEWS);
    assert.equal(
      (outcome.data as { results: unknown[] }).results.length,
      WEB_NEWS_RESULTS,
    );
  } finally {
    news.restore();
  }
});

test("runWebSearch: failure, empty result and missing key are honest", async () => {
  const failing = fakeFetch(() => jsonResponse({}, 503));

  try {
    const outcome = await runWebSearch(
      { query: "q run-failed" },
      context,
      signal,
    );

    assert.deepEqual(outcome.data, { error: "Web search failed." });
  } finally {
    failing.restore();
  }

  const empty = fakeFetch(() => jsonResponse({ results: [] }));

  try {
    const outcome = await runWebSearch(
      { query: "q run-empty", fresh: true },
      context,
      signal,
    );

    assert.deepEqual(outcome.data, {
      results: [],
      note: "No recent web results were found.",
    });
  } finally {
    empty.restore();
  }

  const noKey = await runWebSearch(
    { query: "q no-key" },
    { ...context, tavilyKey: undefined },
    signal,
  );

  assert.deepEqual(noKey.data, { error: "Web search is not available." });

  const noQuery = await runWebSearch({ query: "   " }, context, signal);

  assert.deepEqual(noQuery.data, { error: "query is required." });
});

test("tavilySearch: news=true asks for the news topic and keeps the rest", async () => {
  const fake = fakeFetch(() => jsonResponse({ results: [] }));

  try {
    await tavilySearch("q news-shape", "key", 4, signal, true, true);

    const body = JSON.parse(String(fake.calls[0]?.init.body)) as Record<
      string,
      unknown
    >;

    assert.deepEqual(body, {
      query: "q news-shape",
      max_results: 4,
      search_depth: "basic",
      include_answer: false,
      time_range: "week",
      topic: "news",
    });
  } finally {
    fake.restore();
  }
});

test("tavilySearch: without news there is no topic field", async () => {
  const fake = fakeFetch(() => jsonResponse({ results: [] }));

  try {
    await tavilySearch("q no-news-shape", "key", 4, signal);

    const body = JSON.parse(String(fake.calls[0]?.init.body)) as Record<
      string,
      unknown
    >;

    assert.equal("topic" in body, false);
  } finally {
    fake.restore();
  }
});

test("tavilySearch: if the news filter is refused, it retries without it", async () => {
  const fake = fakeFetch((call) => {
    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;

    return "topic" in body
      ? jsonResponse({ error: "bad request" }, 400)
      : jsonResponse({
          results: [
            { title: "Story", url: "https://news-a.com/1", content: "Body" },
          ],
        });
  });

  try {
    const results = await tavilySearch("q news-retry", "key", 4, signal, false, true);

    assert.ok(results);
    assert.equal(results.length, 1);
    assert.equal(fake.calls.length, 2);
  } finally {
    fake.restore();
  }
});

test("runWebSearch: the news flag from the model reaches the search", async () => {
  const fake = fakeFetch(() => jsonResponse({ results: [] }));

  try {
    await runWebSearch({ query: "q run-news", news: true }, context, signal);

    const body = JSON.parse(String(fake.calls[0]?.init.body)) as Record<
      string,
      unknown
    >;

    assert.equal(body.topic, "news");
  } finally {
    fake.restore();
  }
});
