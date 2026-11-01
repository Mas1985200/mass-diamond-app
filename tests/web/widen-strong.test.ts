// tests/web/widen-strong.test.ts
// A first search whose best page is only loosely related (low score from the
// search service) is repeated in the language of the place, even when it kept
// enough results. The network is replaced by a fake fetch.

import test from "node:test";
import assert from "node:assert/strict";

import {
  STRONG_SCORE,
  lacksStrongMatch,
} from "../../supabase/functions/ai-chat/retrieval/widen.ts";
import { runWebSearch } from "../../supabase/functions/ai-chat/tools/web.ts";
import type {
  ToolContext,
  WebResult,
} from "../../supabase/functions/ai-chat/types.ts";

type Raw = {
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly score: number;
  readonly published_date: string;
};

const HEADLINES = [
  "alpha bravo charlie delta",
  "echo foxtrot golf hotel",
  "india juliet kilo lima",
  "mike november oscar papa",
  "quebec romeo sierra tango",
  "uniform victor whiskey xray",
];

function raw(n: number, score: number): Raw {
  return {
    title: HEADLINES[n] ?? `unique${n} words${n} here${n}`,
    url: `https://strong${n}.example/story`,
    content: `Body ${n}`,
    score,
    published_date: "2026-10-14",
  };
}

function reply(results: readonly Raw[]): Response {
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeFetch(respond: (query: string) => Response): {
  readonly queries: string[];
  readonly restore: () => void;
} {
  const original = globalThis.fetch;
  const queries: string[] = [];

  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query: string };

    queries.push(body.query);

    return respond(body.query);
  }) as typeof fetch;

  return {
    queries,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const signal = new AbortController().signal;

const context: ToolContext = {
  now: new Date("2026-10-14T10:00:00Z"),
  timeZone: "Asia/Tehran",
  location: null,
  lang: "en",
  tavilyKey: "test-key",
};

test("lacksStrongMatch: true only when pages are scored and none is strong", () => {
  const page = (score?: number): WebResult => ({
    title: "t",
    source: "s",
    url: "https://s.example/x",
    published: "",
    snippet: "",
    ...(score === undefined ? {} : { score }),
  });

  assert.equal(STRONG_SCORE, 0.6);
  assert.equal(lacksStrongMatch([page(0.5), page(0.3)]), true);
  assert.equal(lacksStrongMatch([page(0.5), page(0.7)]), false);
  assert.equal(lacksStrongMatch([page(), page()]), false);
  assert.equal(lacksStrongMatch([]), false);
});

test("runWebSearch: enough results but none strong still get the local-language search", async () => {
  const fake = fakeFetch((query) =>
    query === "strong-case first wording"
      ? reply([raw(0, 0.45), raw(1, 0.4), raw(2, 0.35), raw(3, 0.3)])
      : reply([raw(4, 0.9), raw(5, 0.8)]),
  );

  try {
    await runWebSearch(
      {
        query: "strong-case first wording",
        local_query: "strong-case local wording",
        news: true,
      },
      context,
      signal,
    );

    assert.deepEqual(fake.queries, [
      "strong-case first wording",
      "strong-case local wording",
    ]);
  } finally {
    fake.restore();
  }
});

test("runWebSearch: a strong first search never costs a second one", async () => {
  const fake = fakeFetch(() => reply([raw(0, 0.9), raw(1, 0.8), raw(2, 0.7)]));

  try {
    await runWebSearch(
      {
        query: "strong-case enough",
        local_query: "strong-case enough local",
        news: true,
      },
      context,
      signal,
    );

    assert.equal(fake.queries.length, 1);
  } finally {
    fake.restore();
  }
});

test("web_evidence logs whether a local wording was given", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  const fake = fakeFetch(() => reply([raw(0, 0.9), raw(1, 0.8), raw(2, 0.7)]));

  console.log = (line: unknown) => {
    lines.push(String(line));
  };

  try {
    await runWebSearch(
      { query: "log-case a", local_query: "log-case b", news: true },
      context,
      signal,
    );
    await runWebSearch(
      { query: "log-case same", local_query: "log-case same", news: true },
      context,
      signal,
    );
  } finally {
    console.log = originalLog;
    fake.restore();
  }

  const logged = lines
    .map((line) => JSON.parse(line) as { event?: string; hasLocal?: boolean })
    .filter((entry) => entry.event === "web_evidence");

  assert.deepEqual(
    logged.map((entry) => entry.hasLocal),
    [true, false],
  );
});
