// src/components/chat/PhotoStrip.tsx
// Photos the user attached: the removable previews above the text box, and the
// small pictures inside a sent message.

import type { AttachedPhoto } from "../../lib/imageAttach";

interface PhotoStripProps {
  readonly photos: readonly AttachedPhoto[];
  readonly onRemove: (id: string) => void;
  readonly disabled?: boolean;
}

export default function PhotoStrip({
  photos,
  onRemove,
  disabled = false,
}: PhotoStripProps) {
  if (photos.length === 0) {
    return null;
  }

  return (
    <ul
      dir="rtl"
      aria-label="عکس‌های پیوست‌شده"
      className="flex flex-wrap items-center gap-2 pb-2"
    >
      {photos.map((photo) => (
        <li key={photo.id} className="relative h-14 w-14">
          <img
            src={photo.thumb}
            alt="عکس پیوست‌شده"
            draggable={false}
            className="h-14 w-14 select-none rounded-xl border border-[rgba(57,255,136,0.35)] object-cover"
          />

          <button
            type="button"
            onClick={() => onRemove(photo.id)}
            disabled={disabled}
            aria-label="حذف عکس"
            className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-xs leading-none text-white transition-opacity disabled:opacity-40"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

interface MessageThumbsProps {
  readonly thumbs: readonly string[];
}

// The pictures of a message the user has sent.
export function MessageThumbs({ thumbs }: MessageThumbsProps) {
  if (thumbs.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {thumbs.map((src, index) => (
        <img
          key={`${index}-${src.length}`}
          src={src}
          alt="عکس ارسال‌شده"
          draggable={false}
          className="h-24 w-24 select-none rounded-xl object-cover"
        />
      ))}
    </div>
  );
}
