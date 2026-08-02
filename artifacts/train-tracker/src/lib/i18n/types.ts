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
  "placeholder.trainNumber",
  "action.executeTrace",
  "action.abortReturn",
  "action.reconfigure",
  "status.onTime",
  "status.lateMinutes",
  "status.updated",
  "error.signalLost",
  "error.fallback",
  "meta.platform",
  "meta.kilometers",
  "meta.halt",
  "meta.day",
  "hint.valid",
  "hint.invalid",
  "hint.validating",
  "hint.unknownTrain",
  "hint.invalidFormat",
  "hint.invalidDate",
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
