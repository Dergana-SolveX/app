import { createEventBus } from "@solvex-dergana/api/services/events";
import { listIncidents } from "@solvex-dergana/api/services/incidents";
import { createTestDb } from "@solvex-dergana/db/testing";
import { describe, expect, it } from "vitest";

import { createUssdApp } from "./ussd-routes";

const SECRET = "test-gateway-secret-0123456789ab";

async function setup() {
  const db = await createTestDb();
  const app = createUssdApp({ secret: SECRET, db, events: createEventBus() });
  /** What an aggregator sends: a form, with the shared secret. */
  const call = (fields: Record<string, string>, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) =>
    app.request("/webhooks/ussd", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(fields).toString(),
    });
  const dial = (text: string, session = "AT-1") =>
    call({ sessionId: session, serviceCode: "*140#", phoneNumber: "+213550000042", text });
  return { db, app, call, dial };
}

describe("POST /webhooks/ussd (the aggregator callback)", () => {
  it("answers in plain text that starts with CON while the dialogue goes on", async () => {
    const { dial } = await setup();

    const response = await dial("");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await response.text()).toMatch(/^CON .*victimes/is);
  });

  it("ends with END once the alert is sent, and the alert is a real (not emulated) USSD one", async () => {
    const { dial, db } = await setup();
    for (const text of ["", "2", "2*1", "2*1*4", "2*1*4*0"]) await dial(text);

    const last = await dial("2*1*4*0*1");

    expect(await last.text()).toMatch(/^END /);
    const [incident] = await listIncidents(db);
    expect(incident).toMatchObject({ emulated: false });
  });

  it("also takes a JSON body", async () => {
    const { app } = await setup();
    const response = await app.request("/webhooks/ussd", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ sessionId: "J1", serviceCode: "*140#", phoneNumber: "+213550000042", text: "" }),
    });
    expect(await response.text()).toMatch(/^CON /);
  });

  it("is for the operator only: without the secret, or with the wrong one, it answers 401", async () => {
    const { call } = await setup();
    const fields = { sessionId: "X", serviceCode: "*140#", phoneNumber: "+213550000042", text: "" };
    expect((await call(fields, {})).status).toBe(401);
    expect((await call(fields, { authorization: "Bearer nope" })).status).toBe(401);
  });

  it("refuses a request that lacks a session or a phone number", async () => {
    const { call } = await setup();
    expect((await call({ serviceCode: "*140#", text: "" })).status).toBe(400);
  });
});
