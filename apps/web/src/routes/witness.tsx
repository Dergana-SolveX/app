import { useState } from "react";
import { getLabels, type Locale } from "@solvex-dergana/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, PhoneCall, ShieldAlert } from "lucide-react";

import { LogoMark } from "@solvex-dergana/ui/components/logo";
import WitnessPhoneFrame from "@/components/witness/witness-phone-frame";
import { BRAND_TITLE } from "@/lib/brand";

export const Route = createFileRoute("/witness")({
  component: WitnessRoute,
});

function WitnessRoute() {
  const [locale, setLocale] = useState<Locale>("fr");
  const t = getLabels(locale, "navigation");
  return (
    <div lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className="awn-grid-bg flex min-h-screen flex-col justify-between bg-background text-foreground">
      {/* Top Banner */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card/90 px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/login"
            className="flex min-h-10 items-center gap-1.5 rounded-sm px-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
            <span>{t.portal}</span>
          </Link>
          <div className="h-5 w-px bg-border" />
          <div className="flex flex-wrap items-center gap-2.5">
            <LogoMark className="size-8" />
            <span className="text-base font-semibold text-foreground">
              {getLabels(locale, "witness").title}
            </span>
            <span className="rounded-full border border-info/40 bg-info-soft px-2.5 py-0.5 text-xs font-semibold text-info">
              {t.demo}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <ShieldAlert className="size-4 text-sev-red" aria-hidden="true" />
            <PhoneCall className="size-4 text-sev-red" aria-hidden="true" />
            {t.emergency} : <strong dir="ltr" className="tabular text-foreground">14 / 154</strong>
          </span>
        </div>
      </header>

      {/* Main Presentation View */}
      <main className="flex-1 flex items-center justify-center py-6 px-4">
        <WitnessPhoneFrame onLocaleChange={setLocale} />
      </main>

      {/* Footer Info */}
      <footer className="border-t bg-card/80 py-3 text-center text-xs text-muted-foreground">
        {BRAND_TITLE} • {t.footer} • {t.demo}
      </footer>
    </div>
  );
}
