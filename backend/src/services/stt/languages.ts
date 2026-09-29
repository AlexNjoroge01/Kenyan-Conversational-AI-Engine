/** Whisper's language table (ISO 639-1 code -> name), as used by whisper-large-v3(-turbo). */
const WHISPER_LANGUAGES: Record<string, string> = {
  en: "english", zh: "chinese", de: "german", es: "spanish", ru: "russian", ko: "korean", fr: "french",
  ja: "japanese", pt: "portuguese", tr: "turkish", pl: "polish", ca: "catalan", nl: "dutch", ar: "arabic",
  sv: "swedish", it: "italian", id: "indonesian", hi: "hindi", fi: "finnish", vi: "vietnamese", he: "hebrew",
  uk: "ukrainian", el: "greek", ms: "malay", cs: "czech", ro: "romanian", da: "danish", hu: "hungarian",
  ta: "tamil", no: "norwegian", th: "thai", ur: "urdu", hr: "croatian", bg: "bulgarian", lt: "lithuanian",
  la: "latin", mi: "maori", ml: "malayalam", cy: "welsh", sk: "slovak", te: "telugu", fa: "persian",
  lv: "latvian", bn: "bengali", sr: "serbian", az: "azerbaijani", sl: "slovenian", kn: "kannada",
  et: "estonian", mk: "macedonian", br: "breton", eu: "basque", is: "icelandic", hy: "armenian", ne: "nepali",
  mn: "mongolian", bs: "bosnian", kk: "kazakh", sq: "albanian", sw: "swahili", gl: "galician", mr: "marathi",
  pa: "punjabi", si: "sinhala", km: "khmer", sn: "shona", yo: "yoruba", so: "somali", af: "afrikaans",
  oc: "occitan", ka: "georgian", be: "belarusian", tg: "tajik", sd: "sindhi", gu: "gujarati", am: "amharic",
  yi: "yiddish", lo: "lao", uz: "uzbek", fo: "faroese", ht: "haitian creole", ps: "pashto", tk: "turkmen",
  nn: "nynorsk", mt: "maltese", sa: "sanskrit", lb: "luxembourgish", my: "myanmar", bo: "tibetan",
  tl: "tagalog", mg: "malagasy", as: "assamese", tt: "tatar", haw: "hawaiian", ln: "lingala", ha: "hausa",
  ba: "bashkir", jw: "javanese", su: "sundanese", yue: "cantonese",
};

const CODE_BY_NAME = new Map(Object.entries(WHISPER_LANGUAGES).map(([code, name]) => [name, code]));

/**
 * Normalises a detected language to an ISO 639 code. Hosted Whisper APIs may report either a code ("sw")
 * or a name ("Swahili"); our API always returns the code. Falls back to `fallback` when unrecognised.
 */
export function toLanguageCode(detected: unknown, fallback: string): string {
  if (typeof detected !== "string") return fallback;
  const value = detected.trim().toLowerCase();
  if (value in WHISPER_LANGUAGES) return value;
  return CODE_BY_NAME.get(value) ?? fallback;
}
