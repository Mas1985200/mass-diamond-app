// src/features/video/studio/FilmMakerPanel.tsx
// The film-making screen: add photos from the phone camera or gallery, set each
// photo's time, camera movement, change and caption, choose the shape and quality,
// make the film on the phone, then play and download it. Every decision is made in
// the studio files (filmDraft.ts, makeFilm.ts, studioTexts.ts, useFilmMaker.ts);
// this file only draws the state and sends what the person does.

import { formatNumber, type Lang } from "../videoCard.ts";
import {
  STUDIO_ASPECTS,
  STUDIO_MOTIONS,
  STUDIO_QUALITIES,
  STUDIO_TRANSITIONS,
  type StudioAspect,
  type StudioMotion,
  type StudioQuality,
  type StudioTransition,
} from "./types.ts";
import { STUDIO_TEXT, clockText, errorText, progressText, warningText } from "./studioTexts.ts";
import { useFilmMaker } from "./useFilmMaker.ts";

interface FilmMakerPanelProps {
  readonly lang?: Lang;
  readonly onClose: () => void;
}

// Words used only on this screen.
const PANEL_TEXT: Readonly<Record<Lang, {
  readonly close: string;
  readonly edit: string;
  readonly photoNumber: (n: number) => string;
  readonly titlePlaceholder: string;
}>> = {
  fa: {
    close: "بستن",
    edit: "ویرایش فیلم",
    photoNumber: (n) => `عکس ${formatNumber(n, "fa")}`,
    titlePlaceholder: "نام فیلم (اختیاری)",
  },
  en: {
    close: "Close",
    edit: "Edit the film",
    photoNumber: (n) => `Photo ${n}`,
    titlePlaceholder: "Film name (optional)",
  },
};

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

// A number with a half second, like 7.5, in the digits of the language.
function secondsText(value: number, lang: Lang): string {
  const text = String(value);
  return lang === "fa"
    ? text.replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]).replace(".", "٫")
    : text;
}

const BUTTON =
  "rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-text transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40";
const PRIMARY_BUTTON =
  "w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-black shadow-[0_0_20px_rgba(57,255,136,0.16)] transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50";
