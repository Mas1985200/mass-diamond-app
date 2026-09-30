import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "./lib/supabase";
import { I18nProvider } from "./i18n/I18nProvider";
import Auth from "./components/auth/Auth";
import ChatScreen from "./components/chat/ChatScreen";

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

  return <ChatScreen />;
}
