import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import BilanWorkspace from "@/components/bilan/bilan-workspace";
import MissionCard from "@/components/mission-card";
import { PageHeader } from "@/components/screen-shell";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/ambulance/$unitId")({
  beforeLoad: ({ context, params }) => {
    requireAccess(context.appUser, { screen: "ambulance", unitId: params.unitId });
  },
  component: AmbulanceScreen,
});

function AmbulanceScreen() {
  const { unitId } = Route.useParams();
  // The bilan opens on the mission's incident when the medic taps "Ouvrir le bilan".
  const [bilanIncidentId, setBilanIncidentId] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="Tablette ambulance"
        description="Mission reçue du dispatch, puis bilan secouriste : critères de Vittel et indice de choc calculés en direct, sans réseau."
      />
      <MissionCard unitId={unitId} onOpenBilan={setBilanIncidentId} />
      <BilanWorkspace key={bilanIncidentId ?? "picker"} unitId={unitId} initialIncidentId={bilanIncidentId} />
    </>
  );
}
