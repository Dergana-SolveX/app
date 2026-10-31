import { VITTEL_ITEMS, type VittelItem, type VittelLevel, type VittelResult, type VittelState } from "@solvex-dergana/shared";
import { Button } from "@solvex-dergana/ui/components/button";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { ChevronDownIcon, CircleAlertIcon } from "lucide-react";
import { useState } from "react";

import { NumberStepper, ToggleChip } from "./controls";

const LEVELS: { level: VittelLevel; title: string; hint?: string }[] = [
  { level: "l1", title: "1 · Physiologique", hint: "Calculé à partir des constantes ci-dessus." },
  { level: "l2", title: "2 · Cinétique" },
  { level: "l3", title: "3 · Anatomique" },
  { level: "l4", title: "4 · Réanimation" },
  { level: "l5", title: "5 · Terrain" },
];

/** Where an answer came from, for the medic to confirm or overrule. Their own answers carry no tag. */
function sourceTag(level: VittelLevel, item: VittelItem | undefined): string | null {
  if (!item || item.source === "medic") return null;
  if (item.source === "iot") return "capteur — à confirmer";
  return level === "l5" ? "profil" : "téléphone — à confirmer";
}

/** The "TRAUMATISÉ GRAVE (Vittel)" banner, with the reasons. Absent when no item is positive. */
export function VittelBanner({ result }: { result: VittelResult }) {
  return (
    <div role="status">
      {result.severe && (
        <div className="rounded-lg border-2 border-sev-red bg-sev-red-soft px-4 py-3 text-sev-red">
          <p className="flex items-center gap-2 text-base font-bold">
            <CircleAlertIcon className="size-6 shrink-0" aria-hidden="true" />
            Traumatisé grave (Vittel)
          </p>
          <ul className="mt-1.5 list-disc ps-8 text-sm font-semibold text-foreground">
            {result.positives.map((positive) => (
              <li key={`${positive.level}.${positive.id}`}>{positive.label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The five Vittel levels, collapsible. One positive item anywhere makes the victim severe. */
export function VittelPanel({
  state,
  onAnswer,
}: {
  state: VittelState;
  /** `null` removes the medic's answer, which gives the sensor or profile value back. */
  onAnswer: (level: VittelLevel, id: string, value: boolean | number | null) => void;
}) {
  const [open, setOpen] = useState<Set<VittelLevel>>(
    () => new Set(LEVELS.filter(({ level }) => level !== "l1" && Object.keys(state[level]).length > 0).map((l) => l.level)),
  );
  const toggle = (level: VittelLevel) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(level)) next.add(level);
      return next;
    });

  return (
    <div className="flex flex-col gap-2">
      {LEVELS.map(({ level, title, hint }) => {
        const items = VITTEL_ITEMS.filter((item) => item.level === level);
        const displayedItems =
          level === "l4"
            ? [...items].sort((a, b) =>
                a.id === "fluidsMl" ? -1 : b.id === "fluidsMl" ? 1 : 0,
              )
            : items;
        const positives = items.filter((item) => item.positive(state[level][item.id]?.value ?? false)).length;
        const isOpen = open.has(level);
        return (
          <section key={level} className="rounded-lg border bg-card">
            <h3>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`vittel-${level}`}
                onClick={() => toggle(level)}
                className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-start text-sm font-bold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span>{title}</span>
                <span className="flex items-center gap-2">
                  {positives > 0 && (
                    <span className="rounded-md border border-sev-red/40 bg-sev-red-soft px-2 py-0.5 text-xs font-bold text-sev-red">
                      {positives} positif{positives > 1 ? "s" : ""}
                    </span>
                  )}
                  <ChevronDownIcon className={cn("size-4 transition-transform duration-150", isOpen && "rotate-180")} aria-hidden="true" />
                </span>
              </button>
            </h3>
            <div id={`vittel-${level}`} hidden={!isOpen} className="flex flex-col gap-3 border-t px-3 py-3">
              {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
              <div className="flex flex-wrap gap-2">
                {displayedItems.map((definition) => {
                  const item = state[level][definition.id];
                  const tag = sourceTag(level, item);
                  const isNumber = definition.id === "fallHeightM" || definition.id === "fluidsMl";
                  if (isNumber) {
                    return (
                      <div key={definition.id} className="w-full max-w-xs">
                        <NumberStepper
                          label={definition.id === "fallHeightM" ? "Hauteur de chute" : "Remplissage"}
                          unit={definition.id === "fallHeightM" ? "m" : "ml"}
                          value={typeof item?.value === "number" ? item.value : null}
                          onChange={(value) => onAnswer(level, definition.id, value)}
                          min={0}
                          max={definition.id === "fallHeightM" ? 100 : 10000}
                          step={definition.id === "fallHeightM" ? 1 : 250}
                          fallback={0}
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={definition.id} className="flex flex-wrap items-center gap-1.5">
                      <ToggleChip
                        label={definition.label}
                        pressed={item?.value === true}
                        disabled={level === "l1"}
                        onPressedChange={(next) => onAnswer(level, definition.id, next)}
                      />
                      {tag && (
                        <span className="text-xs font-semibold text-muted-foreground">{tag}</span>
                      )}
                      {item && item.source !== "medic" && level !== "l5" && typeof item.value === "boolean" && (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-12"
                          onClick={() => onAnswer(level, definition.id, item.value as boolean)}
                        >
                          Confirmer
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
