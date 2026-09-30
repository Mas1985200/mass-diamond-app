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
  | "passwordMismatch"
  | "invalidEmail"
  | "rateLimit"
  | "networkError"
  | "providerDisabled"
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

  if (
    message.includes("provider is not enabled") ||
    message.includes("unsupported provider")
  ) {
    return "providerDisabled";
  }

  if (message.includes("network")) {
    return "networkError";
  }

  return "genericError";
}

function GoogleIcon() {
  return (
    <svg
      viewBox="0 0 48 48"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

const inputClassName =
  "w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60 [-webkit-text-fill-color:#fff] [-webkit-box-shadow:0_0_0_1000px_#0b100d_inset] [-webkit-transition:background-color_9999s_ease-in-out_0s]";

export default function Auth({ supabase }: AuthProps) {
  const { t, direction } = useI18n();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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

    if (isSignUp) {
      if (password.length < 6) {
        setError("passwordTooShort");
        return;
      }

      if (password !== confirmPassword) {
        setError("passwordMismatch");
        return;
      }
    }

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

        setPassword("");
        setConfirmPassword("");
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

  const handleGoogleSignIn = async () => {
    if (loading) {
      return;
    }

    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const { error: oauthError } =
        await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: window.location.origin,
          },
        });

      if (oauthError) {
        throw oauthError;
      }
    } catch (authError) {
      setError(getAuthErrorKey(authError));
      setLoading(false);
    }
  };

  const handleModeChange = (nextIsSignUp: boolean) => {
    if (loading || nextIsSignUp === isSignUp) {
      return;
    }

    setIsSignUp(nextIsSignUp);
    setConfirmPassword("");
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
          {/* BRAND */}
          <div className="mb-7 text-center">
            <div className="mb-5 flex justify-center">
              <DiamondMark size={96} />
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-white">
              {t("auth.brand")}
            </h1>
          </div>

          {/* LOGIN / SIGNUP SEGMENTED CONTROL */}
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

          {/* SUBTITLE */}
          <p className="mb-6 text-center text-sm text-white/60">
            {isSignUp
              ? t("auth.signupSubtitle")
              : t("auth.loginSubtitle")}
          </p>

          {/* GOOGLE */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <GoogleIcon />
            <span>{t("auth.continueWithGoogle")}</span>
          </button>

          {/* DIVIDER */}
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-white/40">
              {t("auth.orDivider")}
            </span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          {/* AUTH FORM */}
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
                className={inputClassName}
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
                className={inputClassName}
              />
            </div>

            {/* CONFIRM PASSWORD (sign up only) */}
            {isSignUp && (
              <div className="space-y-2">
                <label
                  htmlFor="auth-confirm-password"
                  className="block text-sm font-medium text-white/80"
                >
                  {t("auth.confirmPassword")}
                </label>

                <input
                  id="auth-confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  dir="ltr"
                  value={confirmPassword}
                  onChange={(event) =>
                    setConfirmPassword(event.target.value)
                  }
                  minLength={6}
                  required
                  disabled={loading}
                  placeholder={t(
                    "auth.confirmPasswordPlaceholder",
                  )}
                  className={inputClassName}
                />
              </div>
            )}

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