const FIELD =
  "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-text placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function FilmMakerPanel({ lang = "fa", onClose }: FilmMakerPanelProps) {
  const maker = useFilmMaker();
  const text = STUDIO_TEXT[lang];
  const extra = PANEL_TEXT[lang];
  const dir = lang === "fa" ? "rtl" : "ltr";
  const { draft, summary, phase, progress, error, output } = maker;
  const busy = phase === "making";

  return (
    <div
      dir={dir}
      className="fixed inset-0 z-50 overflow-y-auto bg-background text-text"
      role="dialog"
      aria-modal="true"
      aria-label={text.title}
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-10 pt-4">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-primary">{text.title}</h2>
          <button type="button" onClick={onClose} className={BUTTON}>
            {extra.close}
          </button>
        </header>

        {!maker.supported && (
          <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm leading-6 text-danger">
            {errorText(lang, "unsupported")}
          </p>
        )}

        {phase === "editing" && (
          <>
            <p className="text-sm leading-6 text-text-subtle">{text.subtitle}</p>

            <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-primary/40 bg-primary/5 px-4 py-5 text-center text-sm font-semibold text-primary transition hover:bg-primary/10">
              {text.addPhoto}
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(event: { target: HTMLInputElement }) => {
                  const input = event.target;
                  const files = Array.from(input.files ?? []);
                  input.value = "";
                  if (files.length > 0) void maker.addPhotos(files);
                }}
              />
            </label>

            {error && (
              <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm leading-6 text-danger">
                {errorText(lang, error)}
              </p>
            )}

            <section aria-label={text.photos} className="flex flex-col gap-3">
              {draft.photos.length === 0 ? (
                <p className="py-4 text-center text-sm text-text-subtle">{text.noPhotos}</p>
              ) : (
                draft.photos.map((photo, index) => (
                  <article
                    key={photo.id}
                    className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface p-3"
                  >
                    <div className="flex items-start gap-3">
                      <img
                        src={photo.url}
                        alt={extra.photoNumber(index + 1)}
                        className="h-20 w-20 flex-none rounded-xl object-cover"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-text">{extra.photoNumber(index + 1)}</span>
                          <span className="flex gap-1">
                            <button
                              type="button"
                              className={BUTTON}
                              disabled={index === 0}
                              onClick={() => maker.movePhoto(photo.id, -1)}
                              aria-label={text.moveEarlier}
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              className={BUTTON}
                              disabled={index === draft.photos.length - 1}
                              onClick={() => maker.movePhoto(photo.id, 1)}
                              aria-label={text.moveLater}
                            >
                              ▼
                            </button>
                            <button
                              type="button"
                              className={BUTTON}
                              onClick={() => maker.removePhoto(photo.id)}
                              aria-label={text.removePhoto}
                            >
                              ✕
                            </button>
                          </span>
                        </div>
                        <label className="flex flex-col gap-1 text-xs text-text-subtle">
                          <span>
                            {text.secondsLabel}: {secondsText(photo.seconds, lang)} {text.seconds}
                          </span>
                          <input
                            type="range"
                            min={1}
                            max={30}
                            step={0.5}
                            value={Math.min(30, photo.seconds)}
                            onChange={(event: { target: { value: string } }) =>
                              maker.updatePhoto(photo.id, { seconds: Number(event.target.value) })
                            }
                            className="w-full accent-[#39FF88]"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-xs text-text-subtle">
                        {text.motionLabel}
                        <select
                          className={FIELD}
                          value={photo.motion}
                          onChange={(event: { target: { value: string } }) =>
                            maker.updatePhoto(photo.id, { motion: event.target.value as StudioMotion })
                          }
                        >
                          {STUDIO_MOTIONS.map((motion) => (
                            <option key={motion} value={motion}>
                              {text.motions[motion]}
                            </option>
                          ))}
                        </select>
                      </label>
                      {index < draft.photos.length - 1 && (
                        <label className="flex flex-col gap-1 text-xs text-text-subtle">
                          {text.transitionLabel}
                          <select
                            className={FIELD}
                            value={photo.transition}
                            onChange={(event: { target: { value: string } }) =>
                              maker.updatePhoto(photo.id, { transition: event.target.value as StudioTransition })
                            }
                          >
                            {STUDIO_TRANSITIONS.map((transition) => (
                              <option key={transition} value={transition}>
                                {text.transitions[transition]}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>

                    <input
                      type="text"
                      className={FIELD}
                      value={photo.caption}
                      placeholder={text.captionPlaceholder}
                      aria-label={text.captionLabel}
                      onChange={(event: { target: { value: string } }) =>
                        maker.updatePhoto(photo.id, { caption: event.target.value })
                      }
                    />
                  </article>
                ))
              )}
            </section>

            <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface p-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-text-subtle">{text.shapeLabel}</span>
                <div className="grid grid-cols-3 gap-2">
                  {STUDIO_ASPECTS.map((aspect: StudioAspect) => (
                    <button
                      key={aspect}
                      type="button"
                      aria-pressed={draft.aspectRatio === aspect}
                      onClick={() => maker.setShape(aspect)}
                      className={`${BUTTON} ${draft.aspectRatio === aspect ? "border-primary/60 text-primary" : ""}`}
                    >
                      {text.shapes[aspect]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-text-subtle">{text.qualityLabel}</span>
                <div className="grid grid-cols-3 gap-2">
                  {STUDIO_QUALITIES.map((quality: StudioQuality) => (
                    <button
                      key={quality}
                      type="button"
                      aria-pressed={draft.quality === quality}
                      onClick={() => maker.setQuality(quality)}
                      className={`${BUTTON} ${draft.quality === quality ? "border-primary/60 text-primary" : ""}`}
                    >
                      {text.qualities[quality]}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="text"
                className={FIELD}
                value={draft.title}
                placeholder={extra.titlePlaceholder}
                aria-label={extra.titlePlaceholder}
                onChange={(event: { target: { value: string } }) => maker.setTitle(event.target.value)}
              />
            </section>

            {summary.canMake && (
              <p className="text-sm text-text-subtle">
                {text.total}: <span className="font-semibold text-text">{clockText(summary.seconds, lang)}</span>
              </p>
            )}
            {summary.warnings.map((warning, index) => (
              <p key={index} className="text-xs leading-5 text-warning">
                {warningText(lang, warning)}
              </p>
            ))}

            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={!summary.canMake || !maker.supported}
              onClick={maker.make}
            >
              {text.make}
            </button>
          </>
        )}

        {busy && (
          <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface p-4" aria-live="polite">
            <p className="text-sm font-semibold text-text">
              {progress ? progressText(lang, progress.stage, progress.value) : text.stages.loading}
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-180"
                style={{ width: `${Math.round((progress?.value ?? 0) * 100)}%` }}
              />
            </div>
            <p className="text-xs leading-5 text-text-subtle">{text.keepOpen}</p>
            <button type="button" className={BUTTON} onClick={maker.cancel}>
              {text.cancel}
            </button>
          </section>
        )}

        {phase === "done" && output && (
          <section className="flex flex-col gap-4">
            <p className="text-sm font-semibold text-primary">{text.done}</p>
            <video
              src={output.url}
              controls
              playsInline
              className="w-full rounded-2xl bg-black"
              style={{ maxHeight: "70vh" }}
            />
            <p className="text-xs text-text-subtle">
              {text.total}: {clockText(output.seconds, lang)}
            </p>
            {output.failedScenes > 0 && (
              <p className="text-xs leading-5 text-warning">{text.failedScenes(output.failedScenes)}</p>
            )}
            {output.warnings.map((warning, index) => (
              <p key={index} className="text-xs leading-5 text-warning">
                {warningText(lang, warning)}
              </p>
            ))}
            <a href={output.url} download={output.fileName} className={`${PRIMARY_BUTTON} block text-center`}>
              {text.download}
            </a>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={BUTTON} onClick={maker.edit}>
                {extra.edit}
              </button>
              <button type="button" className={BUTTON} onClick={maker.reset}>
                {text.makeAnother}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
