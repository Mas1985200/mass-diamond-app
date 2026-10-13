// src/components/chat/DirectionsButton.tsx
// "Directions" pill that opens a bottom sheet: pick how you travel, then pick
// an app. Links come from directionsLinks.ts.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  appleDirectionsUrl,
  geoUrl,
  googleDirectionsUrl,
  isApplePlatform,
  isValidTarget,
  TRAVEL_MODES,
  wazeUrl,
  type DirectionsTarget,
  type TravelMode,
} from "./directionsLinks";

const MODE_LABELS: Record<TravelMode, { readonly fa: string; readonly en: string }> = {
  car: { fa: "ماشین", en: "Car" },
  walk: { fa: "پیاده", en: "Walk" },
  transit: { fa: "حمل‌ونقل عمومی", en: "Transit" },
};

const ROW_CLASS =
  "flex w-full items-center justify-between gap-3 rounded-2xl border border-[rgba(57,255,136,0.25)] px-4 py-3 text-sm text-text transition-colors hover:bg-[rgba(57,255,136,0.08)]";

function readUserAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

type Option = {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly href: string;
  readonly external: boolean;
};

function buildOptions(
  target: DirectionsTarget,
  mode: TravelMode,
  rtl: boolean,
  apple: boolean,
): Option[] {
  const options: Option[] = [
    {
      key: "google",
      label: "Google Maps",
      hint: rtl ? "مسیر از موقعیت فعلی شما" : "Route from your location",
      href: googleDirectionsUrl(target, mode),
      external: true,
    },
  ];

  if (apple) {
    options.push({
      key: "apple",
      label: "Apple Maps",
      hint: rtl ? "مسیر از موقعیت فعلی شما" : "Route from your location",
      href: appleDirectionsUrl(target, mode),
      external: true,
    });
  } else {
    options.push({
      key: "geo",
      label: rtl ? "برنامه‌های نصب‌شده روی گوشی" : "Apps installed on this phone",
      hint: rtl
        ? "هر برنامه‌ی نقشه یا مسیریابی که دارید"
        : "Any map or navigation app you have",
      href: geoUrl(target),
      external: false,
    });
  }

  if (mode === "car") {
    options.push({
      key: "waze",
      label: "Waze",
      hint: rtl ? "فقط برای ماشین" : "Driving only",
      href: wazeUrl(target),
      external: true,
    });
  }

  return options;
}

export default function DirectionsButton({
  target,
  rtl,
  className,
}: {
  readonly target: DirectionsTarget;
  readonly rtl: boolean;
  readonly className: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TravelMode>("car");
  const close = useCallback((): void => setOpen(false), []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onKey = (event: { readonly key: string }): void => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (!isValidTarget(target)) {
    return null;
  }

  const options = buildOptions(target, mode, rtl, isApplePlatform(readUserAgent()));

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {rtl ? "مسیریابی" : "Directions"}
      </button>

      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={rtl ? "مسیریابی" : "Directions"}
            dir={rtl ? "rtl" : "ltr"}
            className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60"
            onClick={close}
          >
            <div
              className="md-glass w-full max-w-md rounded-t-3xl bg-[#060907] px-4 pb-6 pt-4"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-text-subtle">
                    {rtl ? "مسیریابی به" : "Directions to"}
                  </div>
                  <div dir="auto" className="truncate text-sm font-semibold text-text">
                    {target.name}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={close}
                  aria-label={rtl ? "بستن" : "Close"}
                  className="md-glass flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl leading-none text-primary"
                >
                  ×
                </button>
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                {TRAVEL_MODES.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    aria-pressed={entry === mode}
                    onClick={() => setMode(entry)}
                    className={
                      entry === mode
                        ? "rounded-full border border-[rgba(57,255,136,0.8)] bg-[rgba(57,255,136,0.15)] px-3 py-1 text-xs text-primary"
                        : "rounded-full border border-[rgba(57,255,136,0.25)] px-3 py-1 text-xs text-text-subtle"
                    }
                  >
                    {rtl ? MODE_LABELS[entry].fa : MODE_LABELS[entry].en}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                {options.map((option) => (
                  <a
                    key={option.key}
                    href={option.href}
                    {...(option.external
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                    onClick={close}
                    className={ROW_CLASS}
                  >
                    <span className="font-semibold">{option.label}</span>
                    <span className="text-xs text-text-subtle">{option.hint}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
