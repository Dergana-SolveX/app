import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "@solvex-dergana/api/routers/index";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createContext } from "./context";
import { createDevicesApp, expireDeviceCommands } from "./devices";
import { createInternalSmsApp } from "./internal-sms";
import { ENV } from "./env.server";
import { auth, db, events, smsTransport } from "./services";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: (origin) => {
      if (!origin) return ENV.CORS_ORIGIN;
      if (
        origin === ENV.CORS_ORIGIN ||
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ) {
        return origin;
      }
      return ENV.CORS_ORIGIN;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-SVX-Signature",
      "X-SVX-Timestamp",
    ],
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
  createDevicesApp({
    masterSecret: ENV.MASTER_DEVICE_SECRET,
    authenticate: async (request) => {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) return null;
      const appUser = await db.query.appUsers.findFirst({ where: { authUserId: session.user.id } });
      return { id: session.user.id, role: appUser?.role ?? "" };
    },
    db,
    events,
  }),
);

// Offline devices expire even when no heartbeat or audit request arrives.
let sweepingCommands = false;
setInterval(async () => {
  if (sweepingCommands) return;
  sweepingCommands = true;
  try {
    await expireDeviceCommands(db);
  } catch (error) {
    console.error("Device command timeout sweep failed", error);
  } finally {
    sweepingCommands = false;
  }
}, 5_000).unref();

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
