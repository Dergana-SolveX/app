import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock env
vi.mock("@/env", () => ({ ENV: { VITE_SERVER_URL: "http://witness.test" } }));

import WitnessPhoneFrame from "./witness-phone-frame";

describe("WitnessPhoneFrame (Seam 3)", () => {
  let queryClient: QueryClient;
  let fetchMock: any;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    fetchMock = vi.fn(async (url: string, opts?: any) => {
      if (url.includes("alerts.submitOnline")) {
        return new Response(
          JSON.stringify([
            {
              result: {
                data: {
                  alertId: "alert-uuid-1",
                  incidentId: "inc-uuid-999",
                  duplicate: false,
                  merged: false,
                },
              },
            },
          ]),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  it("completes the 3-tap witness report and submits via tRPC with GPS", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <WitnessPhoneFrame initialCoords={{ lat: 36.725, lng: 3.183, accuracyM: 10 }} />
      </QueryClientProvider>,
    );

    // Initial step 1: Victims
    expect(screen.getByText(/Combien de victimes/i)).toBeTruthy();
    const btn2Victims = screen.getByRole("button", { name: /2 victimes/i });
    await userEvent.click(btn2Victims);

    // Auto-advanced to step 2: Conscious
    expect(screen.getByText(/conscientes ou en mouvement/i)).toBeTruthy();
    const btnInconscious = screen.getByRole("button", { name: /Non \(Inconscient\)/i });
    await userEvent.click(btnInconscious);

    // Auto-advanced to step 3: Dangers
    expect(screen.getByText(/Dangers immédiats/i)).toBeTruthy();
    const btnFire = screen.getByRole("button", { name: /Feu \/ Fumée/i });
    const btnTrapped = screen.getByRole("button", { name: /Personne coincée/i });
    await userEvent.click(btnFire);
    await userEvent.click(btnTrapped);

    // Click submit
    const submitBtn = screen.getByRole("button", { name: /Envoyer l'alerte maintenant/i });
    await userEvent.click(submitBtn);

    // Should call submitOnline mutation
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      const call = fetchMock.mock.calls.find((c: any) => c[0].includes("alerts.submitOnline"));
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      const input = body[0];
      expect(input.victims).toBe(2);
      expect(input.conscious).toBe(0);
      expect(input.fire).toBe(true);
      expect(input.trapped).toBe(true);
      expect(input.lat).toBe(36.725);
      expect(input.lng).toBe(3.183);
    });

    // Should display success screen
    expect(await screen.findByText(/Alerte transmise/i)).toBeTruthy();
    expect(screen.getByText(/Dossier N°/i)).toBeTruthy();
  });

  it("supports bilingual toggle (FR -> AR) with Arabic text and RTL", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <WitnessPhoneFrame />
      </QueryClientProvider>,
    );

    // Initially in French
    expect(screen.getByText(/Combien de victimes/i)).toBeTruthy();

    // Click Arabic toggle
    const arToggle = screen.getByRole("button", { name: /عربي/i });
    await userEvent.click(arToggle);

    // Now in Arabic
    expect(screen.getByText(/كم عدد الضحايا/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /ضحيتان/i })).toBeTruthy();
  });

  it("prompts for manual location (PK / Commune) when GPS times out after 20s", async () => {
    vi.useFakeTimers();

    render(
      <QueryClientProvider client={queryClient}>
        <WitnessPhoneFrame autoGps={false} />
      </QueryClientProvider>,
    );

    // Fast-forward 20 seconds
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    vi.useRealTimers();

    // Fill steps 1 & 2
    await userEvent.click(screen.getByRole("button", { name: /1 victime/i }));
    await userEvent.click(screen.getByRole("button", { name: /Oui \(Conscient\)/i }));
    await userEvent.click(screen.getByRole("button", { name: /Aucun danger apparent/i }));

    // Click Submit
    const submitBtn = screen.getByRole("button", { name: /Envoyer l'alerte maintenant/i });
    await userEvent.click(submitBtn);

    // Since GPS timed out without coords, prompt for location
    expect(await screen.findByText(/Où êtes-vous/i)).toBeTruthy();
    const communeInput = screen.getByPlaceholderText(/ex\. Bab Ezzouar/i);
    const pkInput = screen.getByPlaceholderText(/ex\. RN5 PK 14\+200/i);

    await userEvent.type(communeInput, "Bab Ezzouar");
    await userEvent.type(pkInput, "PK 14");

    const confirmBtn = screen.getByRole("button", { name: /Valider le lieu et envoyer/i });
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c: any) => c[0].includes("alerts.submitOnline"));
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      expect(body[0].commune).toBe("Bab Ezzouar");
      expect(body[0].pkMarker).toBe("PK 14");
    });
  });
});
