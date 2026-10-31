import { createFileRoute } from "@tanstack/react-router";

import DispatcherWorkspace from "@/components/dispatcher/workspace";
import { PageHeader } from "@/components/screen-shell";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/dispatcher")({
  beforeLoad: ({ context }) => {
    requireAccess(context.appUser, { screen: "dispatcher" });
  },
  component: DispatcherScreen,
});

function DispatcherScreen() {
  return (
    <>
      <PageHeader
        title="Poste de commandement"
        description="Alertes en direct par ordre d'arrivée, évaluation et décision de dispatch."
      />
      <DispatcherWorkspace />
    </>
  );
}
