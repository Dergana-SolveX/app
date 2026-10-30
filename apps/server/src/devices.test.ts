import { createEventBus } from "@solvex-dergana/api/services/events";
import { createHmac } from "node:crypto";
import { createTestDb } from "@solvex-dergana/db/testing";
import { vehicles } from "@solvex-dergana/db/schema/profiles";
import { deriveDeviceKey, deviceKeyCheck, chipCommand } from "@solvex-dergana/shared";
import { z } from "zod";
import { expect, it } from "vitest";
import { createDevicesApp } from "./devices";

const auditSchema = z.array(chipCommand.extend({
  status: z.string(), issuedBy: z.string().nullable(), ackedAt: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
}));
const auditLog = async (response: Response) => auditSchema.parse(await response.json());
const heartbeatBody = async (response: Response) => z.object({ commands: z.array(chipCommand) }).parse(await response.json());

const masterSecret = "test-master-device-secret-0123456789";
const deviceId = "SVX-CHIP-001";
async function setup() {
  const db = await createTestDb();
  const key = await deriveDeviceKey(masterSecret, deviceId);
  await db.insert(vehicles).values({ deviceId, deviceSecretHash: await deviceKeyCheck(key) });
  let time = Date.parse("2026-10-30T12:00:00Z");
  const app = createDevicesApp({ db, masterSecret, events: createEventBus(), now: () => new Date(time),
    authenticate: async (request) => {
      const role = request.headers.get("x-test-role");
      return role ? { id: "admin-1", role } : null;
    },
  });
  const request = (path: string, body?: unknown, role: string | null = "admin") => app.request(`/devices/${deviceId}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(role ? { "x-test-role": role } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const signed = (path: string, body: unknown, options: { key?: Uint8Array; timestamp?: number } = {}) => {
    const raw = JSON.stringify(body);
    const timestamp = String(options.timestamp ?? time);
    const signature = createHmac("sha256", options.key ?? key).update(raw).digest("hex");
    return app.request(`/devices/${deviceId}/${path}`, { method: "POST", body: raw,
      headers: { "content-type": "application/json", "X-SVX-Timestamp": timestamp, "X-SVX-Signature": signature } });
  };
  return { app, request, signed, key, advance: (ms: number) => { time += ms; } };
}

it("only an admin can queue or read device commands", async () => {
  const { request } = await setup();
  for (const role of [null, "dispatcher", "medic", "hospital"]) {
    const status = role ? 403 : 401;
    expect((await request("commands", { cmd: "selftest" }, role)).status).toBe(status);
    expect((await request("commands", undefined, role)).status).toBe(status);
  }
});

it("queues signed commands with unique increasing sequences and an attributable audit history", async () => {
  const { request, key } = await setup();
  const responses = await Promise.all(Array.from({ length: 3 }, () => request("commands", { cmd: "selftest" })));
  expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
  const audit = await auditLog(await request("commands"));
  expect(audit.map((c: { seq: number }) => c.seq)).toEqual([1, 2, 3]);
  for (const command of audit) {
    expect(command).toMatchObject({ cmd: "selftest", args: [], status: "queued", issuedBy: "admin-1" });
    // Independently implement the documented wire encoding with Node crypto.
    expect(command.hmac).toBe(createHmac("sha256", key).update(JSON.stringify([deviceId, command.seq, "selftest", []])).digest("hex"));
  }
});

it("delivers pending commands on signed heartbeats and records an idempotent acknowledgement", async () => {
  const { request, signed } = await setup();
  await request("commands", { cmd: "selftest" });
  const heartbeat = { deviceId, emulated: true };
  const delivered = await signed("heartbeat", heartbeat);
  expect(delivered.status).toBe(200);
  expect((await heartbeatBody(delivered)).commands).toEqual([expect.objectContaining({ seq: 1, cmd: "selftest" })]);
  expect((await auditLog(await request("commands")))[0]!.status).toBe("delivered");
  // A lost heartbeat response is safe to retry until the device acknowledges.
  expect((await heartbeatBody(await signed("heartbeat", heartbeat))).commands).toHaveLength(1);
  const ack = { deviceId, t: 1793361600000, type: "command_ack", data: { seq: 1, result: { ok: true } }, emulated: true };
  expect((await signed("events", ack)).status).toBe(200);
  expect((await signed("events", ack)).status).toBe(200);
  const audit = await auditLog(await request("commands"));
  expect(audit[0]!).toMatchObject({ status: "acked", result: { ok: true, emulated: true }, ackedAt: "2026-10-30T12:00:00.000Z" });
  expect((await heartbeatBody(await signed("heartbeat", heartbeat))).commands).toEqual([]);
});

it("expires queued and delivered commands after 60 seconds and never reuses sequences", async () => {
  const { request, signed, advance } = await setup();
  await request("commands", { cmd: "selftest" });
  await signed("heartbeat", { deviceId, emulated: true });
  await request("commands", { cmd: "selftest" });
  advance(60_001);
  expect((await heartbeatBody(await signed("heartbeat", { deviceId, emulated: true }))).commands).toEqual([]);
  expect((await signed("events", { deviceId, t: 1793361660001, type: "command_ack", data: { seq: 1, result: { ok: true } } })).status).toBe(200);
  expect((await auditLog(await request("commands"))).map((c: { status: string }) => c.status)).toEqual(["timeout", "timeout"]);
  expect(await (await request("commands", { cmd: "selftest" })).json()).toMatchObject({ seq: 3 });
});

it("rejects forged or stale device requests and acknowledgements for undelivered commands", async () => {
  const { request, signed } = await setup();
  await request("commands", { cmd: "selftest" });
  for (const path of ["heartbeat", "events"]) {
    expect((await request(path, { deviceId })).status).toBe(401);
    expect((await signed(path, { deviceId }, { key: new Uint8Array(32) })).status).toBe(401);
    expect((await signed(path, { deviceId }, { timestamp: 1793361200000 })).status).toBe(401);
  }
  expect((await signed("heartbeat", { deviceId: "another-device" })).status).toBe(400);
  expect((await signed("events", { deviceId, t: 1793361600000, type: "command_ack", data: { seq: 1, result: {} } })).status).toBe(409);
  expect((await auditLog(await request("commands")))[0]!.status).toBe("queued");
});

it("a simulated chip polls the API, executes a command, and reports an audited result", async () => {
  const { createSimulatedChip } = await import("@solvex-dergana/shared/chip/simulator");
  const { request, app, key } = await setup();
  await request("commands", { cmd: "arm", args: ["on"] });
  const chip = createSimulatedChip({ deviceId, key, now: () => 1793361600000,
    request: async (path, init) => app.request(path, init) });
  await chip.poll();
  expect(chip.snapshot()).toMatchObject({ demoArm: true, lastSeq: 1 });
  expect((await auditLog(await request("commands")))[0]!).toMatchObject({ status: "acked", result: { ok: true, emulated: true } });
});

it("the simulated chip refuses unarmed traces and consumes channel, trace and selftest commands", async () => {
  const { createSimulatedChip } = await import("@solvex-dergana/shared/chip/simulator");
  const { request, app, key } = await setup();
  const chip = createSimulatedChip({ deviceId, key, now: () => 1793361600000, request: async (path, init) => app.request(path, init) });
  await request("commands", { cmd: "inject_trace", args: ["frontal_40"] });
  await chip.poll();
  expect((await auditLog(await request("commands")))[0]!.result).toMatchObject({ ok: false, error: "Demo arm is off" });
  for (const command of [{ cmd: "arm", args: ["on"] }, { cmd: "force_channel", args: ["sms"] },
    { cmd: "inject_trace", args: ["pothole"] }, { cmd: "selftest" }]) await request("commands", command);
  await chip.poll();
  expect(chip.snapshot()).toMatchObject({ demoArm: true, channel: "sms", lastTrace: "pothole", lastSeq: 5 });
  expect((await auditLog(await request("commands"))).slice(1).every((c) => c.result?.ok)).toBe(true);
});

it("the simulated chip retries a lost acknowledgement without re-executing an old command", async () => {
  const { createSimulatedChip } = await import("@solvex-dergana/shared/chip/simulator");
  const { request, app, key } = await setup();
  await request("commands", { cmd: "arm", args: ["on"] });
  let loseAck = true;
  const chip = createSimulatedChip({ deviceId, key, now: () => 1793361600000, request: async (path, init) => {
    if (path.endsWith("events") && loseAck) { loseAck = false; return new Response(null, { status: 503 }); }
    return app.request(path, init);
  } });
  await expect(chip.poll()).rejects.toThrow("503");
  expect(chip.snapshot()).toMatchObject({ lastSeq: 1, demoArm: true });
  await chip.poll();
  expect((await auditLog(await request("commands")))[0]!.status).toBe("acked");
});

it("the simulated chip rejects tampered signatures and ignores older valid commands", async () => {
  const { createSimulatedChip } = await import("@solvex-dergana/shared/chip/simulator");
  const { request, app, key } = await setup();
  const queued = chipCommand.parse(await (await request("commands", { cmd: "arm", args: ["on"] })).json());
  let override: unknown[] | undefined = [{ ...queued, args: ["off"] }];
  const chip = createSimulatedChip({ deviceId, key, now: () => 1793361600000, request: async (path, init) => {
    if (path.endsWith("heartbeat") && override) return Response.json({ commands: override });
    return app.request(path, init);
  } });
  await chip.poll();
  expect(chip.snapshot()).toMatchObject({ lastSeq: 0, demoArm: false });
  override = undefined;
  await chip.poll();
  await request("commands", { cmd: "arm", args: ["off"] });
  await chip.poll();
  override = [queued];
  await chip.poll();
  expect(chip.snapshot()).toMatchObject({ lastSeq: 2, demoArm: false });
});

it("a restarted simulated chip restores its replay guard and retries the saved result", async () => {
  const { createSimulatedChip } = await import("@solvex-dergana/shared/chip/simulator");
  const { request, app, key } = await setup();
  await request("commands", { cmd: "arm", args: ["on"] });
  const chip = createSimulatedChip({ deviceId, key, now: () => 1793361600000, request: async (path, init) =>
    path.endsWith("events") ? new Response(null, { status: 503 }) : app.request(path, init) });
  await expect(chip.poll()).rejects.toThrow("503");
  const restored = createSimulatedChip({ deviceId, key, now: () => 1793361600000,
    initialState: chip.snapshot(), request: async (path, init) => app.request(path, init) });
  expect(restored.snapshot()).toMatchObject({ lastSeq: 1, demoArm: true });
  await restored.poll();
  expect((await auditLog(await request("commands")))[0]!.status).toBe("acked");
});

it("the simulated chip checkpoints its result before sending an acknowledgement", async () => {
  const { createSimulatedChip } = await import("@solvex-dergana/shared/chip/simulator");
  const { request, app, key } = await setup();
  await request("commands", { cmd: "selftest" });
  let savedSequence = 0;
  const chip = createSimulatedChip({ deviceId, key, now: () => 1793361600000,
    saveState: async (state) => { savedSequence = state.lastSeq; },
    request: async (path, init) => {
      if (path.endsWith("events")) expect(savedSequence).toBe(1);
      return app.request(path, init);
    } });
  await chip.poll();
});


it("delivers commands to the existing device client without replacing its heartbeat protocol", async () => {
  const { request, app } = await setup();
  await request("commands", { cmd: "selftest" });
  // The API fixture uses a fixed clock; the legacy client signs its own body timestamp.
  const response = await app.request(`/devices/${deviceId}/heartbeat`, {
    method: "POST", body: JSON.stringify({ deviceId, t: 1793361600000, batteryPct: 80 }),
    headers: { "X-SVX-Timestamp": "1793361600000", "X-SVX-Signature": createHmac("sha256", await deriveDeviceKey(masterSecret, deviceId))
      .update(JSON.stringify({ deviceId, t: 1793361600000, batteryPct: 80 })).digest("hex") },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, commands: [{ seq: 1, cmd: "selftest" }] });
});

it("serializes overlapping simulator polls so saved replay state never moves backwards", async () => {
  const { createSimulatedChip } = await import("@solvex-dergana/shared/chip/simulator");
  const { request, app, key } = await setup();
  await request("commands", { cmd: "arm", args: ["on"] });
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  let startedSave!: () => void;
  const saveStarted = new Promise<void>((resolve) => { startedSave = resolve; });
  let saveCalls = 0;
  const persisted: number[] = [];
  const chip = createSimulatedChip({ deviceId, key, now: () => 1793361600000,
    saveState: async (state) => {
      if (++saveCalls === 1) { startedSave(); await saveGate; }
      persisted.push(state.lastSeq);
    }, request: async (path, init) => app.request(path, init) });
  const first = chip.poll();
  await saveStarted;
  await request("commands", { cmd: "arm", args: ["off"] });
  const second = chip.poll();
  // Let the second request reach the transport before releasing slow persistence.
  await new Promise((resolve) => setTimeout(resolve, 100));
  releaseSave();
  await Promise.all([first, second]);
  expect(persisted).toEqual([1, 2]);
  expect(chip.snapshot()).toMatchObject({ lastSeq: 2, demoArm: false });
});

it("retains a late device result without changing timeout status or allowing later overwrites", async () => {
  const { request, signed, advance } = await setup();
  await request("commands", { cmd: "selftest" });
  await signed("heartbeat", { deviceId, emulated: true });
  advance(60_001);
  const ack = { deviceId, t: 1793361660001, type: "command_ack", emulated: true,
    data: { seq: 1, result: { ok: true, late: true } } };
  expect((await signed("events", ack)).status).toBe(200);
  await signed("events", { ...ack, data: { seq: 1, result: { ok: false } } });
  expect((await auditLog(await request("commands")))[0]).toMatchObject({
    status: "timeout", result: { ok: true, late: true, emulated: true }, ackedAt: "2026-10-30T12:01:00.001Z",
  });
});

it("retries a saved acknowledgement after reconnecting beyond the command deadline", async () => {
  const { createSimulatedChip } = await import("@solvex-dergana/shared/chip/simulator");
  const { request, app, key, advance } = await setup();
  await request("commands", { cmd: "arm", args: ["on"] });
  const chip = createSimulatedChip({ deviceId, key, now: () => 1793361600000,
    request: async (path, init) => path.endsWith("events") ? new Response(null, { status: 503 }) : app.request(path, init) });
  await expect(chip.poll()).rejects.toThrow("503");
  advance(60_001);
  const restored = createSimulatedChip({ deviceId, key, initialState: chip.snapshot(), now: () => 1793361660001,
    request: async (path, init) => app.request(path, init) });
  await restored.poll();
  expect((await auditLog(await request("commands")))[0]).toMatchObject({
    status: "timeout", result: { ok: true, demoArm: true, emulated: true }, ackedAt: "2026-10-30T12:01:00.001Z",
  });
});
