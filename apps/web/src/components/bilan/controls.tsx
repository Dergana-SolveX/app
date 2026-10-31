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
    <div role="group" aria-label={legend} className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-semibold">{legend}</span>
      {/* Two equal columns while the card is narrow, free-flowing chips once there is room. */}
      <div className="grid grid-cols-2 gap-2 @md:flex @md:flex-wrap">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex min-h-12 min-w-0 cursor-pointer items-center justify-start gap-1.5 rounded-md border px-3 text-sm font-semibold transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring @md:justify-center",
              value === option.value
                ? "border-primary bg-accent text-accent-foreground"
                : "border-input bg-card hover:border-primary/60",
            )}
          >
            {value === option.value && <CheckIcon className="size-4 shrink-0" aria-hidden="true" />}
            <span className="tabular shrink-0 font-mono">{option.value}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{option.label}</span>
          </button>
        ))}
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
    // A plain group, not a <fieldset>: a fieldset cannot shrink below its content and pushed out of its card.
    <div role="group" aria-labelledby="gcs-title" className="@container flex min-w-0 flex-col gap-3 rounded-lg border bg-raised p-3">
      <div className="flex items-center justify-between gap-2">
        <span id="gcs-title" className="text-sm font-semibold">
          Glasgow
        </span>
        <span className="tabular rounded-full border bg-card px-2.5 py-0.5 font-mono text-sm font-bold" aria-live="polite">
          {total === null ? "— / 15" : `${total} / 15`}
        </span>
      </div>
      <ChoiceRow legend="Yeux (E)" options={options(EYES)} value={eye} onChange={(v) => onChange({ eye: v, verbal, motor })} />
      <ChoiceRow legend="Verbal (V)" options={options(VERBAL)} value={verbal} onChange={(v) => onChange({ eye, verbal: v, motor })} />
      <ChoiceRow legend="Moteur (M)" options={options(MOTOR)} value={motor} onChange={(v) => onChange({ eye, verbal, motor: v })} />
    </div>
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
