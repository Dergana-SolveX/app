import { createFileRoute } from "@tanstack/react-router";

import HospitalBoard from "@/components/hospital-board";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/hospital/$hospitalId")({
  beforeLoad: ({ context, params }) => {
    requireAccess(context.appUser, { screen: "hospital", hospitalId: params.hospitalId });
  },
  component: HospitalScreen,
});

function HospitalScreen() {
  const { hospitalId } = Route.useParams();
  return <HospitalBoard hospitalId={hospitalId} />;
}
