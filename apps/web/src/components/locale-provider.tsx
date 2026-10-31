import { createContext, useContext, useState, type ReactNode } from "react";
import type { Locale } from "@solvex-dergana/shared";

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void } | null>(null);
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("fr");
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}
export function useLocale() {
  const shared = useContext(LocaleContext);
  const [locale, setLocale] = useState<Locale>("fr");
  return shared ?? { locale, setLocale };
}
