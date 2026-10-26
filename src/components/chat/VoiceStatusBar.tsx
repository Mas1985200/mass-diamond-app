// src/components/chat/VoiceStatusBar.tsx
// The line above the message box that tells what the voice typing is doing:
// recording (with the time and a cancel button), turning the sound into text,
// or an error (with a "try again" button when the recording is still kept).
// It shows text and a button, never only a colour, and holds no state of its
// own: everything comes from useVoiceInput.

import {
  formatRecordTime,
  VOICE_ERROR_MESSAGES,
  VOICE_LABELS,
} from "../../features/voice/voiceMessages";
import type { VoiceErrorCode, VoiceState } from "../../hooks/useVoiceInput";

interface VoiceStatusBarProps {
  readonly state: VoiceState;
  readonly seconds: number;
  readonly error: VoiceErrorCode | null;
  // True when the failed recording is still kept and can be sent again.
  readonly canRetry: boolean;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
}

export default function VoiceStatusBar({
  state,
  seconds,
  error,
  canRetry,
  onCancel,
  onRetry,
}: VoiceStatusBarProps) {
  if (state === "recording") {
    return (
      <div
        role="status"
        className="flex items-center justify-between gap-3 pb-1 text-xs text-red-300"
      >
        <span className="flex items-center gap-2">
          <span className="md-rec-dot h-2 w-2 rounded-full bg-red-400" />
          <span>{VOICE_LABELS.recording}</span>
          <span dir="ltr" className="tabular-nums">
            {formatRecordTime(seconds)}
          </span>
        </span>

        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-red-300/30 px-3 py-0.5 text-xs text-red-200 transition-colors hover:bg-red-300/10"
        >
          {VOICE_LABELS.cancel}
        </button>
      </div>
    );
  }

  if (state === "transcribing") {
    return (
      <p role="status" className="pb-1 text-xs text-text-subtle">
        {VOICE_LABELS.transcribing}
      </p>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 pb-1 text-xs leading-5 text-red-300"
      >
        <span>{VOICE_ERROR_MESSAGES[error]}</span>

        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-full border border-red-300/30 px-3 py-0.5 text-xs text-red-200 transition-colors hover:bg-red-300/10"
          >
            {VOICE_LABELS.retry}
          </button>
        )}
      </div>
    );
  }

  return null;
}
