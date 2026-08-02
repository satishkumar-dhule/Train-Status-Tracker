import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { LANGS } from "./types";
import { LANGUAGES } from "./languages";
import { DICTIONARY } from "./dictionary";
import { translate } from "./translate";
import type { Key, LangCode } from "./types";

const STORAGE_KEY = "terminal-track.lang";

export type TranslateFn = (
  key: Key,
  params?: Record<string, string | number>,
) => string;

export interface I18nValue {
  lang: LangCode;
  dir: "ltr" | "rtl";
  setLang: (lang: LangCode) => void;
  t: TranslateFn;
  languages: typeof LANGUAGES;
}

const Ctx = createContext<I18nValue | null>(null);

function loadLang(): LangCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (LANGS as readonly string[]).includes(stored)) {
      return stored as LangCode;
    }
  } catch {
    // localStorage unavailable (SSR/private mode) — fall through
  }
  try {
    const match = /^(hi|bn|te|ta|mr|gu|kn|ml|pa|or|ur|en)\b/.exec(
      navigator.language.toLowerCase(),
    );
    if (match) return match[1] as LangCode;
  } catch {
    // navigator unavailable
  }
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<LangCode>(loadLang);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // storage full or unavailable — non-fatal
    }
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = LANGUAGES[lang].dir;
  }, [lang]);

  const t = useCallback<TranslateFn>(
    (key, params) => translate(DICTIONARY, lang, key, params),
    [lang],
  );

  const value = useMemo<I18nValue>(
    () => ({ lang, dir: LANGUAGES[lang].dir, setLang, t, languages: LANGUAGES }),
    [lang, t],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used within <I18nProvider>");
  return ctx;
}
