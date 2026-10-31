import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { incident } from "./fixtures";
import type { Profiles } from "./types";

// Configuration and HTTP/SSE are the external boundaries; the real tRPC client and hooks run.
vi.mock("@/env", () => ({
  ENV: { VITE_SERVER_URL: "http://dispatcher.test" },
}));
import { queryClient } from "@/utils/trpc";
import DispatcherWorkspace from "./workspace";

class TestEventSource extends EventTarget {
  static current: TestEventSource;
  readyState = 1;
  CLOSED = 2;
  constructor() {
    super();
    TestEventSource.current = this;
    setTimeout(
      () => this.dispatchEvent(new MessageEvent("connected", { data: "{}" })),
      0,
    );
  }
  close() {
    this.readyState = this.CLOSED;
  }
  update() {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "incident.updated", incident }),
        lastEventId: "fixture:1",
      }),
    );
  }
}
afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

const recommendation = {
  incidentId: incident.id,
  version: 1,
  status: "open",
  recommended: [],
  candidates: [],
  prefill: [],
  decision: null,
  notice: null,
};
const listRow = (overrides: Partial<typeof incident> = {}) => ({
  ...incident,
  emulated: true,
  tentative: false,
  hasEscalation: false,
  escalationTo: null,
  ...overrides,
});

function stubServer(data: () => { list: unknown[]; profiles?: Profiles }) {
  vi.stubGlobal("EventSource", TestEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const names = new URL(url).pathname.split("/").pop()!.split(",");
      const { list, profiles = [] } = data();
      return new Response(
        JSON.stringify(
          names.map((name) => ({
            result: {
              data:
                name === "incidents.list"
                  ? list
                  : name === "incidents.byId"
                    ? incident
                    : name === "incidents.profiles"
                      ? profiles
                      : name === "incidents.mapLayers"
                        ? { units: [], hospitals: [], zones: [] }
                        : name === "dispatch.recommendation"
                          ? recommendation
                          : null,
            },
          })),
        ),
        { headers: { "content-type": "application/json" } },
      );
    }),
  );
}

it("keeps the operational map visible without a show or hide control", async () => {
  stubServer(() => ({ list: [listRow()] }));
  render(
    <QueryClientProvider client={queryClient}>
      <DispatcherWorkspace />
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("region", { name: "Carte opérationnelle" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /(?:Afficher|Masquer) la carte/ }),
  ).toBeNull();
});

it("refreshes the selected profile when a live alert links new medical information", async () => {
  let profiles: Profiles = [];
  stubServer(() => ({ list: [listRow()], profiles }));
  render(
    <QueryClientProvider client={queryClient}>
      <DispatcherWorkspace />
    </QueryClientProvider>,
  );
  const queue = screen.getByRole("complementary", { name: "File des alertes" });
  await userEvent.click(
    await within(queue).findByRole("button", { name: /Alger/, pressed: false }),
  );
  await userEvent.click(await screen.findByRole("tab", { name: "Profil" }));
  await screen.findByText("Aucun profil médical lié.");
  profiles = [
    {
      id: "profile-1",
      shortCode: "TEST0001",
      bloodType: "O+",
      allergies: [],
      chronicConditions: [],
      anticoagulant: true,
      unreliableShockIndex: false,
      insulin: false,
    },
  ];
  await waitFor(() => expect(TestEventSource.current).toBeDefined());
  act(() => TestEventSource.current.update());
  expect(
    await screen.findByText("ANTICOAGULANT — risque hémorragique"),
  ).toBeTruthy();
});

it("flags a live arrival as new on top of the list until the dispatcher opens it", async () => {
  let list = [listRow()];
  stubServer(() => ({ list }));
  render(
    <QueryClientProvider client={queryClient}>
      <DispatcherWorkspace />
    </QueryClientProvider>,
  );
  const queue = screen.getByRole("complementary", { name: "File des alertes" });
  await within(queue).findByRole("button", { name: /Alger/, pressed: false });
  expect(within(queue).queryByText("Nouveau")).toBeNull();

  list = [
    ...list,
    listRow({
      id: "00000000-0000-4000-8000-0000000000aa",
      commune: "Rouiba",
      recSeverity: "red",
      lastAlertAt: "2026-10-30T10:05:00Z",
    }),
  ];
  await waitFor(() => expect(TestEventSource.current).toBeDefined());
  act(() => TestEventSource.current.update());
  expect(await within(queue).findByText("Nouveau")).toBeTruthy();
  const rows = within(queue).getAllByRole("listitem");
  expect(rows[0]?.textContent).toContain("Rouiba");

  await userEvent.click(
    within(queue).getByRole("button", { name: /Rouiba/, pressed: false }),
  );
  await waitFor(() => expect(within(queue).queryByText("Nouveau")).toBeNull());
});
