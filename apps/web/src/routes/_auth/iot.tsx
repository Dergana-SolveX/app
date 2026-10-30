import { createFileRoute } from "@tanstack/react-router";

import ScreenShell from "@/components/screen-shell";
import { requireAccess } from "@/lib/guard";

// IoT Showcase (PLAN.md S8.6): built in a later issue.
export const Route = createFileRoute("/_auth/iot")({
  beforeLoad: ({ context }) => {
    requireAccess(context.appUser, { screen: "iot" });
  },
  component: () => <ScreenShell title="IoT Showcase" />,
});
