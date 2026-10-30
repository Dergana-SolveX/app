import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/iot/")({
  component: IotShowcase,
});

// IoT Showcase (PLAN.md S8.6): live chip view + scenario triggers.
function IotShowcase() {
  return <div>IoT Showcase</div>;
}
