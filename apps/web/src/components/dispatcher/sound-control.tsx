import { Button } from "@solvex-dergana/ui/components/button";
import { BellRingIcon, Volume2Icon, VolumeXIcon } from "lucide-react";

import { useAlertSoundSettings } from "@/lib/alert-sound";

/**
 * The alert siren switch. Browsers keep a page silent until the first click: while that is the case the
 * control says so in words, because a dispatcher must never believe the siren is on when it is not.
 */
export function AlertSoundControl() {
  const { enabled, blocked, toggle, test } = useAlertSoundSettings();
  return (
    <div className="flex flex-nowrap items-center gap-2">
      {enabled && blocked && (
        <Button
          variant="outline"
          onClick={test}
          className="border-sev-yellow/50 bg-sev-yellow-soft text-sev-yellow hover:bg-sev-yellow-soft"
        >
          <BellRingIcon aria-hidden="true" />
          Activer la sirène
        </Button>
      )}
      <Button
        variant="outline"
        aria-pressed={enabled}
        onClick={toggle}
        title={
          enabled
            ? "Couper la sirène des nouvelles alertes"
            : "Rétablir la sirène des nouvelles alertes"
        }
        className={
          enabled
            ? undefined
            : "border-sev-red/50 text-sev-red hover:text-sev-red"
        }
      >
        {enabled ? (
          <Volume2Icon aria-hidden="true" />
        ) : (
          <VolumeXIcon aria-hidden="true" />
        )}
        {enabled ? "Sirène activée" : "Sirène coupée"}
      </Button>
      {enabled && !blocked && (
        <Button variant="ghost" onClick={test}>
          Tester
        </Button>
      )}
    </div>
  );
}
