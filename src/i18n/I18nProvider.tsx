import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  LanguageCode,
  TextDirection,
  TranslationSchema,
} from "./types";

import { fa } from "./locales/fa";
import { en } from "./locales/en";

const STORAGE_KEY = "mass-diamond-language";

const translations: Record<"fa" | "en", TranslationSchema> = {
  fa,
  en,
};

const rtlLanguages: ReadonlySet<LanguageCode> = new Set([
  "fa",
  "ar",
]);

const supportedLanguages: readonly LanguageCode[] = [
  "fa",
  "en",
  "ar",
  "tr",
  "fr",
  "de",
  "es",
  "nl",
  "ru",
  "ko",
  "ja",
  "hi",
];

type TranslationKey = keyof TranslationSchema["auth"] extends never
  ? never
  : `auth.${keyof TranslationSchema["auth"] & string}`;

interface I18nContextValue {
  language: LanguageCode;
  direction: TextDirection;
  t: (key: TranslationKey) => string;
  setLanguage: (language: LanguageCode) => void;
}

const I18nContext = createContext<I18nContextValue | undefined>(
  undefined,
);

function isSupportedLanguage(
  value: string | null,
): value is LanguageCode {
  return (
    value !== null &&
    supportedLanguages.includes(value as LanguageCode)
  );
}

function detectLanguage(): LanguageCode {
  if (typeof window === "undefined") {
    return "en";
  }

  const savedLanguage = window.localStorage.getItem(STORAGE_KEY);

  if (isSupportedLanguage(savedLanguage)) {
    return savedLanguage;
  }

  const browserLanguages = [
    ...(navigator.languages ?? []),
    navigator.language,
  ];

  for (const browserLanguage of browserLanguages) {
    const normalized = browserLanguage
      .toLowerCase()
      .split("-")[0];

    if (isSupportedLanguage(normalized)) {
      return normalized;
    }
  }

  return "en";
}

function getDirection(language: LanguageCode): TextDirection {
  return rtlLanguages.has(language) ? "rtl" : "ltr";
}

function getTranslation(
  language: LanguageCode,
  key: TranslationKey,
): string {
  const languageTranslations =
    translations[language as "fa" | "en"] ?? translations.en;

  const [, translationKey] = key.split(".");

  if (!translationKey) {
    return key;
  }

  const value =
    languageTranslations.auth[
      translationKey as keyof TranslationSchema["auth"]
    ];

  return typeof value === "string" ? value : key;
}

export function I18nProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [language, setLanguageState] =
    useState<LanguageCode>(detectLanguage);

  const direction = getDirection(language);

  const setLanguage = (nextLanguage: LanguageCode) => {
    setLanguageState(nextLanguage);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, nextLanguage);
    }
  };

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.lang = language;
    document.documentElement.dir = direction;
  }, [language, direction]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      direction,
      t: (key) => getTranslation(language, key),
      setLanguage,
    }),
    [language, direction],
  );

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error(
      "useI18n must be used inside an I18nProvider.",
    );
  }

  return context;
}
