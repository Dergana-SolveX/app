import { createContext, useContext, useState, type ReactNode } from "react";
import { getLabels, type Locale } from "@solvex-dergana/shared";

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({
  locale: "fr", setLocale: () => {},
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("fr");
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  return { ...context, direction: context.locale === "ar" ? "rtl" as const : "ltr" as const,
    navigation: getLabels(context.locale, "navigation") };
}
