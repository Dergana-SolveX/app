import type { Session } from "@solvex-dergana/auth";
import type { AppUser, Database } from "@solvex-dergana/db";

import type { SmsTransport } from "./sms/transport";
import type { EventBus } from "./services/events";

/** The demo role record (`app_users`) behind a Better Auth login. */
export type AppUserContext = Pick<AppUser, "id" | "role" | "unitId" | "hospitalId">;

/**
 * How the server reaches its own device endpoints on behalf of the simulated chip. The master secret never
 * leaves the server: the browser only asks for a packet to be sent.
 */
export type ChipGateway = {
  masterDeviceSecret: string;
  /** Where the device endpoints answer, e.g. the API's own address. */
  baseUrl: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response;
};

export type Context = {
  session: Session | null;
  appUser: AppUserContext | null;
  db: Database;
  events: EventBus;
  smsTransport: SmsTransport;
  /** Absent when the server is not set up to drive the simulated chip. */
  chip?: ChipGateway;
};
