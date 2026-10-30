import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { deriveDeviceKey } from "@solvex-dergana/shared";
import { createSimulatedChip, simulatedChipState } from "@solvex-dergana/shared/chip/simulator";
import { ENV } from "./env.server";

// Trusted local runner: the master secret never travels to the server or browser.
const deviceId = process.argv[2] ?? "SVX-CHIP-001";
const stateDirectory = ".device-simulator";
const stateFile = join(stateDirectory, `${encodeURIComponent(deviceId)}.json`);
await mkdir(stateDirectory, { recursive: true });
let initialState;
try {
  initialState = simulatedChipState.parse(JSON.parse(await readFile(stateFile, "utf8")));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
const chip = createSimulatedChip({
  deviceId,
  key: await deriveDeviceKey(ENV.MASTER_DEVICE_SECRET, deviceId),
  initialState,
  request: (path, init) => fetch(new URL(path, ENV.BETTER_AUTH_URL), init),
  saveState: async (state) => {
    await writeFile(`${stateFile}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${stateFile}.tmp`, stateFile);
  },
});
let stopped = false;
process.once("SIGINT", () => { stopped = true; });
process.once("SIGTERM", () => { stopped = true; });
while (!stopped) {
  try {
    await chip.poll();
    const { lastResult, ...state } = chip.snapshot();
    console.log(JSON.stringify({ deviceId, emulated: true, ...state }));
  } catch (error) {
    console.error("Simulated device poll failed", error);
  }
  if (!stopped) await delay(2_000);
}
