// supabase/functions/ai-chat/video/catalog/questions.ts
// The questions the film director asks, one per message, as data. A question is
// "live" when the answer really changes what is made today; a "planned" one is
// never asked and is named as not offered yet, so the director never asks about
// something it cannot deliver. When length, music or on-screen text are built,
// their rows only change from "planned" to "live".
//
// Pure code (no network, no Deno), so every rule is tested directly.

import { PHOTO_ACTIONS } from "./actions.ts";
import { STYLES } from "./styles.ts";
import { liveActions } from "./lookup.ts";
import type { Availability, PhotoAction } from "./types.ts";

export interface DirectorQuestion {
  readonly id: "genre" | "look" | "length" | "sound" | "text";
  readonly status: Availability;
  // What to find out, in plain English.
  readonly ask: string;
  // 2 to 5 short example answers; the director writes them in the person's
  // language. They are only suggestions: any other answer is accepted too.
  readonly choices: readonly string[];
}

// The looks offered as buttons. Every other look is still understood when the
// person types it.
export const FEATURED_STYLE_IDS: readonly string[] = [
  "anime",
  "cinematic",
  "soft-3d",
  "realistic",
  "classic-2d",
];

function featuredLookNames(): string[] {
  return FEATURED_STYLE_IDS.flatMap((id) => {
    const style = STYLES.find((item) => item.id === id);

    return style ? [style.name] : [];
  });
}

export const DIRECTOR_QUESTIONS: readonly DirectorQuestion[] = [
  {
    id: "genre",
    status: "live",
    ask: "what kind of story or genre it should be",
    choices: ["Adventure", "Comedy", "Drama", "Sci-fi", "Fantasy"],
  },
  {
    id: "look",
    status: "live",
    ask: "how it should look",
    choices: featuredLookNames(),
  },
  {
    id: "length",
    status: "planned",
    ask: "how long it should be",
    choices: ["Short clip", "2 to 3 minutes", "5 to 10 minutes"],
  },
  {
    id: "sound",
    status: "planned",
    ask: "which music and sound it should have",
    choices: ["Calm", "Epic", "Happy", "No music"],
  },
  {
    id: "text",
    status: "planned",
    ask: "whether text should appear on the screen",
    choices: ["Title only", "Subtitles", "No text"],
  },
];

export function liveQuestions(
  questions: readonly DirectorQuestion[] = DIRECTOR_QUESTIONS,
): readonly DirectorQuestion[] {
  return questions.filter((question) => question.status === "live");
}

function choicesText(choices: readonly string[]): string {
  return `[[choices: ${choices.join(" | ")}]]`;
}

// The text the film director reads about its questions, as one line. Live
// questions are asked in order, one per message; planned ones are named only to
// say they must not be asked or promised yet.
export function directorQuestionsText(
  questions: readonly DirectorQuestion[] = DIRECTOR_QUESTIONS,
  actions: readonly PhotoAction[] = PHOTO_ACTIONS,
): string {
  const live = liveQuestions(questions);
  const planned = questions.filter((question) => question.status === "planned");
  const abilities = liveActions(actions);

  const steps = live.map(
    (question, index) =>
      `${index + 1}) find out ${question.ask}, with the choices ${choicesText(question.choices)}`,
  );

  if (abilities.length >= 2) {
    steps.push(
      `${steps.length + 1}) when the person sent photos, find out what to do with them, with the choices ${choicesText(abilities.map((action) => action.name))}`,
    );
  }

  const parts = [
    `Ask these questions in this order, ONE question per message, never two in the same message, and wait for the answer before the next one: ${steps.join("; ")}.`,
    "The choices are only suggestions in the user's language; any other answer, such as another look from the list of looks, is accepted too.",
    "Skip a question whose answer the person already gave, answered loosely or left to you.",
  ];

  if (abilities.length === 1) {
    const only = abilities[0] as PhotoAction;

    parts.push(
      `When the person sent photos, do this with them without asking: ${only.name.toLowerCase()}.`,
    );
  }

  parts.push(
    "Never ask about shape, size, quality or any technical setting: choose those yourself.",
  );

  if (planned.length > 0) {
    parts.push(
      `Do not ask about or promise yet: ${planned.map((question) => question.ask).join("; ")}.`,
    );
  }

  return parts.join(" ");
}
