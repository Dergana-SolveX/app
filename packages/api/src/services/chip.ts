import type { Database } from "@solvex-dergana/db";
import { vehicles } from "@solvex-dergana/db/schema/index";
import { deriveDeviceKey, encodeSvx, geohashEncode, type Packet, type SvxAlert } from "@solvex-dergana/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import type { ChipGateway } from "../context";
import type { SmsTransport } from "../sms/transport";
import { createDeviceClient } from "./device-client";
import type { EventBus } from "./events";
import { receiveSms } from "./sms-flow";

type Deps = { db: Database; events: EventBus; smsTransport: SmsTransport; chip: ChipGateway | undefined };

/** What the simulated chip decided to send: the packet of `packages/shared/chip-sim`, without its own clock. */
export type ChipPacket = Omit<Packet, "eventMs">;

function gatewayOf(chip: ChipGateway | undefined): ChipGateway {
  if (!chip) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La puce simulée n'est pas configurée sur ce serveur" });
  }
  return chip;
}

const clientOf = (chip: ChipGateway, deviceId: string) =>
  createDeviceClient({ deviceId, masterDeviceSecret: chip.masterDeviceSecret, baseUrl: chip.baseUrl, fetch: chip.fetch });

/** Turns the answer of the device endpoint into the matching error. */
function failWith(status: number, error: unknown): never {
  const reason = typeof error === "string" ? error : "device_error";
  if (status === 404) throw new TRPCError({ code: "NOT_FOUND", message: reason });
  // Not UNAUTHORIZED: that would look like the presenter's own session was lost, when it is the chip that was refused.
  if (status === 401) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `La puce a été refusée par le serveur (${reason})` });
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Device endpoint answered ${status}: ${reason}` });
}

/**
 * The simulated chip sends its packet the way a real one would (PRD FR-S8-03). By the web: a signed POST to the
 * real `/devices/:id/events` endpoint. By SMS (zone blanche): the real SVX string, signed with the device key and
 * sent from the chip's SIM through the SMS path. Both are flagged emulated, and keep the time of the crash.
 */
export async function transmitFromChip(
  { db, events, smsTransport, chip }: Deps,
  input: { deviceId: string; channel: "http" | "sms"; packet: ChipPacket; position: { lat: number; lng: number }; eventAt: number },
) {
  const gateway = gatewayOf(chip);
  const { packet, position } = input;
  // The page's clock has fractions of a millisecond; the crash time is kept in whole milliseconds.
  const eventAt = Math.round(input.eventAt);

  if (input.channel === "http") {
    const answer = await clientOf(gateway, input.deviceId).sendCrashEvent({
      emulated: true,
      traceInjected: true,
      data: {
        gForce: packet.peakG,
        deltaVKmh: packet.deltaVKmh,
        rollover: packet.rollover,
        ...(packet.rolloverDeg !== null ? { rolloverDeg: packet.rolloverDeg } : {}),
        fire: packet.fire,
        impacts: packet.impacts,
        saturated: packet.saturated,
        lat: position.lat,
        lng: position.lng,
        accuracyM: 5,
        // The crash time travels in the body: the request time is only for the replay check.
        eventAt,
      },
    });
    if (!answer.ok) failWith(answer.status, answer.error);
    return { ok: true as const, channel: "http" as const, incidentId: answer.incidentId ?? null, ack: answer.ack ?? null, sms: null };
  }

  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.deviceId, input.deviceId));
  if (!vehicle) throw new TRPCError({ code: "NOT_FOUND", message: "device_not_found" });
  if (!vehicle.simMsisdn) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Cette puce n'a pas de carte SIM enregistrée" });

  const alert: SvxAlert = {
    layer: 1,
    geohash: geohashEncode(position.lat, position.lng, 8),
    eventMinutes: Math.floor(eventAt / 60_000),
    peakG: packet.peakG,
    rollover: packet.rollover,
    fire: packet.fire,
    victims: null,
    conscious: null,
    trapped: null,
    bleeding: null,
    profileCode: null,
    deltaVKmh: packet.deltaVKmh,
    cell: null,
  };
  const deviceKey = await deriveDeviceKey(gateway.masterDeviceSecret, input.deviceId);
  const body = await encodeSvx(alert, { deviceKey });
  const result = await receiveSms(
    { db, events, transport: smsTransport, masterDeviceSecret: gateway.masterDeviceSecret },
    { from: vehicle.simMsisdn, body, emulated: true },
  );
  return {
    ok: true as const,
    channel: "sms" as const,
    incidentId: result.kind === "alert" ? result.incidentId : null,
    ack: result.kind === "alert" ? result.ack : null,
    sms: body,
  };
}

/** A heartbeat from the simulated chip, signed, to the real endpoint. */
export async function heartbeatFromChip(
  { chip }: Pick<Deps, "chip">,
  input: { deviceId: string; state: string; batteryPct?: number },
) {
  const answer = await clientOf(gatewayOf(chip), input.deviceId).sendHeartbeat({
    state: input.state,
    ...(input.batteryPct !== undefined ? { batteryPct: input.batteryPct } : {}),
    emulated: true,
  });
  if (!answer.ok) failWith(answer.status, answer.error);
  return { ok: true as const };
}
