import { Button } from "@solvex-dergana/ui/components/button";
import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { Input } from "@solvex-dergana/ui/components/input";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SendIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";

type Line = { from: "phone" | "svx"; text: string };

const SMS_LIMIT = 160;

/**
 * A feature phone (no apps, SMS only) talking to the SVX number through the emulated GSM network.
 * The presenter texts ACCIDENT (or حادث) and answers the menu; everything goes through `gsm.inject`,
 * so the wire log, the outbox and the incident queue show exactly what a real phone would cause.
 */
export default function FeaturePhone({ from }: { from: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  // One conversation per phone number, so switching numbers shows that phone's own screen.
  const [threads, setThreads] = useState<Record<string, Line[]>>({});
  const lines = threads[from] ?? [];

  const add = (number: string, ...added: Line[]) =>
    setThreads((all) => ({ ...all, [number]: [...(all[number] ?? []), ...added] }));

  const send = useMutation(
    trpc.gsm.inject.mutationOptions({
      onSuccess: (result, input) => {
        const answers =
          result.kind === "menu" ? result.replies : result.kind === "alert" ? [result.ack] : [];
        add(input.from, ...answers.map((answer): Line => ({ from: "svx", text: answer })));
        queryClient.invalidateQueries({ queryKey: trpc.gsm.wire.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.gsm.outbox.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.incidents.list.queryKey() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const submit = (body: string) => {
    if (!body.trim() || body.length > SMS_LIMIT || send.isPending) return;
    add(from, { from: "phone", text: body });
    send.mutate({ from, body });
    setText("");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Téléphone à touches</h3>
        <EmulationBadge />
      </div>

      <div className="mx-auto w-64 rounded-[2rem] border-2 border-border bg-secondary p-4 shadow-sm">
        <div
          role="log"
          aria-label="Écran du téléphone"
          aria-live="polite"
          className="h-64 space-y-1.5 overflow-y-auto rounded-md border border-input bg-card p-2 font-mono text-xs"
        >
          {lines.length === 0 && (
            <p className="text-muted-foreground">
              Écrivez ACCIDENT (ou حادث) et envoyez-le au numéro SVX.
            </p>
          )}
          {lines.map((line, i) => (
            <p
              key={i}
              dir="auto"
              className={cn(
                "rounded px-1.5 py-1 break-words",
                line.from === "phone"
                  ? "ms-6 bg-accent text-accent-foreground"
                  : "me-6 bg-raised text-foreground",
              )}
            >
              <span className="sr-only">{line.from === "phone" ? "Vous : " : "SVX : "}</span>
              {line.text}
            </p>
          ))}
        </div>

        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <label htmlFor="feature-phone-text" className="sr-only">
            Message
          </label>
          <Input
            id="feature-phone-text"
            dir="auto"
            autoComplete="off"
            maxLength={SMS_LIMIT}
            placeholder="Message…"
            className="bg-card font-mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="bg-card" disabled={send.isPending} onClick={() => submit("ACCIDENT")}>
              ACCIDENT
            </Button>
            <Button type="button" variant="outline" className="bg-card" dir="rtl" disabled={send.isPending} onClick={() => submit("حادث")}>
              حادث
            </Button>
          </div>
          <Button type="submit" className="w-full" disabled={send.isPending || !text.trim()}>
            <SendIcon /> Envoyer
          </Button>
        </form>
      </div>
    </div>
  );
}
