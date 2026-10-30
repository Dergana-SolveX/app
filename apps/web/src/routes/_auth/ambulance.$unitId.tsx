import { createFileRoute } from "@tanstack/react-router";

import ScreenShell from "@/components/screen-shell";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/ambulance/$unitId")({
  beforeLoad: ({ context, params }) => {
    requireAccess(context.appUser, { screen: "ambulance", unitId: params.unitId });
  },
  component: () => (
    <ScreenShell
      title="Tablette ambulance"
      description="Mission, bilan secouriste et orientation vers l'hôpital."
      issue="#7"
    />
  ),
});
