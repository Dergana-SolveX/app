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
      if (url.includes("alerts.submitSms")) {
        return new Response(
          JSON.stringify([
            {
              result: {
                data: {
                  kind: "alert",
                  incidentId: "inc-sms-777",
                  ack: "SVXACK#777",
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

  it("triggers 15 s countdown when hidden 'Simuler un choc' is clicked and cancels without sending an alert", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <WitnessPhoneFrame />
      </QueryClientProvider>,
    );

    // Find and click the hidden simulation button
    const simBtn = screen.getByTestId("simulate-impact-button");
    expect(simBtn).toBeTruthy();
    await userEvent.click(simBtn);

    // Should display full-screen countdown
    expect(screen.getByTestId("crash-countdown-overlay")).toBeTruthy();
    expect(screen.getByTestId("countdown-timer-value").textContent).toBe("15");
    expect(screen.getByText(/CHOC DÉTECTÉ/i)).toBeTruthy();

    // Click "JE VAIS BIEN — ANNULER"
    const cancelBtn = screen.getByTestId("cancel-crash-button");
    await userEvent.click(cancelBtn);

    // Overlay shows cancelled confirmation
    expect(screen.getByText(/ALERTE ANNULÉE/i)).toBeTruthy();

    // Verification: NO network requests were sent
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits automatic crash alert with source 'app_auto' when countdown expires", async () => {
    vi.useFakeTimers();

    render(
      <QueryClientProvider client={queryClient}>
        <WitnessPhoneFrame initialCoords={{ lat: 36.75, lng: 3.05, accuracyM: 5 }} />
      </QueryClientProvider>,
    );

    const simBtn = screen.getByTestId("simulate-impact-button");
    act(() => {
      simBtn.click();
    });

    expect(screen.getByTestId("crash-countdown-overlay")).toBeTruthy();

    // Advance 15 seconds
    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    vi.useRealTimers();

    // Verification: fetch called with source: "app_auto"
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c: any) => c[0].includes("alerts.submitOnline"));
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      expect(body[0].source).toBe("app_auto");
      expect(body[0].lat).toBe(36.75);
    });
  });

  it("shows raw SMS preview with exact string and character count when 'Forcer canal SMS' is on (FR-S4-06)", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <WitnessPhoneFrame initialCoords={{ lat: 36.725, lng: 3.183, accuracyM: 10 }} />
      </QueryClientProvider>,
    );

    // Toggle "Forcer canal SMS" switch
    const smsSwitch = screen.getByTestId("force-sms-toggle");
    expect(smsSwitch).toBeTruthy();
    await userEvent.click(smsSwitch);

    // Verify raw SMS preview box is visible with SVX string and character count
    const preview = screen.getByTestId("raw-sms-preview");
    expect(preview).toBeTruthy();
    expect(preview.textContent).toMatch(/SVX1#L:2/);
    expect(screen.getByTestId("sms-char-counter")).toBeTruthy();
    expect(screen.getByTestId("sms-char-counter").textContent).toMatch(/\/ 160/);
  });

  it("posts SVX string to alerts.submitSms flagged emulated: true when forced SMS is used (FR-S4-06)", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <WitnessPhoneFrame initialCoords={{ lat: 36.725, lng: 3.183, accuracyM: 10 }} />
      </QueryClientProvider>,
    );

    // Enable Forced SMS
    await userEvent.click(screen.getByTestId("force-sms-toggle"));

    // Complete 3-tap questions
    await userEvent.click(screen.getByRole("button", { name: /2 victimes/i }));
    await userEvent.click(screen.getByRole("button", { name: /Oui \(Conscient\)/i }));
    await userEvent.click(screen.getByRole("button", { name: /Feu \/ Fumée/i }));

    // Submit button should reflect SMS path
    const submitBtn = screen.getByRole("button", { name: /Envoyer par SMS \(Émulé\)/i });
    await userEvent.click(submitBtn);

    // Verify it called alerts.submitSms with emulated: true and valid SVX body
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c: any) => c[0].includes("alerts.submitSms"));
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      expect(body[0].emulated).toBe(true);
      expect(body[0].body).toMatch(/^SVX1#L:2.*#CK:[0-9A-F]{2}$/);
    });

    // Should display ack confirmation
    expect(await screen.findByText(/Accusé de réception/i)).toBeTruthy();
    expect(screen.getByText(/SVXACK#777/)).toBeTruthy();
  });
});


