/**
 * Time left before the ambulance reaches the hospital, from the minutes announced when the handover was sent.
 * "MM:SS" while on time (rounded up to the second still to go), "+MM:SS" once past the announced time.
 */
export function arrivalCountdown(
  sentAt: Date | string,
  etaMin: number | null,
  now: Date,
): { text: string; late: boolean } | null {
  if (etaMin === null) return null;
  const remainingMs = new Date(sentAt).getTime() + etaMin * 60_000 - now.getTime();
  const late = remainingMs <= -1000;
  const seconds = late ? Math.floor(-remainingMs / 1000) : Math.max(0, Math.ceil(remainingMs / 1000));
  const text = `${late ? "+" : ""}${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return { text, late };
}
