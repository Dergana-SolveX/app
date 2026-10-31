import { Button } from "@solvex-dergana/ui/components/button";
import { Input } from "@solvex-dergana/ui/components/input";
import { Label } from "@solvex-dergana/ui/components/label";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { CheckIcon, CircleAlertIcon, CircleCheckIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useId } from "react";

/** A measure with a typed value and large − / + buttons. Empty means "not measured", never 0. */
export function NumberStepper({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  step = 1,
  quickStep,
  fallback,
}: {
  label: string;
  unit?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min: number;
  max: number;
  step?: number;
  /** Optional larger adjustment shown below the precise − / + controls. */
  quickStep?: number;
  /** Where the first tap on + or − starts from, when nothing is entered yet. */
  fallback: number;
}) {
  const id = useId();
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const nudge = (direction: 1 | -1, amount = step) =>
    onChange(clamp((value ?? fallback) + direction * amount));
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}
        {unit && <span className="ms-1 font-normal text-muted-foreground">({unit})</span>}
      </Label>
      <div className="flex items-center gap-1.5">
        {quickStep && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-9 w-10 shrink-0 px-1 text-xs"
            aria-label={`Diminuer ${label} de ${quickStep}`}
            onClick={() => nudge(-1, quickStep)}
          >
            −{quickStep}
          </Button>
        )}
        <Button type="button" variant="outline" size="icon-lg" className="shrink-0" aria-label={`Diminuer ${label}`} onClick={() => nudge(-1)}>
          <MinusIcon aria-hidden="true" />
        </Button>
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value ?? ""}
          placeholder="—"
          aria-describedby={`${id}-range`}
          className="tabular h-12 min-w-14 flex-1 px-1 text-center font-mono text-lg font-bold md:text-lg"
          onChange={(event) => {
            const text = event.target.value.trim();
            if (text === "") return onChange(null);
            const n = Number(text);
            if (Number.isFinite(n)) onChange(clamp(Math.round(n)));
          }}
        />
        <Button type="button" variant="outline" size="icon-lg" className="shrink-0" aria-label={`Augmenter ${label}`} onClick={() => nudge(1)}>
          <PlusIcon aria-hidden="true" />
        </Button>
        {quickStep && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-9 w-10 shrink-0 px-1 text-xs"
            aria-label={`Augmenter ${label} de ${quickStep}`}
            onClick={() => nudge(1, quickStep)}
          >
            +{quickStep}
          </Button>
        )}
      </div>
      <p id={`${id}-range`} className="text-xs text-muted-foreground">
        De {min} à {max}
      </p>
    </div>
  );
}

const EYES = ["Aucune", "À la douleur", "À la voix", "Spontanée"];
const VERBAL = ["Aucune", "Sons incompréhensibles", "Mots inappropriés", "Confuse", "Orientée"];
const MOTOR = ["Aucune", "Extension", "Flexion anormale", "Évitement", "Localise", "Obéit"];

