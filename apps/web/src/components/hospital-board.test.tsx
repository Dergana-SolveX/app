import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/env", () => ({ ENV: { VITE_SERVER_URL: "http://hospital.test" } }));
import HospitalBoard from "./hospital-board";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { trpc } from "@/utils/trpc";

afterEach(() => vi.unstubAllGlobals());
function renderBoard(incoming: inferOutput<typeof trpc.handovers.incoming> = []) {
  // The query cache is the public boundary for a server snapshot; no application modules are mocked.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(trpc.hospitals.byId.queryKey({ hospitalId: "hospital-1" }), {
    id: "hospital-1", lat: 36.7, lng: 3.1, shortName: "Rouiba", tier: "eph", wilaya: "Alger", phone: null, statusUpdatedBy: null, name: "Hôpital de Rouiba", commune: "Rouiba", capabilities: { neurosurgery: true, ct_scanner: false, burn_unit: false, icu: false, trauma_surgery: false, obstetrics: false, blood_bank: false, pediatric: false },
    status: { neurosurgery: "accept" }, statusUpdatedAt: null, staleDivert: false,
  });
  client.setQueryData(trpc.handovers.incoming.queryKey({ hospitalId: "hospital-1" }), incoming);
  return render(<QueryClientProvider client={client}><HospitalBoard hospitalId="hospital-1" /></QueryClientProvider>);
}

it("switches the hospital board to Arabic with RTL and back to French", async () => {
  renderBoard();
  expect(screen.getByRole("heading", { name: "Arrivées annoncées" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "العربية" }));
  const board = screen.getByRole("region", { name: "الوصول المرتقب" });
  expect(board.getAttribute("dir")).toBe("rtl");
  expect(board.getAttribute("lang")).toBe("ar");
  expect(screen.getByText("لا توجد حالات وصول مرتقبة")).toBeTruthy();
  expect(screen.getByRole("button", { name: /جراحة الأعصاب/ })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Français" }));
  expect(screen.getByRole("region", { name: "Arrivées annoncées" }).getAttribute("dir")).toBe("ltr");
});

it("keeps hospital actions and clinical labels Arabic while isolating identifiers and measurements", async () => {
  renderBoard([{
    id: "handover-1", incidentId: "incident-1", assessmentId: "assessment-1", hospitalId: "hospital-1", smsFallbackSentAt: null, status: "pending", etaMin: 8, createdAt: new Date().toISOString(), respondedAt: null, divertSpecialty: null,
    atmist: { version: 1, unit: "AMB-14", victimIndex: 1, age: 32, sex: "male", time: "12:30",
      mechanism: [], injuries: [], treatments: [], severe: true, needs: [], prep: [], bloodType: "O+", allergies: [],
      signs: { hr: 110, sbp: 90, dbp: 60, rr: 20, spo2: 95, gcs: 14, shockIndex: { value: 1.22, flag: "critical", caveats: [] } } },
  }]);
  await userEvent.click(screen.getByRole("button", { name: "العربية" }));
  expect(screen.getByText("إصابة خطيرة")).toBeTruthy();
  expect(screen.getByText("العمر / الجنس")).toBeTruthy();
  expect(screen.getByText("حرج")).toBeTruthy();
  expect(screen.getByText("AMB-14").getAttribute("dir")).toBe("ltr");
  expect(screen.getByRole("button", { name: "قبول" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "إعادة التوجيه" }));
  expect(screen.getByText("حدد التخصص المشبع أو غير المتاح (إلزامي):")).toBeTruthy();
  expect(screen.getByRole("button", { name: "تأكيد إعادة التوجيه" }).hasAttribute("disabled")).toBe(true);
});
