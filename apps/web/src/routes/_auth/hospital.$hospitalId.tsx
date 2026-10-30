import { createFileRoute } from "@tanstack/react-router";

import ScreenShell from "@/components/screen-shell";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/hospital/$hospitalId")({
  beforeLoad: ({ context, params }) => {
    requireAccess(context.appUser, { screen: "hospital", hospitalId: params.hospitalId });
  },
  component: () => <ScreenShell title="Urgences — Tableau hôpital" />,
});
