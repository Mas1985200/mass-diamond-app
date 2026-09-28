import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { useI18n } from "../../i18n/I18nProvider";
import DiamondMark from "../../components/DiamondMark";

export interface AuthProps {
  readonly supabase: SupabaseClient;
}

type AuthErrorKey =
  | "invalidCredentials"
  | "emailNotConfirmed"
  | "emailAlreadyRegistered"
  | "passwordTooShort"
  | "invalidEmail"
  | "rateLimit"
  | "networkError"
  | "genericError";

function getAuthErrorKey(error: unknown): AuthErrorKey {
  const message =
    error instanceof Error ? error.message.toLowerCase() : "";

  if (
    message.includes("invalid login credentials") ||
    message.includes("invalid credentials")
  ) {
    return "invalidCredentials";
  }

  if (message.includes("email not confirmed")) {
    return "emailNotConfirmed";
  }

  if (message.includes("user already registered")) {
    return "emailAlreadyRegistered";
  }

  if (message.includes("password should be at least")) {
    return "passwordTooShort";
  }

  if (
    message.includes("unable to validate email address") ||
    message.includes("invalid email")
  ) {
    return "invalidEmail";
  }

  if (
    message.includes("email rate limit exceeded") ||
    message.includes("rate limit")
  ) {
    return "rateLimit";
  }

  if (message.includes("network")) {
    return "networkError";
  }

  return "genericError";
}

export default function Auth({ supabase }: AuthProps) {
  const { t, direction } = useI18n();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] =
    useState<AuthErrorKey | null>(null);
  const [message, setMessage] =
    useState<string | null>(null);

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (loading) {
      return;
    }

    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const normalizedEmail = email.trim();

      if (isSignUp) {
        const { error: signUpError } =
          await supabase.auth.signUp({
            email: normalizedEmail,
            password,
          });

        if (signUpError) {
          throw signUpError;
        }

        setMessage(t("auth.signupSuccess"));
      } else {
        const { error: signInError } =
          await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password,
          });

        if (signInError) {
          throw signInError;
        }
      }
    } catch (authError) {
      setError(getAuthErrorKey(authError));
    } finally {
      setLoading(false);
    }
  };

  const handleModeChange = (nextIsSignUp: boolean) => {
    if (loading || nextIsSignUp === isSignUp) {
      return;
    }

    setIsSignUp(nextIsSignUp);
    setError(null);
    setMessage(null);
  };

  return (
    <main
      dir={direction}
      className="flex min-h-screen w-full items-center justify-center bg-transparent px-4 py-8"
    >
      <section className="w-full max-w-md">
        <div className="md-glass md-neon-surface rounded-3xl p-6 sm:p-8">
          {/* =====================================================
              BRAND
          ====================================================== */}
          <div className="mb-7 text-center">
            <div className="mb-5 flex justify-center">
              <DiamondMark size={96} />
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-white">
              {t("auth.brand")}
            </h1>
          </div>

          {/* =====================================================
              LOGIN / SIGNUP SEGMENTED CONTROL
          ====================================================== */}
          <div
            role="tablist"
            aria-label={t("auth.brand")}
            className="mb-7 grid grid-cols-2 rounded-2xl border border-white/10 bg-black/20 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!isSignUp}
              onClick={() => handleModeChange(false)}
              disabled={loading}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 ${
                !isSignUp
                  ? "bg-primary text-black shadow-[0_0_18px_rgba(57,255,136,0.16)]"
                  : "text-white/55 hover:bg-white/5 hover:text-white/85"
              }`}
            >
              {t("auth.login")}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={isSignUp}
              onClick={() => handleModeChange(true)}
              disabled={loading}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 ${
                isSignUp
                  ? "bg-primary text-black shadow-[0_0_18px_rgba(57,255,136,0.16)]"
                  : "text-white/55 hover:bg-white/5 hover:text-white/85"
              }`}
            >
              {t("auth.signup")}
            </button>
          </div>

          {/* =====================================================
              SUBTITLE
          ====================================================== */}
          <p className="mb-6 text-center text-sm text-white/60">
            {isSignUp
              ? t("auth.signupSubtitle")
              : t("auth.loginSubtitle")}
          </p>

          {/* =====================================================
              AUTH FORM
          ====================================================== */}
          <form
            onSubmit={handleSubmit}
            className="space-y-5"
            noValidate
          >
            {/* EMAIL */}
            <div className="space-y-2">
              <label
                htmlFor="auth-email"
                className="block text-sm font-medium text-white/80"
              >
                {t("auth.email")}
              </label>

              <input
                id="auth-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                dir="ltr"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                required
                disabled={loading}
                placeholder={t("auth.emailPlaceholder")}
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60 [-webkit-text-fill-color:#fff] [-webkit-box-shadow:0_0_0_1000px_#0b100d_inset] [-webkit-transition:background-color_9999s_ease-in-out_0s]"
              />
            </div>

            {/* PASSWORD */}
            <div className="space-y-2">
              <label
                htmlFor="auth-password"
                className="block text-sm font-medium text-white/80"
              >
                {t("auth.password")}
              </label>

              <input
                id="auth-password"
                name="password"
                type="password"
                autoComplete={
                  isSignUp
                    ? "new-password"
                    : "current-password"
                }
                dir="ltr"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                minLength={6}
                required
                disabled={loading}
                placeholder={t("auth.passwordPlaceholder")}
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60 [-webkit-text-fill-color:#fff] [-webkit-box-shadow:0_0_0_1000px_#0b100d_inset] [-webkit-transition:background-color_9999s_ease-in-out_0s]"
              />
            </div>

            {/* ERROR */}
            {error && (
              <div
                role="alert"
                className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm leading-6 text-red-300"
              >
                {t(`auth.${error}`)}
              </div>
            )}

            {/* SUCCESS MESSAGE */}
            {message && (
              <div
                role="status"
                className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm leading-6 text-primary"
              >
                {message}
              </div>
            )}

            {/* SUBMIT */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-black shadow-[0_0_20px_rgba(57,255,136,0.16)] transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? t("auth.loading")
                : isSignUp
                  ? t("auth.signup")
                  : t("auth.login")}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
