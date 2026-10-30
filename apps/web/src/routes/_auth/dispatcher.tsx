import { createFileRoute } from "@tanstack/react-router";

import IncidentQueue from "@/components/incident-queue";
import { PageHeader } from "@/components/screen-shell";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/dispatcher")({
  beforeLoad: ({ context }) => {
    requireAccess(context.appUser, { screen: "dispatcher" });
  },
  component: DispatcherScreen,
});

function DispatcherScreen() {
  const { appUser } = Route.useRouteContext();
  return (
    <>
      <PageHeader
        title="Poste de commandement"
        description="Les incidents arrivent ici en direct. La carte et la décision de dispatch viennent ensuite."
      />
      <IncidentQueue canOpenConsole={appUser?.role === "admin"} />
    </>
  );
}
