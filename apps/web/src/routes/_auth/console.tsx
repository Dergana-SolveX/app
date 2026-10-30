import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { createFileRoute } from "@tanstack/react-router";

import GsmPanel from "@/components/gsm-panel";
import { PageHeader } from "@/components/screen-shell";
import WireLog from "@/components/wire-log";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/console")({
  beforeLoad: ({ context }) => {
    requireAccess(context.appUser, { screen: "console" });
  },
  component: ConsoleScreen,
});

function ConsoleScreen() {
  return (
    <>
      <PageHeader
        title="Console de démonstration"
        description="Envoyez un SMS depuis un téléphone émulé et suivez-le de bout en bout: journal du fil, incident, accusé de réception."
        badges={<EmulationBadge />}
      />
      <div className="grid gap-6 p-4 md:p-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <GsmPanel />
        <WireLog />
      </div>
    </>
  );
}
