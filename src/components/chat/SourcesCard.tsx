// src/components/chat/SourcesCard.tsx
// Small card under a web answer: the real sites the answer rests on, each a
// link the user can open to check it.

import type { SourcesCardData } from "./sourcesCard";

const PILL_CLASS =
  "inline-flex max-w-full items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] leading-4 text-white/70 underline-offset-2 hover:text-white";

export default function SourcesCard({
  card,
}: {
  readonly card: SourcesCardData;
}) {
  const rtl = card.lang === "fa";

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="my-3 w-full max-w-sm"
      aria-label={rtl ? "منابع" : "Sources"}
    >
      <p className="mb-1.5 text-[11px] leading-4 text-white/50">
        {rtl ? "منابع" : "Sources"}
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {card.items.map((item) => (
          <li key={item.url} className="min-w-0 max-w-full">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              title={item.title || item.host}
              className={PILL_CLASS}
            >
              <bdi className="truncate">{item.host}</bdi>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
