import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "./lib/supabase";
import { I18nProvider } from "./i18n/I18nProvider";
import Auth from "./components/auth/Auth";
import ChatScreen from "./components/chat/ChatScreen";

// A blocked or very slow network must never keep the app on the loading dots.
const SESSION_WAIT_MS = 6000;

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

    const finish = (next: Session | null) => {
      if (!isMounted) {
        return;
      }

      if (next) {
        setSession(next);
      }

      setIsLoadingSession(false);
    };

    const timer = window.setTimeout(() => finish(null), SESSION_WAIT_MS);

    supabase.auth
      .getSession()
      .then(({ data }) => finish(data.session))
      .catch(() => finish(null))
      .finally(() => window.clearTimeout(timer));

    // A session that arrives late still takes the person into the app.
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (isMounted) {
          setSession(nextSession);
        }
      },
    );

    return () => {
      isMounted = false;
      window.clearTimeout(timer);
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

  return <ChatScreen />;
}
