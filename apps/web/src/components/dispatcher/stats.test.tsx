import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ ENV: { VITE_SERVER_URL: "http://dispatcher.test" } }));
import { DispatcherStats } from "./stats";

const MOCK_STATS = {
  summary: {
    totalIncidents: 40,
    emulatedIncidents: 40,
    totalDispatches: 40,
  },
  decisionTimes: {
    medianSeconds: 52,
    p90Seconds: 118,
    trend: [
      { date: "2026-10-01", medianSeconds: 50 },
      { date: "2026-10-15", medianSeconds: 48 },
      { date: "2026-10-30", medianSeconds: 54 },
    ],
  },
  alertsMerged: {
    single: 26,
    two: 10,
    threeOrMore: 4,
    averagePerIncident: 1.45,
  },
  channelMix: {
    internet: 28,
    sms: 22,
    ussd: 12,
  },
  severitySplit: {
    red: 16,
    yellow: 18,
    green: 6,
    unknown: 0,
  },
  overrideRate: {
    total: 40,
    overridden: 8,
    percentage: 20.0,
    topReasons: [
      { reason: "Unité la plus proche indisponible (en intervention)", count: 4 },
      { reason: "Renfort VSR nécessaire pour désincarcération suspectée", count: 2 },
    ],
  },
  byCommune: [
    { commune: "Bab Ezzouar", count: 8 },
    { commune: "Kouba", count: 6 },
    { commune: "Sidi M'Hamed", count: 5 },
  ],
  byAuthority: [
    { authority: "Protection Civile", count: 40 },
  ],
};

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DispatcherStats (FR-ST-01)", () => {
  it("renders KPI cards, date filters, demo data badge and charts", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            result: {
              data: MOCK_STATS,
            },
          },
        ]),
        { headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <DispatcherStats />
      </QueryClientProvider>,
    );

    // Header and filter controls
    expect(await screen.findByText("Statistiques du centre de régulation")).toBeTruthy();
    expect(screen.getByRole("button", { name: "30 jours" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "7 jours" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tout" })).toBeTruthy();

    // Demo data notice is displayed when emulated data is included
    expect(screen.getAllByText(/données de démonstration/i).length).toBeGreaterThanOrEqual(1);

    // KPI values
    expect(await screen.findByText("52s")).toBeTruthy(); // Médiane crash -> dispatch
    expect(screen.getByText("118s")).toBeTruthy(); // P90 crash -> dispatch
    expect(screen.getByText("20%")).toBeTruthy(); // Taux de modification

    // Channel mix
    expect(screen.getByText("Internet")).toBeTruthy();
    expect(screen.getByText("SMS")).toBeTruthy();
    expect(screen.getByText("USSD")).toBeTruthy();

    // Severities
    expect(screen.getByText("Urgence absolue (Rouge)")).toBeTruthy();

    // Communes
    expect(screen.getByText("Bab Ezzouar")).toBeTruthy();
    expect(screen.getByText("Kouba")).toBeTruthy();
  });

  it("toggles includeEmulated filter and refetches without demo data", async () => {
    let requestedIncludeEmulated = true;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url);
        const search = decodeURIComponent(u.search);
        if (search.includes('"includeEmulated":false')) {
          requestedIncludeEmulated = false;
        }
        return new Response(
          JSON.stringify([
            {
              result: {
                data: requestedIncludeEmulated
                  ? MOCK_STATS
                  : {
                      ...MOCK_STATS,
                      summary: { totalIncidents: 0, emulatedIncidents: 0, totalDispatches: 0 },
                    },
              },
            },
          ]),
          { headers: { "content-type": "application/json" } },
        );
      }),
    );

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <DispatcherStats />
      </QueryClientProvider>,
    );

    const toggle = (await screen.findByRole("checkbox", { name: /données de démo/i })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    await userEvent.click(toggle);
    expect(toggle.checked).toBe(false);

    await waitFor(() => {
      expect(requestedIncludeEmulated).toBe(false);
    });
  });
});
