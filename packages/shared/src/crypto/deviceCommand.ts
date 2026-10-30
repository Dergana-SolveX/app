import type { ChipCommand } from "../schemas/chip";

/** JSON tuple prevents ambiguity in arguments; device ID binds the command to its recipient. */
export function commandPayload(deviceId: string, command: Pick<ChipCommand, "seq" | "cmd" | "args">): string {
  return JSON.stringify([deviceId, command.seq, command.cmd, command.args]);
}
