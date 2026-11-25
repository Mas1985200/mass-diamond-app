// src/components/chat/ChoiceRow.tsx
// One row of tappable answers under a question in the chat. It only draws the
// buttons: which answer is chosen and what happens next is decided by the chat
// screen. The row runs in the direction of the language of its options.

import { detectDirection } from "../../features/chat/textDirection";

const BASE_CLASS =
  "rounded-full border px-3.5 py-1.5 text-[13px] leading-5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40";
const IDLE_CLASS =
  "border-[rgba(57,255,136,0.35)] text-primary hover:bg-[rgba(57,255,136,0.08)]";
const CHOSEN_CLASS =
  "border-[rgba(57,255,136,0.7)] bg-[rgba(57,255,136,0.18)] font-semibold text-primary";

export default function ChoiceRow({
  options,
  chosen,
  onPick,
}: {
  readonly options: readonly string[];
  // The option already tapped in this row, or null.
  readonly chosen: string | null;
  readonly onPick: (option: string) => void;
}) {
  return (
    <div
      role="group"
      dir={detectDirection(options)}
      className="my-2 flex flex-wrap gap-2"
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={chosen === option}
          onClick={() => onPick(option)}
          className={`${BASE_CLASS} ${chosen === option ? CHOSEN_CLASS : IDLE_CLASS}`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
