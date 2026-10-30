// SMS gateway: GSM USB modem <-> AT commands <-> POST /internal/sms (PLAN.md S3.4-A).
import { ENV } from "./env.server";
import { createGateway } from "./gateway";
import { createModemService } from "./modem/service";
import { openSerialLink } from "./modem/serial";

if (!ENV.MODEM_PORT) {
  // `bun run dev` starts every app: without a modem there is nothing for the gateway to do.
  console.info("[gateway] MODEM_PORT is empty: no modem configured, the gateway stays idle.");
  process.exit(0);
}

if (!ENV.GATEWAY_SHARED_SECRET) {
  console.error("[gateway] GATEWAY_SHARED_SECRET is required when MODEM_PORT is set (same value as the server's).");
  process.exit(1);
}

const modem = createModemService({ open: () => openSerialLink(ENV.MODEM_PORT!, ENV.MODEM_BAUD) });
const { app } = createGateway({
  modem,
  serverUrl: ENV.SERVER_URL,
  secret: ENV.GATEWAY_SHARED_SECRET,
});

modem.start();

export default { port: ENV.GATEWAY_PORT, fetch: app.fetch };
