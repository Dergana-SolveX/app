import { createFileRoute } from "@tanstack/react-router";

import DispatcherWorkspace from "@/components/dispatcher/workspace";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/dispatcher")({
  beforeLoad: ({ context }) => {
    requireAccess(context.appUser, { screen: "dispatcher" });
  },
  component: DispatcherScreen,
});

function DispatcherScreen() {
  return <DispatcherWorkspace />;
}
