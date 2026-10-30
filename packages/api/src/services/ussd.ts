import type { Database } from "@solvex-dergana/db";
import { ussdSessions } from "@solvex-dergana/db/schema/index";
import { geocodeLocation } from "@solvex-dergana/shared";
import { and, eq, lte } from "drizzle-orm";
import { createHash } from "node:crypto";

import { resolveCell } from "./cells";
import type { EventBus } from "./events";
import { ackFor } from "./ingest";
import { fileReport, type SaidPlace } from "./report";

export type UssdRequest = {
  sessionId: string;
  serviceCode: string;
  phoneNumber: string;
  /** Every answer so far, joined by `*` (empty on the first request). */
  text: string;
  /** The cell the call is on, decimal `mcc-mnc-lac-cid`: a real operator supplies it, the emulator picks a real tower. */
  cellId?: string;
};

/** `CON`: the dialogue continues with this text. `END`: it is over. */
export type UssdResponse = { type: "CON" | "END"; message: string };

type Deps = { db: Database; events: EventBus };

/** A USSD session that stays silent this long is over: real operators close it without telling us (PRD FR-S3-15). */
export const USSD_TIMEOUT_MS = 120_000;

const sha = (algorithm: "sha1" | "sha256", text: string) => createHash(algorithm).update(text).digest("hex");

const QUESTIONS = [
  "SVX Rescue - accident de la route\nCombien de victimes ?\n1. Une\n2. Deux\n3. Trois ou plus",
  "Victimes conscientes ?\n1. Oui\n2. Non\n3. Ne sait pas",
  "Danger ?\n1. Feu\n2. Incarcere\n3. Saignement\n4. Aucun",
  "Commune ou PK ? (ex: Rouiba, RN5 PK 12)\n0. Passer",
  "Envoyer l'alerte aux secours ?\n1. Oui\n2. Annuler",
];

const ONE_TO = (max: number) => (answer: string) => /^[1-9]$/.test(answer) && Number(answer) <= max;
/** Does this answer fit question number `step`? The place question takes any text. */
const FITS = [ONE_TO(3), ONE_TO(3), ONE_TO(4), (answer: string) => answer.trim() !== "", ONE_TO(2)];

/** The answers given so far that fit their question, and whether an answer that did not fit was given. */
function readAnswers(text: string) {
  const inputs = text === "" ? [] : text.split("*");
  const valid: string[] = [];
  for (const [step, answer] of inputs.entries()) {
    if (step >= FITS.length || !FITS[step]!(answer)) return { valid, refused: true };
    valid.push(answer);
  }
  return { valid, refused: false };
}

/** What the caller's answers say about the accident. */
function factsFrom([victims, conscious, danger, place]: string[]) {
  return {
    victims: victims === undefined ? null : Number(victims), // "3" means three or more
    conscious: conscious === undefined ? null : ({ "1": 1, "2": 0, "3": 2 } as const)[conscious as "1"], // protocol: 0 none, 1 all, 2 unknown
    fire: danger === undefined ? null : danger === "1",
    trapped: danger === undefined ? null : danger === "2",
    bleeding: danger === undefined ? null : danger === "3",
    typedPlace: place === undefined || place === "0" ? null : place,
  };
}

/** Parses `603-1-100-2` (mcc-mnc-lac-cid). */
function parseCellId(cellId: string | null) {
  const match = /^(\d+)-(\d+)-(\d+)-(\d+)$/.exec(cellId ?? "");
  return match ? { mcc: +match[1]!, mnc: +match[2]!, lac: +match[3]!, cid: +match[4]! } : null;
}

const sentMessage = (incidentId: string) => `Alerte envoyee aux secours. Reference : ${ackFor(incidentId).replace("SVXACK#", "")}`;

type Session = typeof ussdSessions.$inferSelect;

/**
 * Files what a session has answered so far as an alert, and closes the session.
 * Returns null when nothing valid was answered (then there is nothing to report).
 */
