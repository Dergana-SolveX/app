import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WitnessPhoneFrame from "./witness-phone-frame";
import { queryClient } from "@/utils/trpc";
import { WITNESS_TEXT } from "@solvex-dergana/shared";

function renderWithClient(ui: React.ReactElement) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("WitnessPhoneFrame (Seam 3)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    queryClient.clear();
    originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: any, opts: any) => {
      const urlStr = String(url);
      if (urlStr.includes("alerts.submitOnline") || urlStr.includes("batch")) {
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
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    queryClient.clear();
    globalThis.fetch = originalFetch;
  });

  it("renders the SOS hero button and options on the main page, transitioning to 3-tap on click", async () => {
    renderWithClient(
      <WitnessPhoneFrame
        initialCoords={{ lat: 36.725, lng: 3.183, accuracyM: 10 }}
        autoGps={false}
      />,
    );

    expect(screen.getByTestId("main-sos-button")).toBeDefined();
    expect(screen.getByText("Témoin d'accident (3-Tap)")).toBeDefined();
    expect(screen.getByText("SOS Immédiat (Urgence Vitale)")).toBeDefined();

    // Click hero SOS button
    fireEvent.click(screen.getByTestId("main-sos-button"));

    // Should now show Step 1
    await waitFor(() => {
      expect(screen.getByText(WITNESS_TEXT.fr.step1_title)).toBeDefined();
    });
  });

  it("completes the 3-tap witness report and submits via tRPC with GPS", async () => {
    renderWithClient(
      <WitnessPhoneFrame
        initialView="flow"
        initialCoords={{ lat: 36.725, lng: 3.183, accuracyM: 10 }}
        autoGps={false}
      />,
    );

    // Step 1: Victims
    expect(screen.getByText(WITNESS_TEXT.fr.step1_title)).toBeDefined();
    const btn1 = screen.getByText(WITNESS_TEXT.fr.victims_1);
    fireEvent.click(btn1);

    // Step 2: Consciousness
    await waitFor(() => {
      expect(screen.getByText(WITNESS_TEXT.fr.step2_title)).toBeDefined();
    });
    const btnOui = screen.getByText(WITNESS_TEXT.fr.conscious_yes);
    fireEvent.click(btnOui);

    // Step 3: Dangers
    await waitFor(() => {
      expect(screen.getByText(WITNESS_TEXT.fr.step3_title)).toBeDefined();
    });
    const feuBtn = screen.getByText(WITNESS_TEXT.fr.danger_fire);
    fireEvent.click(feuBtn);

    // Submit report
    const submitBtn = screen.getByRole("button", { name: new RegExp(WITNESS_TEXT.fr.submit_button, "i") });
    fireEvent.click(submitBtn);

    // Confirmation screen
    await waitFor(() => {
      expect(screen.getByText(WITNESS_TEXT.fr.success_title)).toBeDefined();
      expect(screen.getByText(new RegExp(WITNESS_TEXT.fr.success_desc, "i"))).toBeDefined();
    });
  });

  it("supports bilingual toggle (FR -> AR) with Arabic text and RTL", async () => {
    renderWithClient(
      <WitnessPhoneFrame
        initialView="flow"
        initialCoords={{ lat: 36.725, lng: 3.183, accuracyM: 10 }}
        autoGps={false}
      />,
    );

    // Default FR
    expect(screen.getByText(WITNESS_TEXT.fr.step1_title)).toBeDefined();

    // Toggle to AR
    const arBtn = screen.getByRole("button", { name: /عربي/i });
    fireEvent.click(arBtn);

    // Should now be Arabic
    await waitFor(() => {
      expect(screen.getByText(WITNESS_TEXT.ar.step1_title)).toBeDefined();
    });
  });

  it("prompts for manual location (PK / Commune) when GPS times out after 20s", async () => {
    renderWithClient(<WitnessPhoneFrame initialView="flow" autoGps={false} />);

    // Fast-forward GPS failure by clicking presentation control
    const timeoutBtn = screen.getByRole("button", { name: /Simuler timeout GPS/i });
    fireEvent.click(timeoutBtn);

    // Select step 1
    const btn1 = screen.getByText(WITNESS_TEXT.fr.victims_1);
    fireEvent.click(btn1);

    // Select step 2
    await waitFor(() => {
      expect(screen.getByText(WITNESS_TEXT.fr.step2_title)).toBeDefined();
    });
    fireEvent.click(screen.getByText(WITNESS_TEXT.fr.conscious_unknown));

    // Step 3 - click submit
    await waitFor(() => {
      expect(screen.getByText(WITNESS_TEXT.fr.step3_title)).toBeDefined();
    });
    const submitBtn = screen.getByRole("button", { name: new RegExp(WITNESS_TEXT.fr.submit_button, "i") });
    fireEvent.click(submitBtn);

    // Prompt for manual location appears
    await waitFor(() => {
      expect(screen.getByText(WITNESS_TEXT.fr.gps_timeout_prompt)).toBeDefined();
    });

    // Enter commune & pk
    const inputCommune = screen.getByPlaceholderText(WITNESS_TEXT.fr.commune_placeholder);
    fireEvent.change(inputCommune, { target: { value: "Reghaïa" } });
    const inputPk = screen.getByPlaceholderText(WITNESS_TEXT.fr.pk_placeholder);
    fireEvent.change(inputPk, { target: { value: "PK 14" } });

    const sendAnywayBtn = screen.getByRole("button", { name: new RegExp(WITNESS_TEXT.fr.confirm_location_button, "i") });
    fireEvent.click(sendAnywayBtn);

    // Should succeed
    await waitFor(() => {
      expect(screen.getByText(WITNESS_TEXT.fr.success_title)).toBeDefined();
    });
  });

  it("triggers countdown when 'Simuler un choc' is clicked and cancels without sending an alert", async () => {
    renderWithClient(<WitnessPhoneFrame initialView="flow" autoGps={false} />);

    // Click demo crash button in control bar
    const simCrashBtn = screen.getByTestId("simulate-impact-button");
    fireEvent.click(simCrashBtn);

    // Countdown overlay visible
    await waitFor(() => {
      expect(screen.getByTestId("crash-countdown-overlay")).toBeDefined();
      expect(screen.getByText(/CHOC DÉTECTÉ/i)).toBeDefined();
    });

    // Cancel before expiration
    const cancelBtn = screen.getByTestId("cancel-crash-button");
    fireEvent.click(cancelBtn);

    // Shows cancelled state
    await waitFor(() => {
      expect(screen.getByText("ALERTE ANNULÉE")).toBeDefined();
    });
  });
});
