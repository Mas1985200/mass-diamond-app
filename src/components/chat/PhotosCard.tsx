// src/components/chat/PhotosCard.tsx
// Picture strip of an answer. Every picture carries its author and license
// (Wikimedia Commons), which is shown under it with links to the license text
// and to the file page.

type Lang = "fa" | "en";

export interface PhotoItem {
  readonly src: string;
  readonly title: string;
  readonly author?: string;
  readonly license?: string;
  readonly licenseUrl?: string;
  readonly page?: string;
}

export interface PhotosCardData {
  readonly t: "photos";
  readonly lang: Lang;
  readonly items: readonly PhotoItem[];
}

const PHOTO_HOST_PATTERN = /^https:\/\/upload\.wikimedia\.org\//;
const LICENSE_HOST_PATTERN = /^https:\/\/creativecommons\.org\//;
const FILE_PAGE_PATTERN = /^https:\/\/commons\.wikimedia\.org\/wiki\//;
const MAX_PHOTOS = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asText(value: unknown, max: number): string | null {
  return typeof value === "string" && value ? value.slice(0, max) : null;
}

function asLink(value: unknown, pattern: RegExp): string | undefined {
  const text = asText(value, 300);

  return text && pattern.test(text) ? text : undefined;
}

// Cards come from the server as data; nothing is trusted. Only pictures from
// Wikimedia are shown, and only links to the license text and the file page.
export function parsePhotosCard(value: Record<string, unknown>): PhotosCardData | null {
  if (!Array.isArray(value.items)) {
    return null;
  }

  const items: PhotoItem[] = [];

  for (const raw of value.items.slice(0, MAX_PHOTOS)) {
    if (!isRecord(raw)) {
      continue;
    }

    const src = asText(raw.src, 600);

    if (!src || !PHOTO_HOST_PATTERN.test(src)) {
      continue;
    }

    const author = asText(raw.author, 90) ?? undefined;
    const license = asText(raw.license, 50) ?? undefined;
    const licenseUrl = asLink(raw.licenseUrl, LICENSE_HOST_PATTERN);
    const page = asLink(raw.page, FILE_PAGE_PATTERN);

    items.push({
      src,
      title: asText(raw.title, 100) ?? "",
      ...(author ? { author } : {}),
      ...(license ? { license } : {}),
      ...(licenseUrl ? { licenseUrl } : {}),
      ...(page ? { page } : {}),
    });
  }

  return items.length > 0
    ? { t: "photos", lang: value.lang === "en" ? "en" : "fa", items }
    : null;
}

const LINK_CLASS = "underline decoration-white/30 underline-offset-2";

function Credit({ item, rtl }: { readonly item: PhotoItem; readonly rtl: boolean }) {
  if (!item.license) {
    return null;
  }

  const license = item.licenseUrl ? (
    <a
      href={item.licenseUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={LINK_CLASS}
    >
      {item.license}
    </a>
  ) : (
    <span>{item.license}</span>
  );

  return (
    <figcaption className="mt-1.5 text-[11px] leading-4 text-white/60">
      {item.author ? (
        <>
          <span>{rtl ? "عکس: " : "Photo: "}</span>
          <bdi>{item.author}</bdi>
          <span> · </span>
        </>
      ) : null}
      {license}
      {item.page ? (
        <>
          <span> · </span>
          <a
            href={item.page}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLASS}
          >
            {rtl ? "ویکی‌مدیا کامنز" : "Wikimedia Commons"}
          </a>
        </>
      ) : null}
    </figcaption>
  );
}

export default function PhotosCard({ card }: { readonly card: PhotosCardData }) {
  const rtl = card.lang === "fa";

  return (
    <div dir={rtl ? "rtl" : "ltr"} className="my-3 w-full max-w-sm">
      <div className="md-gallery -mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-1">
        {card.items.map((item, index) => (
          <figure key={`${item.src}-${index}`} className="m-0 w-52 shrink-0 snap-start">
            <a
              href={item.src}
              target="_blank"
              rel="noopener noreferrer"
              className="block h-36 w-52 overflow-hidden rounded-2xl border border-white/10 bg-black/30"
            >
              <img
                src={item.src}
                alt={item.title}
                loading="lazy"
                draggable={false}
                referrerPolicy="no-referrer"
                className="h-full w-full select-none object-cover"
              />
            </a>
            <Credit item={item} rtl={rtl} />
          </figure>
        ))}
      </div>
    </div>
  );
}
