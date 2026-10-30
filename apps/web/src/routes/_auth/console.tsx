import { createFileRoute } from "@tanstack/react-router";

import ScreenShell from "@/components/screen-shell";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/console")({
  beforeLoad: ({ context }) => {
    requireAccess(context.appUser, { screen: "console" });
  },
  component: () => <ScreenShell title="Console de démonstration" />,
});
