// src/features/video/VideoCard.tsx
// The card under an answer in the video mode: first the progress of the video
// being made, then the video itself with download and share. All the decisions
// (what to show, when to ask again) are made in videoCard.ts, videoWatcher.ts
// and useVideoJob.ts; this file only draws them.

import { useRef, useState } from "react";

import { useVideoJob } from "./useVideoJob.ts";
import {
  VIDEO_CARD_TEXT,
  cssRatio,
  downloadName,
  failureText,
  formatNumber,
  formatPercent,
  type AspectRatio,
  type Lang,
  type VideoCardData,
} from "./videoCard.ts";
import {
  fetchVideoBlob,
  openInNewTab,
  saveBlob,
  shareVideoFile,
} from "./videoFile.ts";

// A tall video must not fill the whole chat, so each shape has its own width.
const WIDTH: Readonly<Record<AspectRatio, string>> = {
  "16:9": "max-w-sm",
  "9:16": "max-w-[220px]",
  "1:1": "max-w-[300px]",
};

const BUTTON_CLASS =
  "rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs leading-4 text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50";

const FILE_TEXT: Readonly<
  Record<Lang, { readonly fetchFailed: string; readonly shareUnsupported: string }>
> = {
  fa: {
    fetchFailed: "دریافت فایل ممکن نشد؛ ویدیو در تب جدید باز شد.",
    shareUnsupported: "اشتراک‌گذاری در این مرورگر پشتیبانی نمی‌شود؛ از دانلود استفاده کن.",
  },
  en: {
    fetchFailed: "The file could not be fetched; the video was opened in a new tab.",
    shareUnsupported: "Sharing is not supported in this browser; use download instead.",
  },
};

type Busy = "download" | "share" | null;

function VideoCardBody({ card }: { readonly card: VideoCardData }) {
  const t = VIDEO_CARD_TEXT[card.lang];
  const files = FILE_TEXT[card.lang];
  const rtl = card.lang === "fa";

  const handle = useVideoJob(card.jobId);
  const { view } = handle;

  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  // The link of a video lasts an hour: when the player cannot open it, the
  // card asks once for a fresh link by itself before showing an error.
  const reloadedFor = useRef<string | null>(null);
  const blobRef = useRef<{ url: string; blob: Blob } | null>(null);

  const readyUrl = view.kind === "ready" ? view.videoUrl : null;

  const loadFile = async (url: string): Promise<Blob | null> => {
    if (blobRef.current?.url === url) {
      return blobRef.current.blob;
    }

    const blob = await fetchVideoBlob(url);

    if (blob) {
      blobRef.current = { url, blob };
    }

    return blob;
  };

  const download = async (url: string): Promise<void> => {
    setBusy("download");
    setNote(null);

    const blob = await loadFile(url);

    if (blob) {
      saveBlob(blob, downloadName(card.jobId));
    } else {
      openInNewTab(url);
      setNote(files.fetchFailed);
    }

    setBusy(null);
  };

  const share = async (url: string): Promise<void> => {
    setBusy("share");
    setNote(null);

    const blob = await loadFile(url);

    if (!blob) {
      openInNewTab(url);
      setNote(files.fetchFailed);
    } else {
      const result = await shareVideoFile(blob, downloadName(card.jobId), t.title);

      if (result === "unsupported") {
        setNote(files.shareUnsupported);
      }
    }

    setBusy(null);
  };

  const onPlayerError = (): void => {
    if (readyUrl === null) {
      return;
    }

    if (reloadedFor.current !== readyUrl) {
      reloadedFor.current = readyUrl;
      handle.reload();
      return;
    }

    setFailedUrl(readyUrl);
  };

  const meta = `${formatNumber(card.durationSeconds, card.lang)} ${t.seconds} · ${t.qualities[card.quality]}`;

  let screen: JSX.Element;

  switch (view.kind) {
    case "ready":
      screen =
        failedUrl === view.videoUrl ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
            <p className="m-0 text-xs leading-5 text-white/70">{t.playerFailed}</p>
            <button type="button" className={BUTTON_CLASS} onClick={handle.reload}>
              {t.retry}
            </button>
          </div>
        ) : (
          <video
            key={view.videoUrl}
            src={view.videoUrl}
            poster={view.posterUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full bg-black object-contain"
            onError={onPlayerError}
          />
        );
      break;

    case "failed":
      screen = (
        <p className="m-0 p-4 text-center text-xs leading-5 text-white/75">
          {failureText(view.code, card.lang)}
        </p>
      );
      break;

    case "canceled":
      screen = <p className="m-0 p-4 text-center text-xs leading-5 text-white/75">{t.canceled}</p>;
      break;

    case "missing":
      screen = <p className="m-0 p-4 text-center text-xs leading-5 text-white/75">{t.missing}</p>;
      break;

    default: {
      const percent = view.kind === "working" ? view.progress : 0;
      const label =
        view.kind === "working"
          ? `${t.working} ${formatPercent(percent, card.lang)}`
          : view.kind === "queued"
            ? t.queued
            : t.starting;

      screen = (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center">
          <span
            aria-hidden="true"
            className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-[rgb(57,255,136)]"
          />
          <p className="m-0 text-xs leading-5 text-white/80">{label}</p>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 w-3/4 overflow-hidden rounded-full bg-white/10"
          >
            <div
              className="h-full rounded-full bg-[rgb(57,255,136)] transition-[width] duration-500"
              style={{ width: `${Math.max(4, percent)}%` }}
            />
          </div>
        </div>
      );
    }
  }

  const waiting = view.kind === "starting" || view.kind === "queued" || view.kind === "working";

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      role="group"
      aria-label={t.title}
      className={`my-3 w-full ${WIDTH[card.aspectRatio]}`}
    >
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        <div
          className="relative flex w-full items-center justify-center bg-black/40"
          style={{ aspectRatio: cssRatio(card.aspectRatio) }}
          aria-live="polite"
        >
          {screen}
        </div>

        <div className="flex flex-col gap-2 px-3 py-2">
          <p className="m-0 text-[11px] leading-4 text-white/50">{meta}</p>

          {waiting && <p className="m-0 text-[11px] leading-4 text-white/50">{t.patience}</p>}

          {handle.offline && waiting && (
            <p className="m-0 text-[11px] leading-4 text-[rgb(255,196,87)]">{t.offline}</p>
          )}

          {note && <p className="m-0 text-[11px] leading-4 text-white/60">{note}</p>}

          <div className="flex flex-wrap gap-2">
            {readyUrl !== null && (
              <>
                <button
                  type="button"
                  className={BUTTON_CLASS}
                  disabled={busy !== null}
                  onClick={() => void download(readyUrl)}
                >
                  {t.download}
                </button>
                <button
                  type="button"
                  className={BUTTON_CLASS}
                  disabled={busy !== null}
                  onClick={() => void share(readyUrl)}
                >
                  {t.share}
                </button>
              </>
            )}

            {(view.kind === "queued" || view.kind === "working") && (
              <button
                type="button"
                className={BUTTON_CLASS}
                disabled={handle.canceling}
                onClick={handle.cancel}
              >
                {t.cancel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// One card per video: the job id is the key, so a card never shows the state
// of another video.
export default function VideoCard({ card }: { readonly card: VideoCardData }) {
  return <VideoCardBody key={card.jobId} card={card} />;
}
