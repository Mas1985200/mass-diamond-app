// tests/eval/live-router.eval.ts
// Measures the REAL router model (the small model that decides what kind of
// question the user asked) on a fixed set of cases, so an improvement or a
// regression can be shown with numbers.
//
// This is a measurement, not a unit test: it calls the real Groq service, so
// it is NOT picked up by `node --test "tests/**/*.test.ts"` and never blocks a
// deploy. Run it from the manual workflow (needs the secret GROQ_API_KEY).
//
//   GROQ_API_KEY=... node tests/eval/live-router.eval.ts
//
// Without a key it does nothing and says so: a run that did not happen is
// never reported as a result.

import { appendFileSync } from "node:fs";

type Turn = { readonly role: "user" | "assistant"; readonly content: string };
type Label = "fresh" | "place" | "time" | "know" | "attach" | "chat";
type Case = {
  readonly group: string;
  readonly expect: Label;
  readonly turns: readonly Turn[];
};

const ask = (group: string, expect: Label, text: string): Case => ({
  group,
  expect,
  turns: [{ role: "user", content: text }],
});

const follow = (
  group: string,
  expect: Label,
  first: string,
  reply: string,
  next: string,
): Case => ({
  group,
  expect,
  turns: [
    { role: "user", content: first },
    { role: "assistant", content: reply },
    { role: "user", content: next },
  ],
});

const CASES: readonly Case[] = [
  // Live information.
  ask("fresh", "fresh", "قیمت دلار امروز چنده"),
  ask("fresh", "fresh", "طلا گرون شده؟ قیمت امروز"),
  ask("fresh", "fresh", "who is the current president of France"),
  ask("fresh", "fresh", "آخرین نسخه آیفون چیه"),
  ask("fresh", "fresh", "نتیجه بازی پرسپولیس دیشب چی شد"),
  ask("fresh", "fresh", "bitcoin price right now"),
  ask("fresh", "fresh", "هوای تهران فردا چطوره"),

  // Spelling mistakes and colloquial Persian.
  ask("typo-fa", "fresh", "قمیت دلر امروز چنده"),
  ask("typo-fa", "time", "ساعت چنده الان"),
  ask("typo-fa", "time", "امروز چن شنبس"),
  ask("typo-fa", "know", "فتوسنتز چیه"),
  ask("typo-fa", "know", "چرا اسمون ابیه"),
  ask("typo-fa", "chat", "یه شعر کوتاه واسه مامانم بنویس"),

  // Date and time.
  ask("time", "time", "ساعت توکیو الان چنده"),
  ask("time", "time", "what time is it in London"),
  ask("time", "time", "امروز چندمه"),

  // Stable knowledge.
  ask("know", "know", "how does a vaccine work"),
  ask("know", "know", "علائم دیابت چیه"),
  ask("know", "know", "ملکه الیزابت چه سالی درگذشت"),
  ask("know", "know", "تفاوت میتوز و میوز چیه"),
  ask("know", "know", "عکس شیر نر و ماده"),

  // Everyday conversation, writing, maths, programming.
  ask("chat", "chat", "سلام"),
  ask("chat", "chat", "این رو به انگلیسی ترجمه کن: صبح بخیر"),
  ask("chat", "chat", "5 * 17 چند میشه"),
  ask("chat", "chat", "یک کد پایتون بنویس که رشته رو برعکس کنه"),
  ask("chat", "chat", "فردا مصاحبه کاری دارم و استرس دارم"),

  // Places.
  ask("place", "place", "میدان آزادی کجاست"),
  ask("place", "place", "نزدیک‌ترین داروخانه کجاست"),
  ask("place", "place", "Eyfel Kulesi nerede?"),

  // Other languages.
  ask("other-lang", "fresh", "¿Cuál es el precio del oro hoy?"),
  ask("other-lang", "know", "Wie funktioniert Photosynthese?"),
  ask("other-lang", "fresh", "Bugün İstanbul'da hava nasıl?"),
  ask("other-lang", "fresh", "Какая сегодня погода в Москве?"),
  ask("other-lang", "chat", "hola, ¿cómo estás?"),

  // Points at something that was never sent.
  ask("attach", "attach", "این چیه؟"),
  ask("attach", "attach", "عکسی که فرستادم رو ببین"),

  // Follow-ups that only make sense with the earlier messages.
  follow("follow-up", "fresh", "قیمت دلار چنده؟", "دلار امروز حدود ... تومان است.", "و طلا؟"),
  follow("follow-up", "know", "فتوسنتز چیه؟", "فتوسنتز فرایندی است که ...", "بیشتر توضیح بده"),
  follow("follow-up", "chat", "یه شعر کوتاه بنویس", "این هم یک شعر ...", "کوتاه‌ترش کن"),
  follow("follow-up", "time", "ساعت توکیو چنده؟", "در توکیو ساعت ... است.", "لندن چی؟"),
];

const PAUSE_MS = 5_000;
const RETRY_PAUSE_MS = 25_000;
const RETRIES = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const key = process.env.GROQ_API_KEY?.trim();

  if (!key) {
    console.log(
      JSON.stringify({
        event: "live-router",
        status: "not-run",
        reason: "GROQ_API_KEY is not set",
        cases: CASES.length,
      }),
    );
    process.exitCode = 1;
    return;
  }

  // The function code reads its secrets through Deno.env; give it the same.
  (globalThis as { Deno?: unknown }).Deno = {
    env: { get: (name: string) => process.env[name] },
  };

  const { routeCapability } = await import(
    "../../supabase/functions/ai-chat/routing/capability.ts"
  );

  const outcomes: Array<{
    group: string;
    expect: Label;
    got: Label | null;
    text: string;
  }> = [];

  for (const item of CASES) {
    let got: Label | null = null;

    for (let attempt = 0; attempt <= RETRIES && got === null; attempt += 1) {
      if (attempt > 0) {
        await sleep(RETRY_PAUSE_MS);
      }

      got = await routeCapability(item.turns, new AbortController().signal);
    }

    const last = item.turns[item.turns.length - 1]?.content ?? "";

    outcomes.push({ group: item.group, expect: item.expect, got, text: last });
    await sleep(PAUSE_MS);
  }

  const answered = outcomes.filter((outcome) => outcome.got !== null);
  const correct = answered.filter((outcome) => outcome.got === outcome.expect);
  const groups = [...new Set(outcomes.map((outcome) => outcome.group))];

  const lines: string[] = [
    "## Live router measurement",
    "",
    `Correct: ${correct.length} of ${answered.length} answered (${outcomes.length} cases, ${outcomes.length - answered.length} with no answer from the service).`,
    "",
    "| Group | Correct | Answered |",
    "| --- | --- | --- |",
  ];

  for (const group of groups) {
    const inGroup = answered.filter((outcome) => outcome.group === group);
    const right = inGroup.filter((outcome) => outcome.got === outcome.expect);

    lines.push(`| ${group} | ${right.length} | ${inGroup.length} |`);
  }

  const wrong = answered.filter((outcome) => outcome.got !== outcome.expect);

  if (wrong.length > 0) {
    lines.push("", "### Wrong decisions", "");

    for (const outcome of wrong) {
      lines.push(`- «${outcome.text}» expected ${outcome.expect}, got ${outcome.got}`);
    }
  }

  const silent = outcomes.filter((outcome) => outcome.got === null);

  if (silent.length > 0) {
    lines.push("", "### No answer (rate limit, timeout or service error)", "");

    for (const outcome of silent) {
      lines.push(`- «${outcome.text}»`);
    }
  }

  const report = lines.join("\n");

  console.log(report);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  }
}

await main();
