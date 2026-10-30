import { smsLog, smsMenuSessions } from "@solvex-dergana/db/schema/index";
import type { SmsMenuAnswers } from "@solvex-dergana/db/schema/comms";
import { decodeSvx, geocodeLocation } from "@solvex-dergana/shared";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { fileReport } from "./report";
import type { InboundSms } from "./ingest";
import { ackFor } from "./ingest";
import type { SmsFlowDeps } from "./sms-flow";

type Lang = "fr" | "ar";
type Step = "victims" | "conscious" | "danger" | "location";

const START_KEYWORDS = new Set(["accident", "حادث"]);

const QUESTIONS: Record<Lang, Record<Step, string>> = {
  fr: {
    victims: "SVX 1/4 Combien de victimes ? (repondez par un chiffre)",
    conscious: "SVX 2/4 Combien sont conscients ? (chiffre)",
    danger: "SVX 3/4 Danger ? 0=aucun 1=feu 2=coince 3=feu et coince",
    location: "SVX 4/4 Commune ou PK ? ex: Bab Ezzouar ou RN5 PK 12",
  },
  ar: {
    victims: "SVX 1/4 كم عدد الضحايا؟ (أجب برقم)",
    conscious: "SVX 2/4 كم منهم واعون؟ (رقم)",
    danger: "SVX 3/4 خطر؟ 0=لا 1=حريق 2=محاصرون 3=الاثنان",
    location: "SVX 4/4 البلدية أو PK؟ مثال: باب الزوار أو RN5 PK 12",
  },
};

const INVALID: Record<Lang, string> = { fr: "Reponse invalide. ", ar: "رد غير صالح. " };
const UNKNOWN_PLACE: Record<Lang, string> = { fr: "Lieu inconnu. ", ar: "المكان غير معروف. " };

const sha = (algorithm: "sha1" | "sha256", text: string) =>
  createHash(algorithm).update(text).digest("hex");

const isKeyword = (body: string) => START_KEYWORDS.has(body.trim().toLowerCase());

/** Arabic phones type ٠-٩; read them as 0-9. */
const asciiDigits = (text: string) => text.replace(/[٠-٩]/g, (digit) => `${digit.charCodeAt(0) - 0x0660}`);

/** A conversation left unanswered this long is forgotten: a late "3" is then just an SMS, not an answer. */
const SESSION_TTL_MS = 15 * 60_000;

/** A whole number from what the caller typed, or null. */
function toCount(body: string): number | null {
  const text = asciiDigits(body).trim();
  return /^\d{1,2}$/.test(text) ? Number(text) : null;
}

type Next = { step: Step; answers: SmsMenuAnswers } | { reply: string };

/** Applies one answer to the question the phone was asked. A `reply` means the answer was refused. */
function applyAnswer(step: Exclude<Step, "location">, answers: SmsMenuAnswers, body: string, lang: Lang): Next {
  const refuse = { reply: INVALID[lang] + QUESTIONS[lang][step] };
  const count = toCount(body);
  if (count === null) return refuse;
  if (step === "victims") return { step: "conscious", answers: { ...answers, victims: count } };
  if (step === "conscious") {
    if (count > (answers.victims ?? 0)) return refuse;
    return { step: "danger", answers: { ...answers, conscious: count } };
  }
  if (count > 3) return refuse;
  return { step: "location", answers: { ...answers, fire: count === 1 || count === 3, trapped: count === 2 || count === 3 } };
}

/**
 * The interactive menu for phones that only do SMS (PRD FR-S3-14). Returns the texts it sent back when it
 * took the SMS (so the normal SVX ingest must not see it), or null when the SMS is not part of a menu conversation.
 */
export async function handleMenuSms(deps: SmsFlowDeps, sms: InboundSms): Promise<string[] | null> {
  const { db, transport } = deps;
  const replies: string[] = [];
  const reply = async (body: string, meta?: { incidentId?: string }) => {
    await transport.send(sms.from, body, meta);
    replies.push(body);
  };
  const senderHash = sha("sha256", sms.from);
  const receivedAt = sms.receivedAt ?? new Date();
  const [stored] = await db.select().from(smsMenuSessions).where(eq(smsMenuSessions.msisdnHash, senderHash));
  const session = stored && receivedAt.getTime() - stored.updatedAt.getTime() <= SESSION_TTL_MS ? stored : undefined;
  const starting = isKeyword(sms.body);
  if (!starting && !session) return null;
  // A real SVX alert is never a menu answer, even from a phone mid-conversation: it goes to the normal ingest.
  if (!starting && decodeSvx(sms.body).recognized) return null;

  const [logged] = await db
    .insert(smsLog)
    .values({ direction: "in", msisdnHash: senderHash, body: sms.body, status: "received", at: receivedAt, emulated: sms.emulated })
    .returning({ id: smsLog.id });

  const save = (lang: Lang, step: Step, answers: SmsMenuAnswers) =>
    db
      .insert(smsMenuSessions)
      .values({ msisdnHash: senderHash, lang, step, answers, updatedAt: receivedAt })
      .onConflictDoUpdate({ target: smsMenuSessions.msisdnHash, set: { lang, step, answers, updatedAt: receivedAt } });

  if (starting) {
    const lang: Lang = sms.body.trim() === "حادث" ? "ar" : "fr";
    await save(lang, "victims", {});
    await reply(QUESTIONS[lang].victims);
    return replies;
  }

  const { lang, step, answers } = session!;

  if (step !== "location") {
    const next = applyAnswer(step, answers, sms.body, lang);
    if ("reply" in next) {
      await reply(next.reply);
    } else {
      await save(lang, next.step, next.answers);
      await reply(QUESTIONS[lang][next.step]);
    }
    return replies;
  }

  const place = geocodeLocation(sms.body);
  if (!place) {
    await reply(UNKNOWN_PLACE[lang] + QUESTIONS[lang].location);
    return replies;
  }

  // Claimed before filing, so a repeat of this last answer (or a gateway retry) cannot file a second incident.
  const claimed = await db.delete(smsMenuSessions).where(eq(smsMenuSessions.msisdnHash, senderHash)).returning();
  if (claimed.length === 0) return replies;

  try {
    const incident = await fileReport(deps, {
      alertRow: {
        source: "ussd",
        channel: "sms",
        receivedAt,
        eventAt: receivedAt,
        lat: place.lat,
        lng: place.lng,
        accuracyM: place.uncertaintyM,
        victims: answers.victims ?? null,
        conscious: answers.conscious ?? null,
        fire: answers.fire ?? null,
        trapped: answers.trapped ?? null,
        rawPayload: sms.body,
        parseErrors: [],
        senderMsisdnHash: senderHash,
        dedupeKey: sha("sha1", `menu${senderHash}${receivedAt.toISOString()}`),
        emulated: sms.emulated,
      },
      position: { lat: place.lat, lng: place.lng, accuracyM: place.uncertaintyM },
      eventAt: receivedAt,
      said: { commune: place.commune, roadRef: place.roadRef, pk: place.pk },
    });
    if (!incident) return replies;

    await db.update(smsLog).set({ incidentId: incident.id }).where(eq(smsLog.id, logged!.id));
    await reply(ackFor(incident.id), { incidentId: incident.id });
    return replies;
  } catch (error) {
    // Keep the conversation so the phone can answer again, and keep the SMS on record as failed.
    await save(lang, step, answers).catch(() => undefined);
    await db.update(smsLog).set({ status: "failed" }).where(eq(smsLog.id, logged!.id)).catch(() => undefined);
    throw error;
  }
}
