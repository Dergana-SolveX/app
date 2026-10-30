import { listCommunes } from "@solvex-dergana/shared";
import { Button } from "@solvex-dergana/ui/components/button";
import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { Input } from "@solvex-dergana/ui/components/input";
import { Label } from "@solvex-dergana/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RadioTowerIcon, SendIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";

const COMMUNES = listCommunes();

type Screen = {
  /** `CON`: the dialogue goes on. `END`: it is over. */
  type: "CON" | "END";
  message: string;
  tower: { cellId: string; rangeM: number; distanceM: number } | null;
};

/**
 * The USSD operator emulator (PRD FR-S3-15, FR-S4-11): dial `*140#` on a feature phone that is "somewhere", and the
 * emulated operator presents the nearest real cell tower to the SVX service, as a real operator would.
 * Everything here is simulated and says so (ÉMULATION); the alert it files is stored with `emulated = true`.
 */
export default function UssdPhone({ from }: { from: string }) {
  const queryClient = useQueryClient();
  const [commune, setCommune] = useState("Bab Ezzouar");
  const [answer, setAnswer] = useState("");
  // The aggregator resends every answer so far with each request: the "operator" keeps that history here.
  const [session, setSession] = useState<{ id: string; inputs: string[]; screen: Screen } | null>(null);

  const point = COMMUNES.find((c) => c.name === commune)!;

  const dial = useMutation(
    trpc.gsm.ussd.mutationOptions({
      onError: (error) => toast.error(error.message),
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: trpc.incidents.list.queryKey() });
      },
    }),
  );

  /** Sends one request; resolves to whether it worked (a failure has already been shown as a toast). */
  const send = async (sessionId: string, inputs: string[]) => {
    try {
      const screen = await dial.mutateAsync({
        sessionId,
        phoneNumber: from,
        text: inputs.join("*"),
        near: { lat: point.lat, lng: point.lng },
      });
      setSession({ id: sessionId, inputs, screen });
      return true;
    } catch {
      return false;
    }
  };

  const start = () => void send(crypto.randomUUID(), []);
  const reply = () => {
    if (!session || answer.trim() === "") return;
    const inputs = [...session.inputs, answer.trim()];
    // The answer stays in the box until the request has gone through, so a failure does not lose it.
    void send(session.id, inputs).then((sent) => sent && setAnswer(""));
  };

  const ended = session?.screen.type === "END";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <RadioTowerIcon className="size-4" aria-hidden="true" />
          USSD *140#
        </h3>
        <EmulationBadge>Opérateur émulé</EmulationBadge>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ussd-place">Le téléphone se trouve à</Label>
        <select
          id="ussd-place"
          className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
          value={commune}
          disabled={session !== null && !ended}
          onChange={(e) => setCommune(e.target.value)}
        >
          {COMMUNES.map((c) => (
            <option key={c.name}>{c.name}</option>
          ))}
        </select>
        <p className="text-sm text-muted-foreground">
          L'opérateur émulé indique à SVX l'antenne réelle (OpenCelliD) la plus proche de ce point.
        </p>
      </div>

      <div className="mx-auto w-64 rounded-[2rem] border-2 border-border bg-secondary p-4 shadow-sm">
        <div role="status" aria-label="Écran USSD" className="min-h-40 rounded-md border border-input bg-card p-2 font-mono text-xs whitespace-pre-wrap">
          {session ? session.screen.message : "Composez *140# pour joindre le service SVX Rescue."}
        </div>

        {session?.screen.tower && (
          <p className="mt-2 text-xs text-muted-foreground">
            Antenne <span className="font-mono">{session.screen.tower.cellId}</span> · portée {session.screen.tower.rangeM} m ·
            à {Math.round(session.screen.tower.distanceM)} m du point
          </p>
        )}
        {session && !session.screen.tower && (
          <p role="note" className="mt-2 text-xs text-sev-yellow">
            Aucune antenne à moins de 5 km : importez OpenCelliD (<span className="font-mono">bun run db:import-cells</span>). Le lieu saisi
            sera utilisé.
          </p>
        )}

        {session && !ended ? (
          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              reply();
            }}
          >
            <label htmlFor="ussd-answer" className="sr-only">
              Réponse
            </label>
            <Input
              id="ussd-answer"
              autoComplete="off"
              className="bg-card font-mono"
              placeholder="Votre réponse…"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
            <Button type="submit" className="w-full" disabled={dial.isPending || answer.trim() === ""}>
              <SendIcon /> Répondre
            </Button>
          </form>
        ) : (
          <Button className="mt-3 w-full" disabled={dial.isPending} onClick={start}>
            {session ? "Nouvel appel *140#" : "Composer *140#"}
          </Button>
        )}
      </div>
    </div>
  );
}
