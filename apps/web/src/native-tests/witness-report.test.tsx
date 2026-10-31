import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

vi.mock("expo-haptics", () => ({}));
vi.mock("expo-location", () => ({ requestForegroundPermissionsAsync: async () => ({ status: "denied" }) }));
vi.mock("expo-sensors", () => ({ Accelerometer: { setUpdateInterval: () => {}, addListener: () => ({ remove() {} }) } }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
vi.mock("expo-router", () => ({ router: { back: vi.fn(), push: vi.fn(), canGoBack: vi.fn(() => false) } }));
vi.mock("../../../native/src/env", () => ({ ENV: { EXPO_PUBLIC_SERVER_URL: "http://localhost:3000" } }));
vi.mock("@/lib/auth-client", () => ({ authClient: { getCookie: () => "" } }));

import { WitnessReport } from "../../../native/components/witness-report";

it("lets an Arabic-speaking witness complete all three choices and enter a manual location", async () => {
  render(<QueryClientProvider client={new QueryClient()}><WitnessReport /></QueryClientProvider>);
  expect(screen.getByTestId("witness-report-container").style.direction).toBe("ltr");
  await userEvent.click(screen.getByText("عربي"));
  expect(screen.getByTestId("witness-report-container").style.direction).toBe("rtl");
  await userEvent.click(screen.getByText("فرض قناة SMS (عرض تجريبي)"));
  expect(screen.getByText("رسالة SVX الخام")).toBeTruthy();
  await userEvent.click(screen.getByText("ضحية واحدة (1)"));
  await userEvent.click(screen.getByText("نعم (واعي)"));
  await userEvent.click(screen.getByText("إرسال عبر SMS (محاكاة)"));
  expect(screen.getByLabelText("البلدية / المدينة")).toBeTruthy();
});

it("shows a localized failed submission and keeps Arabic when starting again", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network unavailable")));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><WitnessReport /></QueryClientProvider>);
  await userEvent.click(screen.getByText("عربي"));
  await userEvent.click(screen.getByText("ضحية واحدة (1)"));
  await userEvent.click(screen.getByText("نعم (واعي)"));
  await userEvent.click(screen.getByText("إرسال التنبيه الآن"));
  await userEvent.type(screen.getByLabelText("البلدية / المدينة"), "الجزائر");
  await userEvent.click(screen.getByText("تأكيد المكان وإرسال التنبيه"));
  expect(await screen.findByText("فشل الإرسال")).toBeTruthy();
  await userEvent.click(screen.getByText("بلاغ جديد"));
  expect(screen.getByText("كم عدد الضحايا؟")).toBeTruthy();
  vi.unstubAllGlobals();
});
