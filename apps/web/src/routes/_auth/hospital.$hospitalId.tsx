import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import HospitalBoard from "@/components/hospital-board";
import { HospitalStats } from "@/components/hospital-stats";
import { PageHeader } from "@/components/screen-shell";
import { requireAccess } from "@/lib/guard";

export const Route = createFileRoute("/_auth/hospital/$hospitalId")({
  beforeLoad: ({ context, params }) => {
    requireAccess(context.appUser, { screen: "hospital", hospitalId: params.hospitalId });
  },
  component: HospitalScreen,
});

const TABS = [
  { id: "arrivals", label: "Arrivées" },
  { id: "stats", label: "Statistiques" },
] as const;

function HospitalScreen() {
  const { hospitalId } = Route.useParams();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("arrivals");
  return (
    <>
      <PageHeader
        title="Tableau des arrivées"
        description="Fiches AT-MIST entrantes en direct : accepter ou dérouter en indiquant la spécialité indisponible."
      />
      <div role="tablist" aria-label="Vues de l'hôpital" className="flex gap-1 border-b px-4 md:px-6">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`hospital-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`hospital-panel-${id}`}
            onClick={() => setTab(id)}
            className={`min-h-11 cursor-pointer border-b-2 px-4 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-ring ${
              tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`hospital-panel-${tab}`} aria-labelledby={`hospital-tab-${tab}`}>
        {tab === "arrivals" ? <HospitalBoard hospitalId={hospitalId} /> : <HospitalStats hospitalId={hospitalId} />}
      </div>
    </>
  );
}
