import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { supabase } from "../../lib/supabase";
import { useChat } from "../../hooks/useChat";
import type { ChatErrorCode } from "../../lib/chatClient";
import DiamondMark from "../DiamondMark";
import MarkdownText from "./MarkdownText";

const ERROR_MESSAGES: Record<ChatErrorCode, string> = {
  AUTH_REQUIRED: "نشست شما منقضی شده است. لطفاً دوباره وارد شوید.",
  CONVERSATION_NOT_FOUND:
    "این گفتگو پیدا نشد. پیام بعدی شما گفتگوی جدیدی را شروع می‌کند.",
  AI_PROVIDER_ERROR:
    "دستیار هوشمند در حال حاضر پاسخ نمی‌دهد. لطفاً دوباره تلاش کنید.",
  METHOD_NOT_ALLOWED: "درخواست نامعتبر بود. لطفاً دوباره تلاش کنید.",
  INTERNAL_ERROR: "خطای داخلی سرور رخ داد. لطفاً دوباره تلاش کنید.",
  NETWORK_ERROR:
    "اتصال به سرور برقرار نشد. لطفاً اینترنت خود را بررسی کنید.",
  UNKNOWN_ERROR: "خطای ناشناخته‌ای رخ داد. لطفاً دوباره تلاش کنید.",
};

const DEFAULT_PLACEHOLDER = "چطور می‌تونم کمکت کنم؟";
const STICK_THRESHOLD_PX = 80;
const SEND_IMAGE_SRC = "/send-diamond-full.png";

interface QuickAction {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly enabled: boolean;
  readonly highlight?: boolean;
  readonly icon: ReactNode;
}

const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: "ask",
    label: "هر چیزی بپرس",
    hint: DEFAULT_PLACEHOLDER,
    enabled: true,
    icon: <ChatIcon />,
  },
  {
    id: "web",
    label: "جستجو در وب",
    hint: "چه چیزی را جستجو کنم؟",
    enabled: false,
    highlight: true,
    icon: <SearchIcon />,
  },
  {
    id: "image",
    label: "ساخت تصویر",
    hint: "چه تصویری بسازم؟",
    enabled: false,
    icon: <ImageIcon />,
  },
  {
    id: "learn",
    label: "کمک آموزشی",
    hint: "چه چیزی یاد بگیریم؟",
    enabled: true,
    icon: <LearnIcon />,
  },
  {
    id: "product",
    label: "پیدا کردن محصول",
    hint: "دنبال چه محصولی هستی؟",
    enabled: true,
    icon: <BagIcon />,
  },
  {
    id: "property",
    label: "جستجوی ملک",
    hint: "دنبال چه ملکی هستی؟",
    enabled: true,
    icon: <HomeIcon />,
  },
];

const DIAMOND_FADE_MASK =
  "radial-gradient(ellipse at center, #000 58%, transparent 100%)";

const SEARCH_GLOW_CSS = `
@keyframes md-search-glow {
  0%, 100% { box-shadow: 0 0 10px rgba(57,255,136,0.18); }
  50% { box-shadow: 0 0 22px rgba(57,255,136,0.42); }
}
.md-search-highlight {
  background: linear-gradient(135deg, rgba(57,255,136,0.20), rgba(57,255,136,0.04));
  border-color: rgba(57,255,136,0.55);
  animation: md-search-glow 2.6s ease-in-out infinite;
}
@keyframes md-thinking {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
  40% { opacity: 1; transform: scale(1); }
}
.md-thinking-dot {
  animation: md-thinking 1.2s ease-in-out infinite;
}
.md-prose { width: 100%; }
.md-prose ol,
.md-prose ul {
  padding-inline-start: 1.5rem !important;
  margin-inline-start: 0 !important;
  margin-block: 0.4rem !important;
}
.md-prose li {
  padding-inline-start: 0.1rem !important;
  margin-block: 0.2rem !important;
}
.md-prose p,
.md-prose li {
  line-height: 1.75 !important;
}
.md-prose p {
  margin-block: 0.4rem !important;
}
@media (prefers-reduced-motion: reduce) {
  .md-search-highlight { animation: none; }
  .md-thinking-dot { animation: none; opacity: 0.7; }
}
`;

