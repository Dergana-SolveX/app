import { describe, expect, it } from "vitest";
import { computeJourneyHops, type JourneyEventTimeline } from "./journey-timeline";

describe("Alert journey timeline (FR-S8-08, FR-S8-10)", () => {
  it("stays completely idle when no transmission has occurred", () => {
    const timeline: JourneyEventTimeline = {
      transmissions: [],
      records: [],
      nowMs: 1000,
    };

    const hops = computeJourneyHops(timeline);
    expect(hops).toHaveLength(4);
    expect(hops.every((h) => h.status === "idle")).toBe(true);
    expect(hops.every((h) => h.latencyMs === null)).toBe(true);
  });

  it("lights up Hop 1 (Chip) when impact is detected", () => {
    const timeline: JourneyEventTimeline = {
      transmissions: [],
      records: [
        {
          tMs: 500,
          type: "impact_detected",
          data: { peakG: 28, durationMs: 80, deltaVKmh: 35, merged: false },
        },
      ],
      nowMs: 600,
    };

    const hops = computeJourneyHops(timeline);
    expect(hops[0]!.id).toBe("chip");
    expect(hops[0]!.status).toBe("active");
    expect(hops[0]!.timestampMs).toBe(500);

    // Later hops must remain idle (deterministic rule FR-S8-10)
    expect(hops[1]!.status).toBe("idle");
    expect(hops[2]!.status).toBe("idle");
    expect(hops[3]!.status).toBe("idle");
  });

  it("lights up Hop 2 (Network GSM) when transmission is sent", () => {
    const timeline: JourneyEventTimeline = {
      transmissions: [
        {
          id: 1,
          attempt: 1,
          channel: "sms",
          status: "pending",
          packet: {
            cause: "impact",
            impacts: 1,
            peakG: 28,
            deltaVKmh: 35,
            rollover: false,
            rolloverDeg: null,
            fire: false,
            eventMs: 500,
            saturated: false,
          },
          incidentId: null,
          ack: null,
          sms: null,
          error: null,
          sentAtMs: 10500, // after 10s confirm
        },
      ],
      records: [
        {
          tMs: 500,
          type: "impact_detected",
          data: { peakG: 28, durationMs: 80, deltaVKmh: 35, merged: false },
        },
        {
          tMs: 10500,
          type: "sms_sent",
          data: { attempt: 1 },
        },
      ],
      nowMs: 10600,
    };

    const hops = computeJourneyHops(timeline);
    expect(hops[0]!.status).toBe("completed");
    expect(hops[1]!.status).toBe("active");
    expect(hops[1]!.id).toBe("gsm");
    expect(hops[1]!.timestampMs).toBe(10500);
    expect(hops[1]!.latencyMs).toBe(10000); // 10500 - 500

    // Server and Dispatcher are not yet reached
    expect(hops[2]!.status).toBe("idle");
    expect(hops[3]!.status).toBe("idle");
  });

  it("lights up Hop 3 (Server Ingest & Triage) and Hop 4 (Dispatcher) on server ACK", () => {
    const timeline: JourneyEventTimeline = {
      transmissions: [
        {
          id: 1,
          attempt: 1,
          channel: "sms",
          status: "ok",
          packet: {
            cause: "impact",
            impacts: 1,
            peakG: 28,
            deltaVKmh: 35,
            rollover: false,
            rolloverDeg: null,
            fire: false,
            eventMs: 500,
            saturated: false,
          },
          incidentId: "inc-1234",
          ack: "SVXACK#1234",
          sms: "SVX1...#HABC",
          error: null,
          sentAtMs: 10500,
          ackedAtMs: 10850,
        },
      ],
      records: [
        {
          tMs: 500,
          type: "impact_detected",
          data: { peakG: 28, durationMs: 80, deltaVKmh: 35, merged: false },
        },
        {
          tMs: 10500,
          type: "sms_sent",
          data: { attempt: 1 },
        },
        {
          tMs: 10850,
          type: "ack_received",
          data: { ack: "SVXACK#1234" },
        },
      ],
      nowMs: 11000,
    };

    const hops = computeJourneyHops(timeline);
    expect(hops[0]!.status).toBe("completed");
    expect(hops[1]!.status).toBe("completed");
    expect(hops[2]!.status).toBe("completed");
    expect(hops[2]!.id).toBe("server");
    expect(hops[2]!.latencyMs).toBe(350); // 10850 - 10500

    expect(hops[3]!.status).toBe("completed");
    expect(hops[3]!.id).toBe("dispatcher");
    expect(hops[3]!.incidentId).toBe("inc-1234");
    expect(hops[3]!.totalLatencyMs).toBe(10350); // 10850 - 500
  });

  it("marks Hop 2 as failed when transmission fails without fabricating server events", () => {
    const timeline: JourneyEventTimeline = {
      transmissions: [
        {
          id: 1,
          attempt: 1,
          channel: "http",
          status: "failed",
          packet: {
            cause: "impact",
            impacts: 1,
            peakG: 28,
            deltaVKmh: 35,
            rollover: false,
            rolloverDeg: null,
            fire: false,
            eventMs: 500,
            saturated: false,
          },
          incidentId: null,
          ack: null,
          sms: null,
          error: "serveur injoignable",
          sentAtMs: 10500,
        },
      ],
      records: [
        {
          tMs: 500,
          type: "impact_detected",
          data: { peakG: 28, durationMs: 80, deltaVKmh: 35, merged: false },
        },
        {
          tMs: 10500,
          type: "http_sent",
          data: { attempt: 1 },
        },
      ],
      nowMs: 11000,
    };

    const hops = computeJourneyHops(timeline);
    expect(hops[1]!.status).toBe("failed");
    expect(hops[1]!.error).toBe("serveur injoignable");
    expect(hops[2]!.status).toBe("idle");
    expect(hops[3]!.status).toBe("idle");
  });
});
