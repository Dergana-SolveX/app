import { z } from "zod";
import { chipCommand, chipTraceName, type ChipCommand } from "../schemas/chip";
import { commandPayload } from "../crypto/deviceCommand";
import { signDevicePayload, verifyDevicePayload } from "../crypto/deviceKey";

export const simulatedChipState = z.object({
  demoArm: z.boolean(), lastSeq: z.number().int().nonnegative(),
  channel: z.enum(["auto", "http", "sms"]), lastTrace: chipTraceName.nullable(),
  lastResult: z.object({ hmac: z.string(), result: z.record(z.string(), z.unknown()) }).optional(),
});
export type SimulatedChipState = z.infer<typeof simulatedChipState>;

export type SimulatedChipOptions = {
  deviceId: string;
  key: Uint8Array<ArrayBuffer>;
  request: (path: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  initialState?: SimulatedChipState;
  saveState?: (state: SimulatedChipState) => Promise<void>;
};

/** Command consumer for the simulated chip. All traffic uses the real device protocol. */
export function createSimulatedChip(options: SimulatedChipOptions) {
  const now = options.now ?? Date.now;
  const state: SimulatedChipState = options.initialState ? structuredClone(simulatedChipState.parse(options.initialState)) :
    { demoArm: false, lastSeq: 0, channel: "auto", lastTrace: null };
  function execute(command: ChipCommand): Record<string, unknown> {
    const [arg] = command.args;
    switch (command.cmd) {
      case "arm":
        if (command.args.length !== 1 || !["on", "off"].includes(arg ?? "")) return { ok: false, error: "Expected on or off" };
        state.demoArm = arg === "on";
        return { ok: true, demoArm: state.demoArm };
      case "force_channel":
        if (command.args.length !== 1 || !["auto", "http", "sms"].includes(arg ?? "")) return { ok: false, error: "Invalid channel" };
        state.channel = z.enum(["auto", "http", "sms"]).parse(arg);
        return { ok: true, channel: state.channel };
      case "inject_trace":
        if (!state.demoArm) return { ok: false, error: "Demo arm is off" };
        if (command.args.length !== 1 || !chipTraceName.safeParse(arg).success) return { ok: false, error: "Invalid trace" };
        state.lastTrace = chipTraceName.parse(arg);
        return { ok: true, trace: state.lastTrace };
      case "selftest":
        return command.args.length ? { ok: false, error: "Expected no arguments" } : { ok: true, demoArm: state.demoArm, channel: state.channel };
    }
  }
  async function post(path: string, value: Record<string, unknown>) {
    const body = JSON.stringify({ t: now(), ...value });
    const timestamp = String(now());
    const response = await options.request(`/devices/${encodeURIComponent(options.deviceId)}/${path}`, {
      method: "POST", body, headers: { "content-type": "application/json", "X-SVX-Timestamp": timestamp,
        "X-SVX-Signature": await signDevicePayload(options.key, body) },
    });
    if (!response.ok) throw new Error(`Device ${path} failed: ${response.status}`);
    return response;
  }
  async function poll() {
    const response = await post("heartbeat", { deviceId: options.deviceId, emulated: true, demoArm: state.demoArm, channel: state.channel });
    const payload = await response.json() as { commands: unknown[] };
    for (const value of payload.commands) {
      const command = chipCommand.parse(value);
      if (!await verifyDevicePayload(options.key, commandPayload(options.deviceId, command), command.hmac)) continue;
      if (command.seq < state.lastSeq) continue;
      if (command.seq === state.lastSeq && state.lastResult?.hmac !== command.hmac) continue;
      if (command.seq > state.lastSeq) {
        state.lastSeq = command.seq;
        state.lastResult = { hmac: command.hmac, result: execute(command) };
      }
      await options.saveState?.(structuredClone(state));
      const result = state.lastResult!.result;
      await post("events", { deviceId: options.deviceId, t: now(), type: "command_ack", emulated: true,
        data: { seq: command.seq, result } });
    }
  }
  let pendingPoll: Promise<void> = Promise.resolve();
  return {
    poll: () => {
      const result = pendingPoll.then(poll);
      // A transport failure must not prevent the next poll from retrying its acknowledgement.
      pendingPoll = result.catch(() => {});
      return result;
    },
    snapshot: () => structuredClone(state),
  };
}
