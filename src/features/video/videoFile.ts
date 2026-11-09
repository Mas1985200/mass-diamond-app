// src/features/video/videoFile.ts
// Browser helpers for a finished video: fetch it as a file, save it to the
// device, share it with other apps, or open it in a new tab. Only the signed
// https link of the video is used, nothing is uploaded anywhere.

// The server never keeps a video larger than 50 MB; a bit of room on top.
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

export type ShareResult = "shared" | "unsupported" | "canceled" | "failed";

// The video as a file in memory, or null when it could not be fetched (no
// internet, an expired link, something that is not a video, too large).
export async function fetchVideoBlob(
  url: string,
  signal?: AbortSignal,
): Promise<Blob | null> {
  try {
    const response = await fetch(url, { signal });

    if (!response.ok) {
      return null;
    }

    const declared = Number(response.headers.get("Content-Length"));

    if (Number.isFinite(declared) && declared > MAX_VIDEO_BYTES) {
      return null;
    }

    const blob = await response.blob();
    const type = blob.type.toLowerCase();

    if (blob.size === 0 || blob.size > MAX_VIDEO_BYTES) {
      return null;
    }

    if (type !== "" && !type.startsWith("video/") && type !== "application/octet-stream") {
      return null;
    }

    return type.startsWith("video/") ? blob : new Blob([blob], { type: "video/mp4" });
  } catch {
    return null;
  }
}

// Saves the file to the device with the given name.
export function saveBlob(blob: Blob, name: string): void {
  const address = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = address;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  // The browser needs a moment to start the save before the address is freed.
  window.setTimeout(() => URL.revokeObjectURL(address), 60_000);
}

// Opens the share sheet of the device with the video file in it.
export async function shareVideoFile(
  blob: Blob,
  name: string,
  title: string,
): Promise<ShareResult> {
  const file = new File([blob], name, { type: blob.type || "video/mp4" });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };

  if (typeof nav.share !== "function" || !nav.canShare?.({ files: [file] })) {
    return "unsupported";
  }

  try {
    await nav.share({ files: [file], title });
    return "shared";
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError"
      ? "canceled"
      : "failed";
  }
}

// The last way out when the file could not be fetched: the browser's own
// player in a new tab, where the person can long-press to save.
export function openInNewTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
