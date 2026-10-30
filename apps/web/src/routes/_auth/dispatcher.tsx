import { createFileRoute } from "@tanstack/react-router";

import ScreenShell from "@/components/screen-shell";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/dispatcher")({
  beforeLoad: ({ context }) => {
    requireAccess(context.appUser, { screen: "dispatcher" });
  },
  component: () => (
    <ScreenShell
      title="Poste de commandement"
      description="File des incidents, carte et décision de dispatch."
      issue="#6"
    />
  ),
});
