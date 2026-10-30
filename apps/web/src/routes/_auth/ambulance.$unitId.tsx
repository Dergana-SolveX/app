import { createFileRoute } from "@tanstack/react-router";

import BilanWorkspace from "@/components/bilan/bilan-workspace";
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
  return (
    <>
      <PageHeader
        title="Tablette ambulance"
        description="Bilan secouriste : critères de Vittel et indice de choc calculés en direct, sans réseau."
      />
      <BilanWorkspace unitId={unitId} />
    </>
  );
}
