// src/components/chat/AttachSheet.tsx
// The sheet that rises from the bottom when the user taps "+": everything the
// user can add to a message is chosen here (camera, photos, files; video
// will join later), instead of in the browser's own chooser.

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { MAX_PHOTOS } from "../../lib/imageAttach";

interface AttachSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCamera: () => void;
  readonly onPhotos: () => void;
  // How many more photos the message can take.
  readonly remaining: number;
}

const SHEET_CSS = `
@keyframes md-sheet-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
@keyframes md-sheet-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.md-sheet { animation: md-sheet-up 0.22s ease-out; }
.md-sheet-backdrop { animation: md-sheet-fade 0.22s ease-out; }
@media (prefers-reduced-motion: reduce) {
  .md-sheet, .md-sheet-backdrop { animation: none; }
}
`;

interface TileProps {
  readonly label: string;
  readonly hint?: string;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
}

function Tile({ label, hint, icon, disabled = false, onClick }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="md-glass flex flex-col items-center gap-2 rounded-2xl px-2 py-4 text-sm text-text transition-colors hover:border-[rgba(57,255,136,0.4)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-primary">
        {icon}
      </span>
      <span>{label}</span>
      {hint && <span className="-mt-1.5 text-[11px] text-text-subtle">{hint}</span>}
    </button>
  );
}

export default function AttachSheet({
  open,
  onClose,
  onCamera,
  onPhotos,
  remaining,
}: AttachSheetProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKey = (event: { readonly key: string }): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const max = MAX_PHOTOS.toLocaleString("fa-IR");
  const note =
    remaining < MAX_PHOTOS
      ? `حداکثر ${max} عکس در هر پیام · ${remaining.toLocaleString("fa-IR")} عکس دیگر`
      : `حداکثر ${max} عکس در هر پیام`;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="افزودن به گفتگو"
      dir="rtl"
      className="fixed inset-0 z-[100] flex items-end"
    >
      <style>{SHEET_CSS}</style>

      <button
        type="button"
        aria-label="بستن"
        onClick={onClose}
        className="md-sheet-backdrop absolute inset-0 bg-black/60"
      />

      <div className="md-sheet relative w-full rounded-t-[28px] border-t border-[rgba(57,255,136,0.25)] bg-[#0b120d] px-4 pb-6 pt-3">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />

        <div className="relative flex items-center justify-center pb-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="absolute left-0 flex h-9 w-9 items-center justify-center rounded-full text-text-subtle transition-colors hover:text-primary"
          >
            <CloseIcon />
          </button>

          <h2 className="text-base font-semibold text-text">افزودن به گفتگو</h2>
        </div>

        <div className="mx-auto grid w-full max-w-md grid-cols-3 gap-3">
          <Tile label="دوربین" icon={<CameraIcon />} onClick={onCamera} />
          <Tile label="عکس‌ها" icon={<PhotosIcon />} onClick={onPhotos} />
          <Tile label="فایل" hint="به‌زودی" icon={<FileIcon />} disabled />
        </div>

        <p className="pt-4 text-center text-xs text-text-subtle">{note}</p>
      </div>
    </div>,
    document.body,
  );
}

function iconProps() {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "w-5 h-5",
  };
}

function CloseIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4V8Z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

function PhotosIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="4" width="18" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M7 3h7l5 5v13H7V3Z" />
      <path d="M14 3v5h5" />
      <path d="M12 17v-5" />
      <path d="m9.8 14.2 2.2-2.2 2.2 2.2" />
    </svg>
  );
}
