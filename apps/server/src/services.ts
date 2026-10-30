import { createEventBus } from "@solvex-dergana/api/services/events";
import { createTransport } from "@solvex-dergana/api/sms/transport";
import { createAuth } from "@solvex-dergana/auth";
import { createDb } from "@solvex-dergana/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
export const events = createEventBus();
export const smsTransport = createTransport(ENV.SMS_TRANSPORT, { db });
