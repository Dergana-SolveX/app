import { createFileRoute } from "@tanstack/react-router";

import HospitalBoard from "@/components/hospital-board";
import { PageHeader } from "@/components/screen-shell";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/hospital/$hospitalId")({
  beforeLoad: ({ context, params }) => {
    requireAccess(context.appUser, { screen: "hospital", hospitalId: params.hospitalId });
  },
  component: HospitalScreen,
});

function HospitalScreen() {
  const { hospitalId } = Route.useParams();
  return (
    <>
      <PageHeader
        title="Tableau des arrivées"
        description="Fiches AT-MIST entrantes en direct : accepter ou dérouter en indiquant la spécialité indisponible."
      />
      <HospitalBoard hospitalId={hospitalId} />
    </>
  );
}