function GcsLine({
  label,
  shortLabel,
  value,
  labels,
  onChange,
}: {
  label: string;
  shortLabel: string;
  value: number | null;
  labels: string[];
  onChange: (value: number) => void;
}) {
  const id = useId();
  const max = labels.length;
  const displayed = value ?? Math.ceil(max / 2);
  const description = value === null ? "Non mesuré" : labels[value - 1];
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-sm font-semibold">
          {label} ({shortLabel})
        </Label>
        <span className="tabular min-w-28 text-end font-mono text-sm font-bold" aria-live="polite">
          {value ?? "—"} / {max} · <span className="font-sans text-xs font-semibold text-muted-foreground">{description}</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={1}
        max={max}
        step={1}
        value={displayed}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-valuetext={value === null ? `${label} non mesuré` : `${value} sur ${max}, ${description}`}
        className={cn(
          "h-3 w-full cursor-pointer appearance-none rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
          "[&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-card [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:shadow-md",
          "[&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-card [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-md",
          value === null && "opacity-60",
        )}
        style={{ background: "linear-gradient(to right, var(--sev-red), var(--sev-yellow) 50%, var(--sev-green))" }}
      />
      {/* Three per row in a narrow card (labels stay readable), all on one row once there is room. */}
      <div
        className="mt-2 grid grid-cols-3 gap-1 @md:grid-cols-[repeat(var(--gcs-cols),minmax(0,1fr))]"
        style={{ "--gcs-cols": max } as React.CSSProperties}
        aria-label={`États ${label.toLowerCase()}`}
      >
        {labels.map((stateLabel, index) => {
          const score = index + 1;
          return (
            <button
              key={stateLabel}
              type="button"
              aria-label={`${label} ${score} : ${stateLabel}`}
              aria-pressed={value === score}
              onClick={() => onChange(score)}
              className={cn(
                "min-h-14 min-w-0 rounded-sm border px-1 py-1.5 text-xs font-semibold leading-tight hyphens-auto outline-none transition-colors [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                value === score
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-input bg-raised text-muted-foreground hover:border-primary/60 hover:text-foreground",
                score === 1 && value !== score && "text-sev-red",
                score === max && value !== score && "text-sev-green",
              )}
            >
              <span className="tabular block font-mono text-xs font-bold">{score}</span>
              {stateLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Glasgow coma scale: separate sliders for eyes, verbal response and motor response. */
export function GcsPicker({
  eye,
  verbal,
  motor,
  onChange,
}: {
  eye: number | null;
  verbal: number | null;
  motor: number | null;
  onChange: (next: { eye: number | null; verbal: number | null; motor: number | null }) => void;
}) {
  const total = eye !== null && verbal !== null && motor !== null ? eye + verbal + motor : null;
  const state =
    total === null
      ? { label: "Non mesuré", tone: "border-input bg-muted text-muted-foreground", Icon: null }
      : total <= 8
        ? { label: "Sévère", tone: "border-sev-red/40 bg-sev-red-soft text-sev-red", Icon: CircleAlertIcon }
        : total <= 12
          ? { label: "Modéré", tone: "border-sev-yellow/40 bg-sev-yellow-soft text-sev-yellow", Icon: CircleAlertIcon }
          : { label: "Rassurant", tone: "border-sev-green/40 bg-sev-green-soft text-sev-green", Icon: CircleCheckIcon };
  const StateIcon = state.Icon;
  return (
    // min-w-0: a fieldset otherwise refuses to shrink below its content and overflows its card.
    <fieldset className="@container flex min-w-0 flex-col gap-3 rounded-lg border bg-raised p-3">
      <legend className="sr-only">Échelle de Glasgow</legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Glasgow détaillé</span>
        <span
          className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-bold", state.tone)}
          aria-live="polite"
        >
          {StateIcon && <StateIcon className="size-3.5" aria-hidden="true" />}
          {total === null ? "— / 15" : `${total} / 15`} · {state.label}
        </span>
      </div>
      <GcsLine label="Yeux" shortLabel="E" value={eye} labels={EYES} onChange={(value) => onChange({ eye: value, verbal, motor })} />
      <GcsLine label="Verbal" shortLabel="V" value={verbal} labels={VERBAL} onChange={(value) => onChange({ eye, verbal: value, motor })} />
      <GcsLine label="Moteur" shortLabel="M" value={motor} labels={MOTOR} onChange={(value) => onChange({ eye, verbal, motor: value })} />
    </fieldset>
  );
}

/** A selectable chip: neutral until pressed, then the whole control turns green. */
export function ToggleChip({
  label,
  pressed,
  onPressedChange,
  disabled,
}: {
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-md border px-3.5 text-start text-sm font-semibold transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
        pressed
          ? "border-sev-green/50 bg-sev-green-soft text-sev-green"
          : "border-input bg-card hover:border-sev-green/60 hover:bg-sev-green-soft/40",
      )}
    >
      {pressed && <CheckIcon className="size-4" aria-hidden="true" />}
      {label}
    </button>
  );
}
