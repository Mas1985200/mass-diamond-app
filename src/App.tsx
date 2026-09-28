import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "./lib/supabase";
import { I18nProvider } from "./i18n/I18nProvider";
import Auth from "./components/auth/Auth";
import DiamondMark from "./components/DiamondMark";

export default function App() {
  return (
    <I18nProvider>
      <AppGate />
    </I18nProvider>
  );
}

function AppGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) {
        return;
      }

      setSession(data.session);
      setIsLoadingSession(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
      },
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (isLoadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-text-subtle text-sm">
        ...
      </div>
    );
  }

  if (!session) {
    return <Auth supabase={supabase} />;
  }

  return <HomeScreen />;
}

function HomeScreen() {
  const quickActions = [
    { label: "هر چیزی بپرس", icon: <ChatIcon /> },
    { label: "جستجو در وب", icon: <SearchIcon /> },
    { label: "ساخت تصویر", icon: <ImageIcon /> },
    { label: "کمک آموزشی", icon: <LearnIcon /> },
    { label: "پیدا کردن محصول", icon: <BagIcon /> },
    { label: "جستجوی ملک", icon: <HomeIcon /> },
  ];

  return (
    <div className="min-h-screen flex flex-col items-center justify-between px-4 py-10 text-center relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(57,255,136,0.10),transparent_60%)]" />

      <div className="flex-1 flex flex-col items-center justify-center gap-6 z-10 w-full">
        <DiamondMark size={140} />

        <div>
          <h1 className="text-3xl font-bold leading-tight">
            Hello, I'm <span className="text-primary">Mass Diamond</span>
          </h1>
          <p className="text-text-subtle mt-2">
            Your Intelligent Assistant for a Bigger Tomorrow
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 w-full max-w-md mt-4">
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="md-glass rounded-full px-4 py-3 flex items-center gap-2 text-sm text-text transition-colors duration-180 hover:border-[rgba(57,255,136,0.4)]"
            >
              <span className="text-primary shrink-0">{action.icon}</span>
              <span className="truncate">{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        className="w-full max-w-xl md-glass rounded-full px-3 py-2 flex items-center gap-2 z-10"
        dir="rtl"
      >
        <button
          type="button"
          aria-label="پیوست فایل"
          className="w-9 h-9 shrink-0 flex items-center justify-center text-text-subtle transition-colors hover:text-primary"
        >
          <AttachIcon />
        </button>
        <input
          type="text"
          placeholder="چطور می‌تونم کمکت کنم؟"
          className="flex-1 bg-transparent outline-none text-text placeholder:text-text-subtle text-sm"
        />
        <button
          type="button"
          aria-label="ورودی صوتی"
          className="w-9 h-9 shrink-0 flex items-center justify-center text-text-subtle transition-colors hover:text-primary"
        >
          <MicIcon />
        </button>
        <button
          type="button"
          aria-label="ارسال"
          className="w-10 h-10 shrink-0 rounded-full bg-primary text-background flex items-center justify-center"
        >
          <SendIcon />
        </button>
      </div>
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
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.2-3.2" />
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
