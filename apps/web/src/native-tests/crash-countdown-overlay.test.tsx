import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createCrashCountdownState, countdownReducer } from "@solvex-dergana/shared";

vi.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
import { CrashCountdownOverlay } from "../../../native/components/crash-countdown-overlay";

it("announces the native crash cancellation in Arabic with RTL text", async () => {
  const state = countdownReducer(createCrashCountdownState(), { type: "TRIGGER_CRASH", payload: {
    peakG: 6.2, speedBeforeKmh: 65, simulated: true, timestamp: 0,
  } });
  let cancelled = false;
  render(<CrashCountdownOverlay state={state} locale="ar" onCancel={() => { cancelled = true; }} onReset={() => {}} />);
  expect(screen.getByTestId("crash-countdown-overlay").style.direction).toBe("rtl");
  expect(screen.getByText("ثوانٍ")).toBeTruthy();
  expect(screen.getByText(/إنذار يتضمن موقعكم/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "إلغاء الإنذار" }));
  expect(cancelled).toBe(true);
  expect(screen.getByText("اختبار محاكاة (عرض تجريبي)")).toBeTruthy();
});

it("explains a failed automatic alert in Arabic and offers a way back", async () => {
  const state = countdownReducer(createCrashCountdownState(), { type: "ALERT_ERROR", payload: { error: "Network unavailable" } });
  let reset = false;
  render(<CrashCountdownOverlay state={state} locale="ar" onCancel={() => {}} onReset={() => { reset = true; }} />);
  expect(screen.getByText("فشل الإرسال")).toBeTruthy();
  await userEvent.click(screen.getByText("العودة إلى الرئيسية"));
  expect(reset).toBe(true);
});
