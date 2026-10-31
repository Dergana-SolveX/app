import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock env
vi.mock("@/env", () => ({ ENV: { VITE_SERVER_URL: "http://witness.test" } }));

// Mock router Link
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  Link: ({ children, to, className }: any) => (
    <a href={to} className={className} data-testid="router-link">
      {children}
    </a>
  ),
}));

import { WitnessRoute } from "./witness";

describe("WitnessRoute SOS page", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ result: { data: {} } }]), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  it("renders the main SOS button initially with emergency details", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <WitnessRoute />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Besoin d'aide ?")).toBeTruthy();
    expect(
      screen.getByText(
        "Appuyez sur SOS pour signaler un accident et commencer le parcours d'urgence.",
      ),
    ).toBeTruthy();

    const sosButton = screen.getByTestId("start-sos-report");
    expect(sosButton).toBeTruthy();
    expect(sosButton.textContent).toContain("SOS");
    expect(screen.getAllByText(/14 \/ 154/).length).toBeGreaterThan(0);
  });

  it("clicking the SOS button redirects to the witness report flow (step 1)", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <WitnessRoute />
      </QueryClientProvider>,
    );

    const sosButton = screen.getByTestId("start-sos-report");
    await userEvent.click(sosButton);

    // Witness flow step 1 (Victims) should now be displayed
    await waitFor(() => {
      expect(screen.getByText(/Combien de victimes/i)).toBeTruthy();
      expect(screen.getByText(/1 victime/i)).toBeTruthy();
    });

    // Should also show back-to-sos button in header
    expect(screen.getByTestId("back-to-sos")).toBeTruthy();
  });

  it("supports switching to Arabic and carries language into witness report flow", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <WitnessRoute />
      </QueryClientProvider>,
    );

    // Click Arabic toggle
    const arToggle = screen.getByTestId("lang-toggle-ar");
    await userEvent.click(arToggle);

    expect(screen.getByText("هل تحتاجون إلى المساعدة؟")).toBeTruthy();
    expect(
      screen.getByText("اضغطوا على SOS للإبلاغ عن حادث وبدء مسار الطوارئ."),
    ).toBeTruthy();

    // Click SOS
    const sosButton = screen.getByTestId("start-sos-report");
    await userEvent.click(sosButton);

    // Witness flow should display in Arabic
    await waitFor(() => {
      expect(screen.getByText(/كم عدد الضحايا؟/i)).toBeTruthy();
    });
  });

  it("allows returning back to the SOS screen from the witness flow", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <WitnessRoute />
      </QueryClientProvider>,
    );

    // Click SOS
    await userEvent.click(screen.getByTestId("start-sos-report"));
    expect(await screen.findByText(/Combien de victimes/i)).toBeTruthy();

    // Click back to SOS button
    await userEvent.click(screen.getByTestId("back-to-sos"));

    // Back on SOS screen
    expect(screen.getByText("Besoin d'aide ?")).toBeTruthy();
    expect(screen.getByTestId("start-sos-report")).toBeTruthy();
  });
});
