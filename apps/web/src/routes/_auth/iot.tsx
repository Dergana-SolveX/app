import { createFileRoute } from "@tanstack/react-router";

import IotShowcase from "@/components/iot/iot-showcase";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/iot")({
  beforeLoad: ({ context }) => {
    requireAccess(context.appUser, { screen: "iot" });
  },
  component: IotShowcase,
});
