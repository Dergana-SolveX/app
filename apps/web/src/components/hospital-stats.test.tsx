import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ ENV: { VITE_SERVER_URL: "http://hospital.test" } }));
import { HospitalStats } from "./hospital-stats";

const HOSPITAL_ID = "00000000-0000-4000-8000-0000000000aa";

const MOCK_STATS = {
  arrivalsByDay: [
    { date: "2026-10-29", count: 5, red: 3, yellow: 1, green: 1 },
    { date: "2026-10-30", count: 3, red: 1, yellow: 1, green: 1 },
  ],
  acceptVsDivert: { accepted: 18, diverted: 6, rate: 75 },
  divertReasons: [
    { reason: "Neurochirurgie", count: 4 },
    { reason: "Saturé", count: 2 },
  ],
  averageLeadTimeMinutes: 7.5,
  redWithCapabilitiesRate: 83.3,
};

const EMPTY_STATS = {
  arrivalsByDay: [],
  acceptVsDivert: { accepted: 0, diverted: 0, rate: 100 },
  divertReasons: [],
  averageLeadTimeMinutes: 0,
  redWithCapabilitiesRate: 100,
};

const answer = (data: unknown) =>
  new Response(JSON.stringify([{ result: { data } }]), { headers: { "content-type": "application/json" } });

const renderStats = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <HospitalStats hospitalId={HOSPITAL_ID} />
    </QueryClientProvider>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HospitalStats (FR-ST-02)", () => {
  it("shows the five indicators for this hospital, with the date filters and the demo-data notice", async () => {
    const fetchMock = vi.fn(async () => answer(MOCK_STATS));
    vi.stubGlobal("fetch", fetchMock);

    renderStats();

    expect(await screen.findByText("Statistiques de l'hôpital")).toBeTruthy();
    expect(screen.getByRole("button", { name: "7 jours" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "30 jours" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tout" })).toBeTruthy();
    expect(screen.getAllByText(/données de démonstration/i).length).toBeGreaterThanOrEqual(1);

    // Accept vs Divert, AT-MIST lead time, RED patients received with the right capabilities
    expect(await screen.findByText("75 %")).toBeTruthy();
    expect(screen.getByText("18 acceptées")).toBeTruthy();
    expect(screen.getByText("6 déroutées")).toBeTruthy();
    expect(screen.getByText("7,5 min")).toBeTruthy();
    expect(screen.getByText("83,3 %")).toBeTruthy();

    // Divert reasons by specialty
    expect(screen.getByText("Neurochirurgie")).toBeTruthy();
    expect(screen.getByText("Saturé")).toBeTruthy();

    // Arrivals per day by severity (numbers, not only colours)
    expect(screen.getByText("29/10")).toBeTruthy();
    expect(screen.getByText(/3 rouges/i)).toBeTruthy();

    // The query is for this hospital only
    const calls = fetchMock.mock.calls as unknown as [string][];
    expect(decodeURIComponent(calls[0]![0])).toContain(HOSPITAL_ID);
  });

  it("asks again without the demo data when the toggle is switched off", async () => {
    let includesDemo = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (decodeURIComponent(new URL(url).search).includes('"includeEmulated":false')) includesDemo = false;
        return answer(includesDemo ? MOCK_STATS : EMPTY_STATS);
      }),
    );
    renderStats();

    const toggle = (await screen.findByRole("checkbox", { name: /données de démo/i })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await userEvent.click(toggle);

    expect(toggle.checked).toBe(false);
    await waitFor(() => expect(includesDemo).toBe(false));
    expect(await screen.findByText(/aucune arrivée/i)).toBeTruthy();
  });

  it("says so, instead of showing empty charts, when the hospital has no arrivals in the period", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(EMPTY_STATS)));

    renderStats();

    expect(await screen.findByText(/aucune arrivée/i)).toBeTruthy();
  });

  it("offers a retry when the statistics cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));

    renderStats();

    expect(await screen.findByText(/impossible de charger/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });
});
