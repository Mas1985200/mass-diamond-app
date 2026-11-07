// src/features/video/VideoIcon.tsx
// The own icon of the "make a video" button: a film camera with a play mark.
// Same line style and size as the other home-screen icons.

export default function VideoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
      aria-hidden="true"
    >
      <rect x="3" y="5.5" width="13.5" height="13" rx="3" />
      <path d="m16.5 10.5 4.5-2.5v8l-4.5-2.5" />
      <path d="m8.8 9.6 3.4 2.4-3.4 2.4Z" />
    </svg>
  );
}
