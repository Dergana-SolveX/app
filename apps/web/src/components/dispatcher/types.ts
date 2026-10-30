import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@solvex-dergana/api/routers/index";
type Output = inferRouterOutputs<AppRouter>["incidents"];
export type Incident = Output["list"][number];
export type IncidentDetail = Output["byId"];
export type Profiles = Output["profiles"];
export type MapLayers = Output["mapLayers"];
export const statusLabels: Record<Incident["status"], string> = {
  open: "En attente",
  dispatched: "Engagé",
  on_scene: "Sur les lieux",
  transporting: "Transport",
  handed_over: "Transmis",
  closed: "Clos",
  false_alarm: "Fausse alerte",
};
export const isActive = (incident: Pick<Incident, "status">) =>
  !["closed", "false_alarm", "handed_over"].includes(incident.status);
