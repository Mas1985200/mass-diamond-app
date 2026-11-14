// src/features/video/VideoModelPicker.tsx
// The video model chooser, like the model list in ChatGPT: a small button
// showing the model in use, and a list that opens above it. All the decisions
// (the choices, what is usable) are made in videoModels.ts; this file only
// draws them. Nothing is drawn while there is no list to choose from.

import { useEffect, useRef, useState } from "react";

import {
  MODEL_TEXT,
  modelChoices,
  type VideoModel,
} from "./videoModels.ts";

interface VideoModelPickerProps {
  readonly models: readonly VideoModel[];
  // "auto" or the id of the model in use.
  readonly value: string;
  readonly onChange: (id: string) => void;
}

const TEXT = MODEL_TEXT.fa;

export default function VideoModelPicker({
  models,
  value,
  onChange,
}: VideoModelPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The list closes on a tap outside it and on the Escape key.
  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;

      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (models.length === 0) {
    return null;
  }

  const choices = modelChoices(models, "fa");
  const current = choices.find((choice) => choice.id === value) ?? choices[0];

  return (
    <div ref={rootRef} className="relative inline-block" dir="rtl">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={TEXT.title}
        className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-text-subtle transition-colors hover:text-primary"
      >
        <span>{current.label}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={TEXT.title}
          className="absolute bottom-full right-0 z-20 mb-2 w-60 rounded-2xl border border-white/10 bg-[#0b1410]/95 p-1 shadow-lg backdrop-blur"
        >
          {choices.map((choice) => {
            const selected = choice.id === current.id;

            return (
              <li key={choice.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={!choice.available}
                  onClick={() => {
                    onChange(choice.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-start text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? "bg-[rgba(57,255,136,0.08)] text-primary"
                      : "text-text hover:bg-white/5"
                  }`}
                >
                  <span className="flex flex-col">
                    <span>{choice.label}</span>
                    {choice.id === "auto" && (
                      <span className="text-[11px] text-text-subtle">
                        {TEXT.autoHint}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[11px] text-text-subtle">
                    {!choice.available
                      ? TEXT.unavailable
                      : choice.free
                        ? TEXT.free
                        : selected
                          ? "✓"
                          : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// end of VideoModelPicker.tsx