const CLOCK_RE =
  /:::md-clock~([^~\s]+)~([A-Za-z0-9_\/+-]+)~(fa|en):::/g;
const PENDING_MARKER_RE = /:{2,3}(?:m[^\n]*)?$/;

type ContentPart =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "clock";
      readonly iso: string;
      readonly zone: string;
      readonly lang: "fa" | "en";
    };

function splitAssistantContent(raw: string): ContentPart[] {
  const parts: ContentPart[] = [];
  let cursor = 0;

  for (const match of raw.matchAll(CLOCK_RE)) {
    const index = match.index ?? 0;
    const before = raw.slice(cursor, index).trim();

    if (before) {
      parts.push({ kind: "text", text: before });
    }

    parts.push({
      kind: "clock",
      iso: match[1],
      zone: match[2],
      lang: match[3] === "en" ? "en" : "fa",
    });

    cursor = index + match[0].length;
  }

  const rest = raw.slice(cursor).replace(PENDING_MARKER_RE, "").trim();

  if (rest) {
    parts.push({ kind: "text", text: rest });
  }

  return parts;
}

interface ClockInfo {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly digital: string;
  readonly primaryDate: string;
  readonly secondaryDate: string;
  readonly zone: string;
}

function describeClock(
  iso: string,
  zone: string,
  lang: "fa" | "en",
): ClockInfo | null {
  try {
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    let timeZone = zone;

    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
    } catch {
      timeZone = "UTC";
    }

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);

    const read = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? "0");

    const digital = new Intl.DateTimeFormat(
      lang === "fa" ? "fa-IR" : "en-GB",
      { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    ).format(date);

    const primaryDate =
      lang === "fa"
        ? new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
            timeZone,
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(date)
        : new Intl.DateTimeFormat("en-US", {
            timeZone,
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          }).format(date);

    const secondaryDate =
      lang === "fa"
        ? new Intl.DateTimeFormat("fa-IR-u-ca-gregory", {
            timeZone,
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(date)
        : "";

    return {
      hours: read("hour"),
      minutes: read("minute"),
      seconds: read("second"),
      digital,
      primaryDate,
      secondaryDate,
      zone: timeZone,
    };
  } catch {
    return null;
  }
}

function ClockFace({
  hours,
  minutes,
  seconds,
}: {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}) {
  const hourAngle = ((hours % 12) + minutes / 60) * 30;
  const minuteAngle = (minutes + seconds / 60) * 6;
  const secondAngle = seconds * 6;
  const ticks = Array.from({ length: 12 }, (_, index) => index);

  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="h-24 w-24 shrink-0 text-primary"
      style={{ filter: "drop-shadow(0 0 6px rgba(57,255,136,0.35))" }}
    >
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="rgba(57,255,136,0.05)"
        stroke="currentColor"
        strokeOpacity="0.6"
        strokeWidth="1.5"
      />

      {ticks.map((index) => (
        <line
          key={index}
          x1="50"
          y1="8"
          x2="50"
          y2={index % 3 === 0 ? 16 : 12}
          stroke="currentColor"
          strokeOpacity="0.85"
          strokeWidth={index % 3 === 0 ? 2 : 1}
          strokeLinecap="round"
          transform={`rotate(${index * 30} 50 50)`}
        />
      ))}

      <line
        x1="50"
        y1="50"
        x2="50"
        y2="29"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        transform={`rotate(${hourAngle} 50 50)`}
      />
      <line
        x1="50"
        y1="50"
        x2="50"
        y2="18"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        transform={`rotate(${minuteAngle} 50 50)`}
      />
      <line
        x1="50"
        y1="56"
        x2="50"
        y2="14"
        stroke="currentColor"
        strokeOpacity="0.7"
        strokeWidth="1"
        strokeLinecap="round"
        transform={`rotate(${secondAngle} 50 50)`}
      />
      <circle cx="50" cy="50" r="2.6" fill="currentColor" />
    </svg>
  );
}

