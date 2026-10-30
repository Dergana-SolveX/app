import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "@solvex-dergana/api/routers/index";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createContext } from "./context";
import { createDeviceApp } from "./device-routes";
import { createInternalSmsApp } from "./internal-sms";
import { ENV } from "./env.server";
import { auth, db, events, smsTransport } from "./services";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: ENV.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", async (c) => auth.handler(c.req.raw));

// SMS gateways (emulator, Android relay, USB modem) hand SMS to the server here, with the shared secret.
app.route(
  "/",
  createInternalSmsApp({
    secret: ENV.GATEWAY_SHARED_SECRET,
    db,
    transport: smsTransport,
    events,
    masterDeviceSecret: ENV.MASTER_DEVICE_SECRET,
  }),
);

// Device REST endpoints (heartbeat, events) for B2B IoT crash chips
app.route(
  "/",
  createDeviceApp({
    masterDeviceSecret: ENV.MASTER_DEVICE_SECRET,
    db,
    events,
  }),
);

app.use(
  "/trpc/*",
  trpcServer({
    endpoint: "/trpc",
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  }),
);

app.get("/", (c) => {
  return c.text("OK");
});

// The API listens on the port of BETTER_AUTH_URL (default 3000), so changing one value moves it.
export default {
  port: Number(new URL(ENV.BETTER_AUTH_URL).port) || 3000,
  fetch: app.fetch,
};
