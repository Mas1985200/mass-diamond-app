// tests/status/report-lib.test.ts
// The status report must never say "all good" when something is wrong. These
// tests cover the pure rules (reading test output, judging the live checks,
// the state of each requirement) and the shape of the requirements list.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  excerpt,
  judgeAppResponse,
  judgeFunctionResponse,
  overallVerdict,
  parseFailedNames,
  parseTestTotals,
  renderMarkdown,
  requirementState,
  stageIcon,
} from "../../scripts/status/lib.mjs";

const OUTPUT = [
  "TAP version 13",
  "ok 1 - fine",
  "not ok 2 - broken one",
  "  not ok 3 - broken two # SKIP",
  "not ok 2 - broken one",
  "# tests 1031",
  "# suites 0",
  "# pass 1029",
  "# fail 2",
  "# cancelled 0",
  "# skipped 0",
].join("\n");

function report(overrides: Record<string, unknown> = {}) {
  return {
    commit: "abcdef1234567",
    message: "a commit",
    time: "2026-11-28 11:30:00 (تهران)",
    stages: [
      { id: "install", label: "نصب", outcome: "success" },
      { id: "tests", label: "تست", outcome: "success" },
    ],
    tests: { tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0 },
    failedTests: [] as string[],
    live: [{ label: "اپ", ok: true, detail: "ok" }],
    requirements: [{ id: "a", text: "خواسته", state: "pass" }],
    ...overrides,
  };
}

test("parseTestTotals reads the totals and defaults to zero", () => {
  assert.deepEqual(parseTestTotals(OUTPUT), {
    tests: 1031,
    pass: 1029,
    fail: 2,
    cancelled: 0,
    skipped: 0,
  });
  assert.deepEqual(parseTestTotals(""), {
    tests: 0,
    pass: 0,
    fail: 0,
    cancelled: 0,
    skipped: 0,
  });
});

test("parseFailedNames lists each failed test once, honours the limit", () => {
  assert.deepEqual(parseFailedNames(OUTPUT), ["broken one", "broken two"]);
  assert.deepEqual(parseFailedNames(OUTPUT, 1), ["broken one"]);
  assert.deepEqual(parseFailedNames("ok 1 - fine"), []);
});

test("stageIcon: every outcome has its own icon, unknown is a question mark", () => {
  assert.equal(stageIcon("success"), "✅");
  assert.equal(stageIcon("failure"), "❌");
  assert.equal(stageIcon("skipped"), "⏭️");
  assert.equal(stageIcon("cancelled"), "⏹️");
  assert.equal(stageIcon("whatever"), "❔");
});

test("judgeFunctionResponse: 400 and 401 mean up, everything else means not up", () => {
  assert.equal(judgeFunctionResponse(401).ok, true);
  assert.equal(judgeFunctionResponse(400).ok, true);
  assert.equal(judgeFunctionResponse(404).ok, false);
  assert.match(judgeFunctionResponse(404).detail, /not deployed/);
  assert.equal(judgeFunctionResponse(500).ok, false);
  assert.equal(judgeFunctionResponse(200).ok, false);
});

test("judgeAppResponse: only a 200 page with the app root counts", () => {
  assert.equal(judgeAppResponse(200, '<div id="root"></div>').ok, true);
  assert.equal(judgeAppResponse(200, "<html>old page</html>").ok, false);
  assert.equal(judgeAppResponse(503, '<div id="root"></div>').ok, false);
});

test("requirementState: planned without tests, fail when any test is not green", () => {
  assert.equal(requirementState({ tests: [] }, {}), "planned");
  assert.equal(requirementState({ tests: ["a"] }, { a: true }), "pass");
  assert.equal(requirementState({ tests: ["a", "b"] }, { a: true, b: false }), "fail");
  assert.equal(requirementState({ tests: ["a"] }, {}), "fail");
});

test("overallVerdict: one wrong thing anywhere is enough to say so", () => {
  assert.equal(overallVerdict(report()), true);
  assert.equal(
    overallVerdict(
      report({ stages: [{ id: "tests", label: "تست", outcome: "failure" }] }),
    ),
    false,
  );
  assert.equal(
    overallVerdict(
      report({ tests: { tests: 3, pass: 2, fail: 1, cancelled: 0, skipped: 0 } }),
    ),
    false,
  );
  assert.equal(
    overallVerdict(report({ live: [{ label: "اپ", ok: false, detail: "down" }] })),
    false,
  );
  assert.equal(
    overallVerdict(
      report({ requirements: [{ id: "a", text: "x", state: "fail" }] }),
    ),
    false,
  );
  assert.equal(
    overallVerdict(
      report({ requirements: [{ id: "a", text: "x", state: "planned" }] }),
    ),
    true,
  );
});

test("renderMarkdown shows the verdict, the failures and escapes table breakers", () => {
  const good = renderMarkdown(report());

  assert.ok(good.includes("# Mass Diamond: وضعیت abcdef1"));
  assert.ok(good.includes("✅ همه چیز سالم"));
  assert.ok(good.includes("3 موفق از 3"));

  const bad = renderMarkdown(
    report({
      message: "a | b\nsecond line",
      tests: { tests: 3, pass: 2, fail: 1, cancelled: 0, skipped: 0 },
      failedTests: ["boom | test"],
      live: [],
    }),
  );

  assert.ok(bad.includes("❌ مشکل دارد"));
  assert.ok(bad.includes("boom \\| test"));
  assert.ok(bad.includes("a \\| b second line"));
  assert.ok(bad.includes("انجام نشد"));
});

test("excerpt keeps the first non-empty lines and trims them", () => {
  assert.deepEqual(excerpt("a  \n\n b\nc\nd", 3), ["a", " b", "c"]);
  assert.deepEqual(excerpt(""), []);
});

test("renderMarkdown prints the error excerpt of a failed stage in a code block", () => {
  const text = renderMarkdown(
    report({
      details: [
        { label: "بررسی نوع‌ها", lines: ["src/a.ts(1,1): error TS2322 `x`"] },
        { label: "ساخت اپ", lines: [] },
      ],
    }),
  );

  assert.ok(text.includes("### خطای بررسی نوع‌ها"));
  assert.ok(text.includes("src/a.ts(1,1): error TS2322 'x'"));
  assert.ok(!text.includes("### خطای ساخت اپ"));
});

test("requirements.json: well formed, unique ids, every connected test file exists", () => {
  const list = JSON.parse(
    readFileSync(new URL("../../scripts/status/requirements.json", import.meta.url), "utf8"),
  ) as Array<{ id: string; text: string; tests: string[] }>;

  assert.ok(list.length > 0);
  assert.equal(new Set(list.map((item) => item.id)).size, list.length);

  for (const item of list) {
    assert.ok(item.id.length > 0);
    assert.ok(item.text.length > 0);
    assert.ok(Array.isArray(item.tests));

    for (const file of item.tests) {
      assert.ok(existsSync(new URL(`../../${file}`, import.meta.url)), `missing ${file}`);
    }
  }
});
