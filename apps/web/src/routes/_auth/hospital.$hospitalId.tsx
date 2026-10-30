import { createFileRoute } from "@tanstack/react-router";

import ScreenShell from "@/components/screen-shell";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/hospital/$hospitalId")({
  beforeLoad: ({ context, params }) => {
    requireAccess(context.appUser, { screen: "hospital", hospitalId: params.hospitalId });
  },
  component: () => (
    <ScreenShell
      title="Tableau des arrivées"
      description="Fiches AT-MIST entrantes : accepter ou dérouter."
      issue="#12"
    />
  ),
});
