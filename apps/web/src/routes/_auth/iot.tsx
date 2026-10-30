import { createFileRoute } from "@tanstack/react-router";

import ScreenShell from "@/components/screen-shell";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/iot")({
  beforeLoad: ({ context }) => {
    requireAccess(context.appUser, { screen: "iot" });
  },
  component: () => (
    <ScreenShell
      title="IoT Showcase"
      description="Puce simulée : scénarios de crash et parcours de l'alerte."
      issue="#15"
      emulated
    />
  ),
});
