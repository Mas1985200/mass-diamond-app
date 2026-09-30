import type { TranslationSchema } from "../types";

export const en: TranslationSchema = {
  auth: {
    brand: "Mass Diamond",

    loginSubtitle: "Sign in to continue",
    signupSubtitle: "Create your account",

    email: "Email",
    password: "Password",
    confirmPassword: "Confirm password",

    emailPlaceholder: "example@email.com",
    passwordPlaceholder: "••••••••",
    confirmPasswordPlaceholder: "••••••••",

    login: "Sign in",
    signup: "Sign up",
    loading: "Please wait...",

    continueWithGoogle: "Continue with Google",
    orDivider: "or use email",

    signupSuccess:
      "Your account was created successfully. Please check your email to confirm your account.",

    invalidCredentials: "Invalid email or password.",

    emailNotConfirmed:
      "Your email has not been confirmed yet. Please check your inbox.",

    emailAlreadyRegistered: "This email is already registered.",

    passwordTooShort: "Password must be at least 6 characters.",

    passwordMismatch: "Passwords do not match.",

    invalidEmail: "Please enter a valid email address.",

    rateLimit:
      "Too many requests. Please wait a moment and try again.",

    networkError:
      "Unable to connect to the server. Please check your internet connection.",

    providerDisabled: "Google sign-in is not enabled yet.",

    genericError:
      "An authentication error occurred. Please try again.",

    switchToSignup: "Don't have an account? Sign up",
    switchToLogin: "Already have an account? Sign in",
  },
};
