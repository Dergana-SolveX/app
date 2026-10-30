/** "à l'instant", "il y a 3 min", "il y a 2 h", "il y a 4 j" (French, for dense lists). */
export function timeAgo(from: Date | string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(from).getTime()) / 1000));
  if (seconds < 30) return "à l'instant";
  if (seconds < 3600) return `il y a ${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86400) return `il y a ${Math.round(seconds / 3600)} h`;
  return `il y a ${Math.round(seconds / 86400)} j`;
}

/** Clock time for log lines, e.g. "10:42:07". */
export function clockTime(at: Date | string): string {
  return new Date(at).toLocaleTimeString("fr-FR", { hour12: false });
}

/** The 8-character reference shown to humans (and in the SVXACK reply) for an incident id. */
export const incidentRef = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();
