export type LanguageCode =
  | "fa"
  | "en"
  | "ar"
  | "tr"
  | "fr"
  | "de"
  | "es"
  | "nl"
  | "ru"
  | "ko"
  | "ja"
  | "hi";

export type TextDirection = "rtl" | "ltr";

export interface TranslationSchema {
  auth: {
    brand: string;
    loginSubtitle: string;
    signupSubtitle: string;

    email: string;
    password: string;

    emailPlaceholder: string;
    passwordPlaceholder: string;

    login: string;
    signup: string;
    loading: string;

    signupSuccess: string;

    invalidCredentials: string;
    emailNotConfirmed: string;
    emailAlreadyRegistered: string;
    passwordTooShort: string;
    invalidEmail: string;
    rateLimit: string;
    networkError: string;
    genericError: string;

    switchToSignup: string;
    switchToLogin: string;
  };
}
