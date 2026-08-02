import type { Dictionary, Key, LangCode } from "./types";

export function translate(
  dictionary: Dictionary,
  lang: LangCode,
  key: Key,
  params?: Record<string, string | number>,
): string {
  const tpl = dictionary[lang][key] ?? dictionary.en[key];
  if (!params) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (match, p: string) =>
    p in params ? String(params[p]) : match,
  );
}
