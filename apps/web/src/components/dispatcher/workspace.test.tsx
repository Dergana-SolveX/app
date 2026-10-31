import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { incident } from "./fixtures";
import type { Profiles } from "./types";

// Configuration and HTTP/SSE are the external boundaries; the real tRPC client and hooks run.
vi.mock("@/env", () => ({ ENV: { VITE_SERVER_URL: "http://dispatcher.test" } }));
import { queryClient } from "@/utils/trpc";
import DispatcherWorkspace from "./workspace";

class TestEventSource extends EventTarget {
  static current: TestEventSource;
  readyState = 1;
  CLOSED = 2;
  constructor() {
    super();
    TestEventSource.current = this;
    setTimeout(() => this.dispatchEvent(new MessageEvent("connected", { data: "{}" })), 0);
  }
  close() { this.readyState = this.CLOSED; }
  update() { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "incident.updated", incident }), lastEventId: "fixture:1" })); }
}
afterEach(() => { queryClient.clear(); vi.unstubAllGlobals(); });

it("refreshes the selected profile when a live alert links new medical information", async () => {
  let profiles: Profiles = [];
  vi.stubGlobal("EventSource", TestEventSource);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const names = new URL(url).pathname.split("/").pop()!.split(",");
    return new Response(JSON.stringify(names.map((name) => ({ result: { data:
      name === "incidents.list" ? [{ ...incident, emulated: true, tentative: false }] :
      name === "incidents.byId" ? incident :
      name === "incidents.profiles" ? profiles :
      name === "incidents.mapLayers" ? { units: [], hospitals: [], zones: [] } : null,
    } }))), { headers: { "content-type": "application/json" } });
  }));
  render(<QueryClientProvider client={queryClient}><DispatcherWorkspace /></QueryClientProvider>);
  const queue = screen.getByRole("complementary", { name: "File des incidents" });
  await userEvent.click(await within(queue).findByRole("button", { name: /Alger/ }));
  await userEvent.click(await screen.findByRole("tab", { name: "Profil" }));
  await screen.findByText("Aucun profil médical lié.");
  profiles = [{ id: "profile-1", shortCode: "TEST0001", bloodType: "O+", allergies: [], chronicConditions: [], anticoagulant: true, unreliableShockIndex: false, insulin: false }];
  await waitFor(() => expect(TestEventSource.current).toBeDefined());
  act(() => TestEventSource.current.update());
  expect(await screen.findByText("ANTICOAGULANT — risque hémorragique")).toBeTruthy();
});
