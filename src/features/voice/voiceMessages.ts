// src/features/voice/voiceMessages.ts
// Every text the voice-typing control shows, in one place, plus the recording
// time format. The texts are Persian for now, like the rest of the chat screen;
// when the chat screen is translated, this is the one file to move into the
// translation system. Because the error table is typed by VoiceErrorCode, a
// new error code cannot be added without also adding its message (the build
// fails otherwise).

import type { VoiceErrorCode } from "../../hooks/useVoiceInput";

export const VOICE_ERROR_MESSAGES: Record<VoiceErrorCode, string> = {
  unsupported: "این مرورگر ضبط صدا را پشتیبانی نمی‌کند.",
  permission:
    "اجازه‌ی میکروفون داده نشده است. آن را در تنظیمات مرورگر برای این سایت فعال کنید.",
  no_microphone: "میکروفونی پیدا نشد.",
  auth: "نشست شما منقضی شده است. لطفاً دوباره وارد شوید.",
  no_speech: "صدایی شنیده نشد. دوباره تلاش کنید.",
  rate_limited:
    "تعداد درخواست‌های صوتی زیاد است. چند ثانیه بعد دوباره تلاش کنید.",
  network: "اتصال به سرور برقرار نشد. لطفاً اینترنت خود را بررسی کنید.",
  failed: "تبدیل صدا به متن انجام نشد. دوباره تلاش کنید.",
};

export const VOICE_LABELS = {
  recording: "در حال ضبط…",
  transcribing: "در حال تبدیل صدا به متن…",
  cancel: "لغو",
  retry: "تلاش مجدد",
  micIdle: "ورودی صوتی",
  micStop: "توقف ضبط",
  micBusy: "در حال تبدیل صدا به متن",
} as const;

// "۰:۰۵" style recording time. A wrong value (negative, not a number) shows
// as zero.
export function formatRecordTime(totalSeconds: number): string {
  const whole = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.floor(totalSeconds))
    : 0;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;

  return `${minutes.toLocaleString("fa-IR")}:${rest < 10 ? "۰" : ""}${rest.toLocaleString("fa-IR")}`;
}
