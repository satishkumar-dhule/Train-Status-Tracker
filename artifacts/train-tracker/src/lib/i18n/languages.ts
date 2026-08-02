import type { LangCode, LangMeta } from "./types";

export const LANGUAGES: Record<LangCode, LangMeta> = {
  en: { name: "English", native: "English", dir: "ltr" },
  hi: { name: "Hindi", native: "हिन्दी", dir: "ltr" },
  bn: { name: "Bengali", native: "বাংলা", dir: "ltr" },
  te: { name: "Telugu", native: "తెలుగు", dir: "ltr" },
  ta: { name: "Tamil", native: "தமிழ்", dir: "ltr" },
  mr: { name: "Marathi", native: "मराठी", dir: "ltr" },
  gu: { name: "Gujarati", native: "ગુજરાતી", dir: "ltr" },
  kn: { name: "Kannada", native: "ಕನ್ನಡ", dir: "ltr" },
  ml: { name: "Malayalam", native: "മലയാളം", dir: "ltr" },
  pa: { name: "Punjabi", native: "ਪੰਜਾਬੀ", dir: "ltr" },
  or: { name: "Odia", native: "ଓଡ଼ିଆ", dir: "ltr" },
  ur: { name: "Urdu", native: "اردو", dir: "rtl" },
};