async function fileSession({ db, events }: Deps, session: Session, at: Date) {
  const { valid } = readAnswers(session.text);
  const facts = factsFrom(valid);
  if (facts.victims === null) {
    await db.update(ussdSessions).set({ status: "done" }).where(eq(ussdSessions.sessionId, session.sessionId));
    return null;
  }

  // Two ways to place it: the tower the call came through, and the place the caller typed. The more precise wins.
  const cell = parseCellId(session.cellId);
  const tower = cell ? await resolveCell(db, cell) : null;
  const typed = facts.typedPlace ? geocodeLocation(facts.typedPlace) : null;
  const fromCell = tower ? { lat: tower.lat, lng: tower.lng, accuracyM: tower.rangeM } : null;
  const fromTyped = typed ? { lat: typed.lat, lng: typed.lng, accuracyM: typed.uncertaintyM } : null;
  const position = fromCell && fromTyped ? (fromTyped.accuracyM < fromCell.accuracyM ? fromTyped : fromCell) : (fromCell ?? fromTyped);
  const said: SaidPlace | undefined = typed ? { commune: typed.commune, roadRef: typed.roadRef, pk: typed.pk } : undefined;

  const incident = await fileReport(
    { db, events },
    {
      alertRow: {
        source: "ussd",
        channel: "ussd",
        receivedAt: at,
        eventAt: at,
        lat: position?.lat ?? null,
        lng: position?.lng ?? null,
        accuracyM: position?.accuracyM ?? null,
        victims: facts.victims,
        conscious: facts.conscious,
        fire: facts.fire,
        trapped: facts.trapped,
        bleeding: facts.bleeding,
        rawPayload: session.text,
        // Saved on a timeout or a wrong key: not every question was answered.
        parseErrors: valid.length < FITS.length - 1 ? ["partial"] : [],
        senderMsisdnHash: session.msisdnHash,
        dedupeKey: sha("sha1", `ussd${session.sessionId}`),
        emulated: session.emulated,
      },
      position,
      eventAt: at,
      said,
    },
  );
  await db
    .update(ussdSessions)
    .set({ status: "done", incidentId: incident?.id ?? null })
    .where(eq(ussdSessions.sessionId, session.sessionId));
  return incident;
}

/**
 * One request of the USSD aggregator callback (PRD FR-S3-15): the next question, or the end of the dialogue.
 * `emulated` is true when the "operator" is our emulator panel (honesty rule); a real operator's call is not.
 */
export async function handleUssd(
  deps: Deps,
  request: UssdRequest,
  { emulated, now = new Date() }: { emulated: boolean; now?: Date },
): Promise<UssdResponse> {
  const { db } = deps;
  const [known] = await db.select().from(ussdSessions).where(eq(ussdSessions.sessionId, request.sessionId));
  if (known?.status === "done") {
    // A repeat of the last request, or the caller coming back after the session was closed on a timeout.
    return known.incidentId ? { type: "END", message: sentMessage(known.incidentId) } : { type: "END", message: "Session terminee." };
  }

  const [session] = await db
    .insert(ussdSessions)
    .values({
      sessionId: request.sessionId,
      msisdnHash: sha("sha256", request.phoneNumber),
      text: request.text,
      cellId: request.cellId ?? null,
      emulated,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: ussdSessions.sessionId,
      // The operator may supply the cell only on some requests: keep the one we already know.
      set: { text: request.text, updatedAt: now, ...(request.cellId ? { cellId: request.cellId } : {}) },
    })
    .returning();

  const { valid, refused } = readAnswers(request.text);
  if (refused) {
    await fileSession(deps, session!, now); // what was answered before the wrong key is not lost
    return { type: "END", message: "Choix invalide. Recomposez *140#." };
  }
  if (valid.length < FITS.length) return { type: "CON", message: QUESTIONS[valid.length]! };

  if (valid[FITS.length - 1] === "2") {
    await db.update(ussdSessions).set({ status: "done" }).where(eq(ussdSessions.sessionId, request.sessionId));
    return { type: "END", message: "Alerte annulee." };
  }
  const incident = await fileSession(deps, session!, now);
  return { type: "END", message: incident ? sentMessage(incident.id) : "Alerte envoyee aux secours." };
}

/**
 * Closes the sessions that went quiet (`USSD_TIMEOUT_MS`), saving what they answered as an alert: a caller whose
 * line dropped must not lose the report (NFR-P6). Returns how many alerts it filed. Run it every few seconds.
 */
export async function sweepUssdSessions(deps: Deps, now = new Date()): Promise<number> {
  const quiet = await deps.db
    .select()
    .from(ussdSessions)
    .where(and(eq(ussdSessions.status, "open"), lte(ussdSessions.updatedAt, new Date(now.getTime() - USSD_TIMEOUT_MS))));

  let filed = 0;
  for (const session of quiet) {
    // The alert is dated when the caller last spoke, not when we noticed the silence.
    if (await fileSession(deps, session, session.updatedAt)) filed++;
  }
  return filed;
}
