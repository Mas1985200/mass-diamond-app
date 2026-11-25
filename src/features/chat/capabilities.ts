// src/features/chat/capabilities.ts
// The short "what can this app do" lines shown on the chat's start screen.
//
// Everything in Mass Diamond starts from the AI chat. Each ability is one tap
// that puts the chat in that mode, and each has one plain sentence that says
// what the person gets. The sentences live here, in one place, so the screen
// only draws them and a test can check that none is missing or empty.
// Pure code: no browser, no React.

export interface Capability {
  // The same id as the chat's quick action (see ChatScreen).
  readonly id: string;
  readonly summary: string;
}

export const CAPABILITIES: readonly Capability[] = [
  {
    id: "ask",
    summary: "هر سؤالی داری بپرس؛ جواب می‌گیری، متن می‌نویسی و تصمیم می‌گیری.",
  },
  {
    id: "web",
    summary: "جدیدترین خبرها و اطلاعات را از وب پیدا می‌کنم و با منبع نشان می‌دهم.",
  },
  {
    id: "image",
    summary: "فقط بگو چه تصویری می‌خواهی؛ برایت می‌سازم.",
  },
  {
    id: "video",
    summary:
      "ایده یا عکس‌هایت را بگو؛ چند سؤال کوتاه می‌پرسم (مدت، موسیقی، سبک) و فیلم را می‌سازم.",
  },
  {
    id: "learn",
    summary: "هر موضوعی را قدم‌به‌قدم و ساده یاد بگیر، با مثال و تمرین.",
  },
  {
    id: "product",
    summary: "محصول مناسب را پیدا کن و گزینه‌ها را کنار هم ببین.",
  },
  {
    id: "property",
    summary: "ملک مناسب برای خرید، اجاره یا فروش را پیدا کن.",
  },
  {
    id: "ad",
    summary: "برای کسب‌وکار یا کالایت آگهی و متن تبلیغاتی آماده بساز.",
  },
];

const BY_ID: ReadonlyMap<string, Capability> = new Map(
  CAPABILITIES.map((capability) => [capability.id, capability]),
);

// The sentence for one ability, or null when the id is unknown.
export function summaryFor(id: string): string | null {
  return BY_ID.get(id)?.summary ?? null;
}
