import { getLabels, type Locale } from "../i18n/labels";
/** Compatibility export; the shared catalogue owns both translations and fallback. */
export const WITNESS_TEXT = { fr: getLabels("fr", "witness"), ar: getLabels("ar", "witness") };
export type WitnessLang = Locale;
