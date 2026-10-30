import { cn } from "@solvex-dergana/ui/lib/utils";
import { getLabels, type Locale, type ShockIndex } from "@solvex-dergana/shared";
import { CircleAlertIcon, CircleCheckIcon, CircleHelpIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";

const FLAGS = {
  normal: { word: "Normal", tone: "border-sev-green/40 bg-sev-green-soft text-sev-green", Icon: CircleCheckIcon },
  elevated: { word: "Élevé", tone: "border-sev-yellow/40 bg-sev-yellow-soft text-sev-yellow", Icon: TriangleAlertIcon },
  critical: { word: "Critique", tone: "border-sev-red/40 bg-sev-red-soft text-sev-red", Icon: CircleAlertIcon },
} as const;

/** Live Shock Index (heart rate / systolic pressure). The announcing region stays mounted; only its content changes. */
export function ShockIndexBadge({ result, locale = "fr" }: { result: ShockIndex | null; locale?: Locale }) {
  return <div role="status">{result ? <Reading result={result} locale={locale} /> : <Missing locale={locale} />}</div>;
}

function Missing({ locale }: { locale: Locale }) {
  const t = getLabels(locale, "shock");
  return (
    <div className="flex items-center gap-2 rounded-lg border border-sev-unknown/40 bg-sev-unknown-soft px-3 py-2 text-sev-unknown">
      <CircleHelpIcon className="size-5 shrink-0" aria-hidden="true" />
      <p className="text-sm font-semibold">{t.missing}</p>
    </div>
  );
}

function Reading({ result, locale }: { result: ShockIndex; locale: Locale }) {
  const t = getLabels(locale, "shock");
  const fr = getLabels("fr", "shock");
  const { tone, Icon } = FLAGS[result.flag];
  const shown = result.value === null ? "—" : result.value.toFixed(2).replace(".", ",");
  return (
    <div className={cn("rounded-lg border px-3 py-2", tone)}>
      <div className="flex items-center gap-2">
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        <p className="text-sm font-semibold">
          {t.title} <span dir="ltr" className="tabular font-mono text-xl font-extrabold">{shown}</span>{" "}
          <span className="font-bold uppercase">{t[result.flag]}</span>
        </p>
      </div>
      {result.caveats.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1 text-sm text-foreground">
          {result.caveats.map((caveat) => (
            <li key={t[(Object.keys(fr) as (keyof typeof fr)[]).find((key) => fr[key] === caveat)!] ?? caveat} className="flex items-start gap-1.5">
              <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {t[(Object.keys(fr) as (keyof typeof fr)[]).find((key) => fr[key] === caveat)!] ?? caveat}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
