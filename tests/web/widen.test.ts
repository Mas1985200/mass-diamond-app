// tests/web/widen.test.ts
// A thin first search is repeated once in the language of the place the
// question is about. The network is replaced by a fake fetch.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MIN_USEFUL_RESULTS,
  mergeResults,
  needsWiderSearch,
} from "../../supabase/functions/ai-chat/retrieval/widen.ts";
import { selectEvidence } from "../../supabase/functions/ai-chat/retrieval/evidence.ts";
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
  readonly published_date?: string;
};

function fakeFetch(respond: (query: string) => Response | null): {
  readonly queries: string[];
  readonly restore: () => void;
} {
  const original = globalThis.fetch;
  const queries: string[] = [];

  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query: string };

    queries.push(body.query);

    return respond(body.query) ?? new Response("{}", { status: 500 });
  }) as typeof fetch;

  return {
    queries,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function reply(results: readonly Raw[]): Response {
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Different words per story, so the app does not merge them as one story.
const HEADLINES = [
  "alpha bravo charlie delta",
  "echo foxtrot golf hotel",
  "india juliet kilo lima",
  "mike november oscar papa",
  "quebec romeo sierra tango",
  "uniform victor whiskey xray",
];

function headline(n: number): string {
  return HEADLINES[n] ?? `unique${n} words${n} here${n} only${n}`;
}

function raw(n: number, score: number, day = "2026-10-14"): Raw {
  return {
    title: headline(n),
    url: `https://site${n}.example/story`,
    content: `Body ${n}`,
    score,
    published_date: day,
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

function titles(outcome: { data: unknown }): string[] {
  const data = outcome.data as { results: { title: string }[] };

  return data.results.map((item) => item.title);
}

test("needsWiderSearch: a thin or weak first search is widened, a good one is not", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  const options = { now, zone: null, recencyMatters: true };
  const make = (n: number, score: number): WebResult => ({
    title: headline(n),
    source: `s${n}.com`,
    url: `https://s${n}.com/x`,
    published: "2026-10-14",
    snippet: "body",
    score,
  });

  assert.equal(needsWiderSearch(null), true);
  assert.equal(
    needsWiderSearch(selectEvidence([make(1, 0.9), make(2, 0.8)], "league", options)),
    true,
  );
  assert.equal(
    needsWiderSearch(
      selectEvidence([make(1, 0.1), make(2, 0.1), make(3, 0.1), make(4, 0.1)], "league", options),
    ),
    true,
  );
  assert.equal(MIN_USEFUL_RESULTS, 3);
  assert.equal(
    needsWiderSearch(
      selectEvidence([make(1, 0.9), make(2, 0.8), make(3, 0.7)], "league", options),
    ),
    false,
  );
});

test("mergeResults: the second search only adds addresses the first lacks", () => {
  const item = (url: string): WebResult => ({
    title: url,
    source: "x",
    url,
    published: "",
    snippet: "",
  });

  assert.deepEqual(
    mergeResults([item("a"), item("b")], [item("b"), item("c")]).map((r) => r.url),
    ["a", "b", "c"],
  );
});

test("runWebSearch: a thin first search is repeated in the local language and merged", async () => {
  const fake = fakeFetch((query) =>
    query === "widen-case iranian league"
      ? reply([raw(1, 0.2)])
      : reply([raw(2, 0.9), raw(3, 0.8), raw(4, 0.7)]),
  );

  try {
    const outcome = await runWebSearch(
      {
        query: "widen-case iranian league",
        local_query: "widen-case local league",
        news: true,
      },
      context,
      signal,
    );

    assert.deepEqual(fake.queries, [
      "widen-case iranian league",
      "widen-case local league",
    ]);
    assert.ok(titles(outcome).includes(headline(2)));
  } finally {
    fake.restore();
  }
});

test("runWebSearch: a good first search never costs a second one", async () => {
  const fake = fakeFetch(() => reply([raw(1, 0.9), raw(2, 0.8), raw(3, 0.7)]));

  try {
    await runWebSearch(
      {
        query: "enough-case league",
        local_query: "enough-case local league",
        news: true,
      },
      context,
      signal,
    );

    assert.deepEqual(fake.queries, ["enough-case league"]);
  } finally {
    fake.restore();
  }
});

test("runWebSearch: without a local wording, or with the same one, there is one search", async () => {
  const fake = fakeFetch(() => reply([raw(1, 0.2)]));

  try {
    await runWebSearch({ query: "single-case league", news: true }, context, signal);
    await runWebSearch(
      { query: "same-case league", local_query: "Same-Case League", news: true },
      context,
      signal,
    );

    assert.deepEqual(fake.queries, ["single-case league", "same-case league"]);
  } finally {
    fake.restore();
  }
});

test("runWebSearch: if the second search fails, the first result is kept", async () => {
  const fake = fakeFetch((query) =>
    query === "fail-case league" ? reply([raw(1, 0.9)]) : null,
  );

  try {
    const outcome = await runWebSearch(
      { query: "fail-case league", local_query: "fail-case local", news: true },
      context,
      signal,
    );

    assert.deepEqual(titles(outcome), [headline(1)]);
  } finally {
    fake.restore();
  }
});

test("runWebSearch: a first search that fails is rescued by the local one", async () => {
  const fake = fakeFetch((query) =>
    query === "rescue-case local" ? reply([raw(5, 0.9)]) : null,
  );

  try {
    const outcome = await runWebSearch(
      { query: "rescue-case league", local_query: "rescue-case local", news: true },
      context,
      signal,
    );

    assert.deepEqual(titles(outcome), [headline(5)]);
  } finally {
    fake.restore();
  }
});
