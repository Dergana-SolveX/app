import { Button } from "@solvex-dergana/ui/components/button";
import { Input } from "@solvex-dergana/ui/components/input";
import { Label } from "@solvex-dergana/ui/components/label";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { CheckIcon, MinusIcon, PlusIcon } from "lucide-react";
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
  fallback,
}: {
  label: string;
  unit?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min: number;
  max: number;
  step?: number;
  /** Where the first tap on + or − starts from, when nothing is entered yet. */
  fallback: number;
}) {
  const id = useId();
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const nudge = (direction: 1 | -1) => onChange(clamp((value ?? fallback) + direction * step));
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}
        {unit && <span className="ms-1 font-normal text-muted-foreground">({unit})</span>}
      </Label>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon-lg" aria-label={`Diminuer ${label}`} onClick={() => nudge(-1)}>
          <MinusIcon aria-hidden="true" />
        </Button>
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value ?? ""}
          placeholder="—"
          aria-describedby={`${id}-range`}
          className="tabular h-12 text-center font-mono text-lg font-bold md:text-lg"
          onChange={(event) => {
            const text = event.target.value.trim();
            if (text === "") return onChange(null);
            const n = Number(text);
            if (Number.isFinite(n)) onChange(clamp(Math.round(n)));
          }}
        />
        <Button type="button" variant="outline" size="icon-lg" aria-label={`Augmenter ${label}`} onClick={() => nudge(1)}>
          <PlusIcon aria-hidden="true" />
        </Button>
      </div>
      <p id={`${id}-range`} className="text-xs text-muted-foreground">
        De {min} à {max}
      </p>
    </div>
  );
}

/** One of several choices, as a row of large buttons (a radio group). */
function ChoiceRow({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: { value: number; label: string }[];
  value: number | null;
  onChange: (value: number) => void;
}) {
  return (
    <div role="radiogroup" aria-label={legend} className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{legend}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex min-h-12 min-w-12 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-semibold transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              value === option.value
                ? "border-primary bg-accent text-accent-foreground"
                : "border-input bg-card hover:border-primary/60",
            )}
          >
            {value === option.value && <CheckIcon className="size-4" aria-hidden="true" />}
            <span className="tabular font-mono">{option.value}</span>
            <span className="hidden text-xs font-normal text-muted-foreground sm:inline">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const EYES = ["Spontanée", "À la voix", "À la douleur", "Aucune"];
const VERBAL = ["Orientée", "Confuse", "Mots", "Sons", "Aucune"];
const MOTOR = ["Obéit", "Localise", "Évitement", "Flexion", "Extension", "Aucune"];

/** Glasgow coma scale: the three answers add up to the total (3 to 15). */
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
  // Scores run from best to worst on screen: 4 for the eyes down to 1.
  const options = (labels: string[]) => labels.map((label, i) => ({ value: labels.length - i, label }));
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border bg-raised p-3">
      <legend className="px-1 text-sm font-semibold">
        Glasgow{" "}
        <span className="tabular font-mono font-bold" aria-live="polite">
          {total === null ? "— / 15" : `${total} / 15`}
        </span>
      </legend>
      <ChoiceRow legend="Yeux (E)" options={options(EYES)} value={eye} onChange={(v) => onChange({ eye: v, verbal, motor })} />
      <ChoiceRow legend="Verbal (V)" options={options(VERBAL)} value={verbal} onChange={(v) => onChange({ eye, verbal: v, motor })} />
      <ChoiceRow legend="Moteur (M)" options={options(MOTOR)} value={motor} onChange={(v) => onChange({ eye, verbal, motor: v })} />
    </fieldset>
  );
}

/** A yes/no chip with a large touch target. The state is also written in the accessible name. */
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
        pressed ? "border-primary bg-accent text-accent-foreground" : "border-input bg-card hover:border-primary/60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded border",
          pressed ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {pressed && <CheckIcon className="size-3.5" />}
      </span>
      {label}
    </button>
  );
}
