import { useState } from "react";
import { getLabels, type Locale } from "@solvex-dergana/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  LocateFixed,
  PhoneCall,
  ShieldAlert,
  Siren,
} from "lucide-react";

import { LogoMark } from "@solvex-dergana/ui/components/logo";
import WitnessPhoneFrame from "@/components/witness/witness-phone-frame";
import { BRAND_TITLE } from "@/lib/brand";

export const Route = createFileRoute("/witness")({
  component: WitnessRoute,
});

export function WitnessRoute() {
  const [locale, setLocale] = useState<Locale>("fr");
  const [reportStarted, setReportStarted] = useState(false);
  const t = getLabels(locale, "navigation");
  const witness = getLabels(locale, "witness");

  return (
    <div
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      className="awn-grid-bg flex min-h-screen flex-col justify-between bg-background text-foreground"
    >
      {/* Top Banner */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card/90 px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          {reportStarted ? (
            <button
              type="button"
              data-testid="back-to-sos"
              onClick={() => setReportStarted(false)}
              className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-sm px-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
              <span>{locale === "ar" ? "شاشة SOS" : "Écran SOS"}</span>
            </button>
          ) : (
            <Link
              to="/login"
              className="flex min-h-10 items-center gap-1.5 rounded-sm px-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
              <span>{t.portal}</span>
            </Link>
          )}
          <div className="h-5 w-px bg-border" />
          <div className="flex flex-wrap items-center gap-2.5">
            <LogoMark className="size-8" />
            <span className="text-base font-semibold text-foreground">
              {witness.title}
            </span>
            <span className="rounded-full border border-info/40 bg-info-soft px-2.5 py-0.5 text-xs font-semibold text-info">
              {t.demo}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="flex items-center rounded-full bg-muted p-0.5 text-xs font-bold border border-border">
            <button
              type="button"
              lang="fr"
              data-testid="lang-toggle-fr"
              aria-pressed={locale === "fr"}
              onClick={() => setLocale("fr")}
              className={`cursor-pointer rounded-full px-2.5 py-1 transition ${
                locale === "fr"
                  ? "bg-primary-action text-primary-action-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              FR
            </button>
            <button
              type="button"
              lang="ar"
              data-testid="lang-toggle-ar"
              aria-pressed={locale === "ar"}
              onClick={() => setLocale("ar")}
              className={`cursor-pointer rounded-full px-2.5 py-1 transition ${
                locale === "ar"
                  ? "bg-primary-action text-primary-action-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              عربي
            </button>
          </div>

          <span className="flex items-center gap-1.5 font-medium">
            <ShieldAlert className="size-4 text-sev-red" aria-hidden="true" />
            <PhoneCall className="size-4 text-sev-red" aria-hidden="true" />
            {t.emergency} :{" "}
            <strong dir="ltr" className="tabular text-foreground">
              14 / 154
            </strong>
          </span>
        </div>
      </header>

      {/* Main Presentation View */}
      <main
        id="main"
        className="flex flex-1 items-center justify-center px-4 py-6"
      >
        {reportStarted ? (
          <WitnessPhoneFrame
            initialLocale={locale}
            onLocaleChange={setLocale}
          />
        ) : (
          <section className="flex w-full max-w-md flex-col items-center rounded-3xl border border-border bg-card/95 px-6 py-10 text-center shadow-2xl sm:px-10 sm:py-12">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-sev-red-soft text-sev-red">
              <Siren className="size-7" aria-hidden="true" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {witness.sos_title}
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
              {witness.sos_help}
            </p>

            <button
              type="button"
              data-testid="start-sos-report"
              onClick={() => setReportStarted(true)}
              className="group my-8 flex size-48 cursor-pointer touch-manipulation flex-col items-center justify-center rounded-full border-8 border-sev-red/20 bg-danger-solid text-solid-foreground shadow-2xl shadow-sev-red/30 transition hover:scale-[1.03] hover:bg-sev-red active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sev-red/40 focus-visible:ring-offset-4 focus-visible:ring-offset-background"
              aria-label={`${witness.sos_action} — ${witness.sos_help}`}
            >
              <Siren
                className="mb-1 size-10 transition-transform group-hover:-rotate-6"
                aria-hidden="true"
              />
              <span className="text-4xl font-black tracking-wider">
                {witness.sos_action}
              </span>
            </button>

            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <LocateFixed
                className="size-4 text-sev-green"
                aria-hidden="true"
              />
              {witness.sos_note}
            </p>
            <p className="mt-5 text-sm font-semibold text-sev-red">
              {t.emergency} : <span dir="ltr">14 / 154</span>
            </p>
          </section>
        )}
      </main>

      {/* Footer Info */}
      <footer className="border-t bg-card/80 py-3 text-center text-xs text-muted-foreground">
        {BRAND_TITLE} • {t.footer} • {t.demo}
      </footer>
    </div>
  );
}
