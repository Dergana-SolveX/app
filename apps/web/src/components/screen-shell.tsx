import type { ReactNode } from "react";

/** Empty placeholder for a role's screen until its own issue builds the real one. */
export default function ScreenShell({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-medium">{title}</h1>
      <p className="text-muted-foreground">Écran à construire.</p>
      {children}
    </main>
  );
}
