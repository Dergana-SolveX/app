import { EmulationBadge } from "@solvex-dergana/ui/components/emulation-badge";
import { ConstructionIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Page frame shared by every screen: title block + content area. */
export function PageHeader({
  title,
  description,
  badges,
}: {
  title: string;
  description?: string;
  badges?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-card px-4 py-5 md:px-6">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight md:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {badges}
    </div>
  );
}

/** Empty screen until its own issue builds the real one. */
export default function ScreenShell({
  title,
  description,
  issue,
  emulated,
}: {
  title: string;
  description: string;
  /** GitHub issue that builds this screen, e.g. "#6". */
  issue: string;
  emulated?: boolean;
}) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        badges={emulated ? <EmulationBadge /> : undefined}
      />
      <div className="p-4 md:p-6">
        <div className="grid place-items-center rounded-lg border border-dashed bg-card/60 px-6 py-16 text-center">
          <span className="mb-4 grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
            <ConstructionIcon className="size-6" aria-hidden="true" />
          </span>
          <p className="text-base font-bold">Écran en cours de construction</p>
          <p className="mt-1 max-w-md text-muted-foreground">
            Cet écran sera construit dans l'issue {issue}. Votre rôle et vos accès fonctionnent déjà.
          </p>
        </div>
      </div>
    </>
  );
}
