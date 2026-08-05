export const LANGS = [
  "en",
  "hi",
  "bn",
  "te",
  "ta",
  "mr",
  "gu",
  "kn",
  "ml",
  "pa",
  "or",
  "ur",
] as const;

export type LangCode = (typeof LANGS)[number];

export const KEYS = [
  "app.title",
  "app.tagline",
  "label.trainNumber",
  "label.departureDate",
  "label.recent",
  "label.searchTitle",
  "label.today",
  "label.tomorrow",
  "label.yesterday",
  "label.currentStation",
  "label.duration",
  "label.stations",
  "label.view",
  "placeholder.trainNumber",
  "action.search",
  "action.retry",
  "action.abortReturn",
  "action.reconfigure",
  "status.onTime",
  "status.lateMinutes",
  "status.updated",
  "status.live",
  "status.refreshing",
  "view.timeline",
  "view.track",
  "error.signalLost",
  "error.fallback",
  "error.trainNotFound",
  "error.providerUnreachable",
  "meta.platform",
  "meta.kilometers",
  "meta.halt",
  "meta.day",
  "label.selectLanguage",
  "label.display",
  "display.default",
  "display.highContrast",
  "display.bigFonts",
  "display.blackWhite",
  "hint.valid",
  "hint.invalid",
  "hint.submit",
  "hint.pickSuggestion",
  "hint.noMatch",
  "hint.invalidFormat",
  "error404.title",
  "error404.message",
] as const;

export type Key = (typeof KEYS)[number];

export type Dictionary = Record<LangCode, Record<Key, string>>;

export interface LangMeta {
  name: string;
  native: string;
  dir: "ltr" | "rtl";
}
