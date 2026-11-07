// src/features/video/videoMode.ts
// The video-making mode of the chat: its id, its address and its texts.
//
// "Make a video" is not a separate page. It is the normal chat with a mode
// switched on, and the address /video is just a way to open the chat already in
// that mode (from the home screen button, a shared link or a bookmark).
// Pure code: nothing here touches the browser, so every rule can be tested.

export const VIDEO_MODE_ID = "video";
export const VIDEO_PATH = "/video";
export const HOME_PATH = "/";

// The video engine (server side) is built in later steps. Until it is
// connected, the chat must not pretend to make a video, so sending in this mode
// is held back and the person is told why. The step that connects the real
// engine switches this to true.
export const VIDEO_ENGINE_READY = false;

export const VIDEO_TEXT = {
  label: "ساخت ویدیو",
  hint: "چه ویدیویی بسازم؟ ایده‌ات را ساده بنویس.",
  engineNotReady:
    "موتور تولید ویدیو هنوز متصل نشده است؛ تا فعال‌شدن آن، ارسال پیام در این حالت ممکن نیست.",
} as const;

// "/video" and "/video/" (in any letter case) open the video mode. Anything
// else, including "/videos" or "/video/x", does not.
export function isVideoPath(pathname: string): boolean {
  return pathname.toLowerCase().replace(/\/+$/, "") === VIDEO_PATH;
}

// The mode the chat starts in for the address it was opened at.
export function initialModeId(pathname: string): string | null {
  return isVideoPath(pathname) ? VIDEO_MODE_ID : null;
}

// The address the browser bar should show for the current mode, or null when
// it already shows the right one. Other modes never change the address.
export function pathForMode(
  modeId: string | null,
  currentPath: string,
): string | null {
  const onVideoPath = isVideoPath(currentPath);

  if (modeId === VIDEO_MODE_ID) {
    return onVideoPath ? null : VIDEO_PATH;
  }

  return onVideoPath ? HOME_PATH : null;
}

// Leaving a chat (the phone's back button) keeps the video mode, because the
// address is still /video and the home of that address is the video start
// screen. Every other mode ends.
export function modeAfterLeavingChat(modeId: string | null): string | null {
  return modeId === VIDEO_MODE_ID ? modeId : null;
}

// Sending a message ends a one-shot mode (like search) but the video mode
// stays on: a video is made over several messages ("make it brighter").
export function modeAfterSending(modeId: string | null): string | null {
  return modeId === VIDEO_MODE_ID ? modeId : null;
}

// True when the person is in the video mode but the engine is not connected.
export function isVideoBlocked(modeId: string | null): boolean {
  return modeId === VIDEO_MODE_ID && !VIDEO_ENGINE_READY;
}