function ClockCard({
  iso,
  zone,
  lang,
}: {
  readonly iso: string;
  readonly zone: string;
  readonly lang: "fa" | "en";
}) {
  const info = describeClock(iso, zone, lang);

  if (!info) {
    return null;
  }

  return (
    <div
      dir={lang === "fa" ? "rtl" : "ltr"}
      className="md-glass my-3 flex w-full max-w-xs items-center gap-4 rounded-2xl px-4 py-3"
    >
      <ClockFace
        hours={info.hours}
        minutes={info.minutes}
        seconds={info.seconds}
      />

      <div className="min-w-0">
        <div className="text-3xl font-bold leading-none tabular-nums text-primary">
          {info.digital}
        </div>
        <div className="mt-2 text-sm leading-6 text-text">
          {info.primaryDate}
        </div>
        {info.secondaryDate && (
          <div className="text-xs leading-5 text-text-subtle">
            {info.secondaryDate}
          </div>
        )}
        <div dir="ltr" className="mt-1 text-[11px] text-text-subtle">
          {info.zone}
        </div>
      </div>
    </div>
  );
}

export default function ChatScreen() {
  const {
    messages,
    isSending,
    isStreaming,
    error,
    canRetry,
    sendMessage,
    retry,
    reset,
  } = useChat();

  const [draft, setDraft] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const chatHistoryPushedRef = useRef(false);
  const stickToBottomRef = useRef(true);

  const hasMessages = messages.length > 0;
  const canSend = draft.trim().length > 0 && !isSending;
  const showThinking = isSending && !isStreaming;

  const activeAction =
    QUICK_ACTIONS.find((action) => action.id === activeId) ?? null;

  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport) {
      return;
    }

    const update = () => {
      setViewportHeight(viewport.height);
      window.scrollTo(0, 0);
    };

    update();

    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);

    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  useEffect(() => {
    if (hasMessages) {
      return;
    }

    const element = mainRef.current;

    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [viewportHeight, hasMessages]);

  useEffect(() => {
    if (hasMessages && !chatHistoryPushedRef.current) {
      window.history.pushState({ mdChat: true }, "");
      chatHistoryPushedRef.current = true;
    }

    if (!hasMessages) {
      chatHistoryPushedRef.current = false;
      stickToBottomRef.current = true;
      setShowJump(false);
    }
  }, [hasMessages]);

  useEffect(() => {
    const handlePopState = () => {
      if (!chatHistoryPushedRef.current) {
        return;
      }

      chatHistoryPushedRef.current = false;
      reset();
      setDraft("");
      setActiveId(null);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [reset]);

  useEffect(() => {
    const element = inputRef.current;

    if (!element) {
      return;
    }

    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [draft, activeId]);

  useEffect(() => {
    if (!hasMessages || !stickToBottomRef.current) {
      return;
    }

    const element = mainRef.current;

    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, showThinking, error, hasMessages, viewportHeight]);

  const handleScroll = () => {
    const element = mainRef.current;

    if (!element || !hasMessages) {
      return;
    }

    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    const atBottom = distance < STICK_THRESHOLD_PX;

    stickToBottomRef.current = atBottom;
    setShowJump(!atBottom);
  };

  const handleJumpToBottom = () => {
    const element = mainRef.current;

    stickToBottomRef.current = true;
    setShowJump(false);

    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  };

  const handleSend = async () => {
    const text = draft.trim();

    if (!text || isSending) {
      return;
    }

    stickToBottomRef.current = true;
    setShowJump(false);
    setDraft("");
    setActiveId(null);
    await sendMessage(text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleQuickAction = (action: QuickAction) => {
    if (!action.enabled) {
      return;
    }

    setActiveId(action.id === "ask" ? null : action.id);
    inputRef.current?.focus();
  };

  const handleBack = () => {
    if (chatHistoryPushedRef.current) {
      window.history.back();
      return;
    }

    reset();
    setDraft("");
    setActiveId(null);
  };

  const handleSignOut = () => {
    void supabase.auth.signOut();
  };

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{
        height: viewportHeight !== null ? `${viewportHeight}px` : "100dvh",
      }}
    >
      <style>{SEARCH_GLOW_CSS}</style>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(57,255,136,0.10),transparent_60%)]" />

      <header
        className="z-10 flex items-center justify-between px-3 py-1"
        dir="ltr"
      >
        <button
          type="button"
          onClick={handleSignOut}
          aria-label="خروج از حساب"
          className="flex h-10 w-10 items-center justify-center rounded-full text-text-subtle transition-colors hover:text-primary"
        >
          <SignOutIcon />
        </button>

        {hasMessages ? (
          <button
            type="button"
            onClick={handleBack}
            aria-label="بازگشت به صفحه اصلی"
            className="md-glass flex h-10 items-center gap-2 rounded-full px-4 text-sm text-primary transition-colors hover:border-[rgba(57,255,136,0.4)]"
          >
            <span>بازگشت</span>
            <BackIcon />
          </button>
        ) : (
          <span className="h-10 w-10" />
        )}
      </header>

      <main
        ref={mainRef}
        onScroll={handleScroll}
        className="z-10 flex-1 overflow-y-auto px-4"
      >
        {hasMessages ? (
          <ul
            dir="ltr"
            className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-4"
          >
            {messages.map((message) =>
              message.role === "user" ? (
                <li key={message.id} className="flex justify-end">
                  <div
                    dir="auto"
                    className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl border border-[rgba(57,255,136,0.35)] bg-[rgba(57,255,136,0.08)] px-4 py-2.5 text-[15px] leading-7 text-text"
                  >
                    {message.content}
                  </div>
                </li>
              ) : (
                <li key={message.id} className="w-full">
                  <div className="md-prose w-full px-1 text-[15px] text-text">
                    {splitAssistantContent(message.content).map(
                      (part, index) =>
                        part.kind === "clock" ? (
                          <ClockCard
                            key={`clock-${index}`}
                            iso={part.iso}
                            zone={part.zone}
                            lang={part.lang}
                          />
                        ) : (
                          <MarkdownText key={`text-${index}`} text={part.text} />
                        ),
                    )}
                  </div>
                </li>
              ),
            )}

            {showThinking && (
              <li className="flex w-full justify-start" dir="rtl" aria-live="polite">
                <div className="flex items-center gap-1.5 px-1 py-2" dir="ltr">
                  <span
                    className="md-thinking-dot h-2 w-2 rounded-full bg-primary"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="md-thinking-dot h-2 w-2 rounded-full bg-primary"
                    style={{ animationDelay: "180ms" }}
                  />
                  <span
                    className="md-thinking-dot h-2 w-2 rounded-full bg-primary"
                    style={{ animationDelay: "360ms" }}
                  />
                </div>
              </li>
            )}
          </ul>
        ) : (
          <div className="flex min-h-full flex-col items-center justify-between gap-3 pb-2 text-center">
            <div className="-mt-4 flex flex-col items-center gap-3">
              <div
                style={{
                  WebkitMaskImage: DIAMOND_FADE_MASK,
                  maskImage: DIAMOND_FADE_MASK,
                }}
              >
                <DiamondMark size={92} />
              </div>

              <div>
                <h1 className="text-2xl font-bold leading-tight">
                  Hello, I'm <span className="text-primary">Mass Diamond</span>
                </h1>
                <p className="mt-1.5 text-sm text-text-subtle">
                  Your Intelligent Assistant for a Bigger Tomorrow
                </p>
                <p
                  dir="rtl"
                  className="mx-auto mt-2 max-w-xs text-xs leading-5 text-text-subtle"
                >
                  سؤال بپرس، یاد بگیر، محصول و ملک پیدا کن. پیامت را در کادر
                  پایین بنویس.
                </p>
              </div>
            </div>

            <div className="grid w-full max-w-md grid-cols-2 gap-2.5">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => handleQuickAction(action)}
                  disabled={!action.enabled}
                  className={`md-glass flex items-center gap-2 rounded-full px-3.5 py-2.5 text-[13px] text-text transition-colors duration-180 hover:border-[rgba(57,255,136,0.4)] disabled:cursor-not-allowed ${
                    action.highlight
                      ? "md-search-highlight disabled:opacity-90"
                      : "disabled:opacity-40"
                  }`}
                >
                  <span className="shrink-0 text-primary">{action.icon}</span>
                  <span className="truncate">{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="relative z-10 px-4 pb-4 pt-2">
        {showJump && hasMessages && (
          <button
            type="button"
            onClick={handleJumpToBottom}
            aria-label="رفتن به آخرین پیام"
            className="md-glass absolute -top-12 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full text-primary transition-colors hover:border-[rgba(57,255,136,0.4)]"
          >
            <DownIcon />
          </button>
        )}

        {error && (
          <div
            role="alert"
            dir="rtl"
            className="mx-auto mb-2 flex w-full max-w-xl items-center justify-between gap-3 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm leading-6 text-red-300"
          >
            <span>{ERROR_MESSAGES[error.code]}</span>

            {canRetry && (
              <button
                type="button"
                onClick={() => void retry()}
                disabled={isSending}
                className="shrink-0 rounded-lg border border-red-300/30 px-3 py-1 text-xs font-semibold text-red-200 transition-colors hover:bg-red-300/10 disabled:opacity-50"
              >
                تلاش دوباره
              </button>
            )}
          </div>
        )}

        <div
          className="md-glass mx-auto w-full max-w-xl rounded-3xl px-3 py-2"
          dir="rtl"
        >
          {activeAction && (
            <div className="flex items-center pb-1">
              <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(57,255,136,0.35)] bg-[rgba(57,255,136,0.08)] px-3 py-1 text-xs text-primary">
                <span className="shrink-0">{activeAction.icon}</span>
                <span>{activeAction.label}</span>
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  aria-label="لغو انتخاب"
                  className="flex h-5 w-5 items-center justify-center rounded-full text-base leading-none text-text-subtle transition-colors hover:text-primary"
                >
                  ×
                </button>
              </span>
            </div>
          )}

          <div className="flex items-end gap-2">
            <button
              type="button"
              disabled
              aria-label="پیوست فایل"
              className="flex h-9 w-9 shrink-0 items-center justify-center text-text-subtle opacity-40"
            >
              <AttachIcon />
            </button>

            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              dir="auto"
              enterKeyHint="send"
              placeholder={activeAction?.hint ?? DEFAULT_PLACEHOLDER}
              style={{ outline: "none", boxShadow: "none" }}
              className="max-h-40 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-6 text-text placeholder:text-text-subtle"
            />

            <button
              type="button"
              disabled
              aria-label="ورودی صوتی"
              className="flex h-9 w-9 shrink-0 items-center justify-center text-text-subtle opacity-40"
            >
              <MicIcon />
            </button>

            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSend}
              aria-label="ارسال"
              className="flex h-10 w-[70px] shrink-0 items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              <img
                src={SEND_IMAGE_SRC}
                alt=""
                draggable={false}
                className="h-full w-full select-none object-contain"
              />
            </button>
          </div>
        </div>
      </footer>
    </div>
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

function AttachIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M17.5 8.5 9.6 16.4a3.2 3.2 0 0 1-4.5-4.5l8-8a2.2 2.2 0 0 1 3.1 3.1l-7.6 7.6a1.2 1.2 0 0 1-1.7-1.7l6.9-6.9" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M9 4H5v16h4" />
      <path d="m16 8 4 4-4 4" />
      <path d="M20 12H9" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function DownIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 5h16v11H8l-4 4V5Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="10.5" cy="10.5" r="7" />
      <ellipse cx="10.5" cy="10.5" rx="3" ry="7" />
      <path d="M3.5 10.5h14" />
      <path d="m20.5 20.5-5.1-5.1" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="4" width="18" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </svg>
  );
}

function LearnIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M3 8 12 4l9 4-9 4-9-4Z" />
      <path d="M7 10.5v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M6 8h12l-1 12H7L6 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg {...iconProps()}>
      <path d="m4 11 8-7 8 7" />
      <path d="M6 10v9h12v-9" />
    </svg>
  );
}
