// scripts/status/lib.mjs
// Pure helpers of the status report: reading test output, judging the live
// checks and drawing the report as Markdown. Nothing here touches the network,
// the disk or the clock, so every rule is covered by tests/status/report-lib.test.ts.

// Reads the totals node's test runner prints at the end ("# tests 12", ...).
export function parseTestTotals(output) {
  const totals = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0 };

  for (const key of Object.keys(totals)) {
    const match = new RegExp(`^# ${key} (\\d+)\\s*$`, "m").exec(output);

    if (match) {
      totals[key] = Number(match[1]);
    }
  }

  return totals;
}

// The names of the tests that failed, once each, at most `limit` of them.
export function parseFailedNames(output, limit = 20) {
  const names = [];

  for (const line of output.split("\n")) {
    const match = /^\s*not ok \d+ - (.+?)(?:\s+#.*)?$/.exec(line);

    if (match && !names.includes(match[1])) {
      names.push(match[1]);
    }

    if (names.length >= limit) {
      break;
    }
  }

  return names;
}

// GitHub step outcomes: success, failure, skipped, cancelled.
export function stageIcon(outcome) {
  switch (outcome) {
    case "success":
      return "✅";
    case "failure":
      return "❌";
    case "skipped":
      return "⏭️";
    case "cancelled":
      return "⏹️";
    default:
      return "❔";
  }
}

// A function that is deployed and running answers a request without a sign-in
// with 400 or 401. Anything else (404, 5xx, no answer) means it is not up.
export function judgeFunctionResponse(status) {
  if (status === 401 || status === 400) {
    return { ok: true, detail: `answers (HTTP ${status})` };
  }

  if (status === 404) {
    return { ok: false, detail: "not deployed (HTTP 404)" };
  }

  return { ok: false, detail: `unexpected answer (HTTP ${status})` };
}

// The app is up when the page opens and holds the place the app mounts into.
export function judgeAppResponse(status, body) {
  if (status !== 200) {
    return { ok: false, detail: `page did not open (HTTP ${status})` };
  }

  if (!/id=["']root["']/.test(body)) {
    return { ok: false, detail: "page opened but is not the app" };
  }

  return { ok: true, detail: "page opens (HTTP 200)" };
}

// A requirement is "planned" until a test is connected to it.
export function requirementState(requirement, results) {
  if (requirement.tests.length === 0) {
    return "planned";
  }

  const failed = requirement.tests.filter((file) => results[file] !== true);

  return failed.length === 0 ? "pass" : "fail";
}

const STATE_ICON = { pass: "✅", fail: "❌", planned: "⏳" };

export function overallVerdict(report) {
  const stagesOk = report.stages.every((stage) => stage.outcome === "success");
  const testsOk = report.tests.fail === 0 && report.tests.cancelled === 0;
  const liveOk = report.live.every((check) => check.ok);
  const requirementsOk = report.requirements.every((item) => item.state !== "fail");

  return stagesOk && testsOk && liveOk && requirementsOk;
}

// The first lines of a stage's output, so a failure shows where it broke.
export function excerpt(output, limit = 15) {
  return output
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.length > 0)
    .slice(0, limit);
}

function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderMarkdown(report) {
  const lines = [];

  lines.push(`# Mass Diamond: وضعیت ${report.commit.slice(0, 7)}`);
  lines.push("");
  lines.push(`- commit: ${cell(report.message)}`);
  lines.push(`- زمان گزارش: ${report.time}`);
  lines.push(`- نتیجه کلی: ${overallVerdict(report) ? "✅ همه چیز سالم" : "❌ مشکل دارد"}`);
  lines.push("");

  lines.push("## مرحله‌های ساخت");
  for (const stage of report.stages) {
    lines.push(`- ${stageIcon(stage.outcome)} ${stage.label}: ${stage.outcome}`);
  }
  lines.push("");

  for (const detail of report.details ?? []) {
    if (detail.lines.length === 0) {
      continue;
    }

    lines.push(`### خطای ${detail.label}`);
    lines.push("```");
    lines.push(...detail.lines.map((line) => line.replace(/`/g, "'")));
    lines.push("```");
    lines.push("");
  }

  lines.push("## تست‌های واحد");
  lines.push(
    `- ${report.tests.fail === 0 ? "✅" : "❌"} ${report.tests.pass} موفق از ${report.tests.tests}` +
      ` (ناموفق: ${report.tests.fail}، لغوشده: ${report.tests.cancelled})`,
  );
  for (const name of report.failedTests) {
    lines.push(`  - ❌ ${cell(name)}`);
  }
  lines.push("");

  lines.push("## تست زنده (بعد از دیپلوی)");
  if (report.live.length === 0) {
    lines.push("- ⏭️ انجام نشد");
  }
  for (const check of report.live) {
    lines.push(`- ${check.ok ? "✅" : "❌"} ${check.label}: ${cell(check.detail)}`);
  }
  lines.push("");

  lines.push("## خواسته‌های تو");
  for (const item of report.requirements) {
    lines.push(`- ${STATE_ICON[item.state] ?? "❔"} ${cell(item.text)}`);
  }
  lines.push("");

  return lines.join("\n");
}
