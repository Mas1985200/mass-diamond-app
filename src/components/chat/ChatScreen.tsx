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

interface QuickAction {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly enabled: boolean;
  readonly highlight?: boolean;
  readonly icon: ReactNode;
}

const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: "ask",
    label: "هر چیزی بپرس",
    prompt: "",
    enabled: true,
    icon: <ChatIcon />,
  },
  {
    id: "web",
    label: "جستجو در وب",
    prompt: "",
    enabled: false,
    highlight: true,
    icon: <SearchIcon />,
  },
  {
    id: "image",
    label: "ساخت تصویر",
    prompt: "",
    enabled: false,
    icon: <ImageIcon />,
  },
  {
    id: "learn",
    label: "کمک آموزشی",
    prompt: "می‌خواهم درباره‌ی این موضوع یاد بگیرم: ",
    enabled: true,
    icon: <LearnIcon />,
  },
  {
    id: "product",
    label: "پیدا کردن محصول",
    prompt: "دنبال این محصول هستم: ",
    enabled: true,
    icon: <BagIcon />,
  },
  {
    id: "property",
    label: "جستجوی ملک",
    prompt: "دنبال ملکی با این مشخصات هستم: ",
    enabled: true,
    icon: <HomeIcon />,
  },
];

const HIGHLIGHT_STYLE = {
  background:
    "linear-gradient(135deg, rgba(57,255,136,0.16), rgba(57,255,136,0.03))",
  borderColor: "rgba(57,255,136,0.45)",
  boxShadow: "0 0 18px rgba(57,255,136,0.18)",
} as const;

export default function ChatScreen() {
  const { messages, isSending, error, canRetry, sendMessage, retry, reset } =
    useChat();

  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = inputRef.current;

    if (!element) {
      return;
    }

    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending, error]);

  const handleSend = async () => {
    const text = draft.trim();

    if (!text || isSending) {
      return;
    }

    setDraft("");
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

    setDraft(action.prompt);
    inputRef.current?.focus();
  };

  const handleNewChat = () => {
    reset();
    setDraft("");
  };

  const handleSignOut = () => {
    void supabase.auth.signOut();
  };

  const hasMessages = messages.length > 0;
  const canSend = draft.trim().length > 0 && !isSending;

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{ height: "100dvh" }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(57,255,136,0.10),transparent_60%)]" />

      <header
        className="z-10 flex items-center justify-between px-3 py-2"
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
            onClick={handleNewChat}
            aria-label="گفتگوی جدید"
            className="flex h-10 w-10 items-center justify-center rounded-full text-text-subtle transition-colors hover:text-primary"
          >
            <NewChatIcon />
          </button>
        ) : (
          <span className="h-10 w-10" />
        )}
      </header>

      <main className="z-10 flex-1 overflow-y-auto px-4">
        {hasMessages ? (
          <ul dir="ltr" className="flex flex-col gap-3 py-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  dir="auto"
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-7 ${
                    message.role === "user"
                      ? "bg-primary text-background"
                      : "md-glass text-text"
                  }`}
                >
                  {message.content}
                </div>
              </li>
            ))}

            {isSending && (
              <li className="flex justify-start" aria-live="polite">
                <div className="md-glass animate-pulse rounded-2xl px-4 py-3 text-sm text-text-subtle">
                  ...
                </div>
              </li>
            )}

            <div ref={bottomRef} />
          </ul>
        ) : (
          <div className="flex min-h-full flex-col items-center justify-center gap-6 py-6 text-center">
            <DiamondMark size={110} />

            <div>
              <h1 className="text-3xl font-bold leading-tight">
                Hello, I'm <span className="text-primary">Mass Diamond</span>
              </h1>
              <p className="mt-2 text-text-subtle">
                Your Intelligent Assistant for a Bigger Tomorrow
              </p>
              <p
                dir="rtl"
                className="mx-auto mt-3 max-w-xs text-xs leading-6 text-text-subtle"
              >
                به سؤال‌هایت پاسخ می‌دهم، در یادگیری کمکت می‌کنم و محصول یا ملک
                مناسب را پیدا می‌کنم. برای شروع، پیامت را در کادر پایین بنویس.
              </p>
            </div>

            <div className="mt-2 grid w-full max-w-md grid-cols-2 gap-3">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => handleQuickAction(action)}
                  disabled={!action.enabled}
                  style={action.highlight ? HIGHLIGHT_STYLE : undefined}
                  className={`md-glass flex items-center gap-2 rounded-full px-4 py-3 text-sm text-text transition-colors duration-180 hover:border-[rgba(57,255,136,0.4)] disabled:cursor-not-allowed ${
                    action.highlight ? "disabled:opacity-70" : "disabled:opacity-40"
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

      <footer className="z-10 px-4 pb-4 pt-2">
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
          className="md-glass mx-auto flex w-full max-w-xl items-end gap-2 rounded-3xl px-3 py-2"
          dir="rtl"
        >
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
            placeholder="چطور می‌تونم کمکت کنم؟"
            className="max-h-40 flex-1 resize-none bg-transparent py-2 text-sm leading-6 text-text outline-none placeholder:text-text-subtle"
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
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-background transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendIcon />
          </button>
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

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 -rotate-90">
      <path d="M3 11.5 20 3l-4.5 17-4-7-7.5-1.5Z" />
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

function NewChatIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
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
      <path d="m20.5 20.5-5.1-5.1" />
      <path
        d="M10.5 6.8l.95 2.75 2.75.95-2.75.95-.95 2.75-.95-2.75-2.75-.95 2.75-.95.95-2.75Z"
        fill="currentColor"
        stroke="none"
      />
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
