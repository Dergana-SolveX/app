import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "android", select: (obj: any) => obj.android },
}));

vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => null,
  EventEmitter: class {
    addListener = vi.fn();
  },
}));

vi.mock("expo-sms", () => ({
  isAvailableAsync: vi.fn().mockResolvedValue(true),
  sendSMSAsync: vi.fn().mockResolvedValue({ result: "sent" }),
}));

import {
  addSvxAckListener,
  getCellIdAsync,
  isAvailableAsync,
  requestPermissionsAsync,
  sendSmsAsync,
  setMockSvxSmsDriver,
  type SvxCellId,
} from "./index";

describe("svx-sms Expo Module (FR-S4-05)", () => {
  beforeEach(() => {
    // Reset to clean mock state before each test
    setMockSvxSmsDriver(null);
  });

  it("checks availability of SMS capability", async () => {
    setMockSvxSmsDriver({
      isAvailable: async () => true,
      requestPermissions: async () => ({
        granted: true,
        permissions: { SEND_SMS: true, RECEIVE_SMS: true, READ_PHONE_STATE: true, ACCESS_FINE_LOCATION: true },
      }),
      sendSms: async () => ({ sent: true, delivered: true }),
      getCellId: async () => ({ mcc: 603, mnc: 1, lac: 101, cid: 202 }),
    });

    const available = await isAvailableAsync();
    expect(available).toBe(true);
  });

  it("requests required Android SMS and location permissions", async () => {
    setMockSvxSmsDriver({
      isAvailable: async () => true,
      requestPermissions: async () => ({
        granted: true,
        permissions: {
          SEND_SMS: true,
          RECEIVE_SMS: true,
          READ_PHONE_STATE: true,
          ACCESS_FINE_LOCATION: true,
        },
      }),
      sendSms: async () => ({ sent: true, delivered: true }),
      getCellId: async () => null,
    });

    const res = await requestPermissionsAsync();
    expect(res.granted).toBe(true);
    expect(res.permissions.SEND_SMS).toBe(true);
    expect(res.permissions.ACCESS_FINE_LOCATION).toBe(true);
  });

  it("sends SMS directly via native Android SmsManager without opening composer", async () => {
    let sentPayload: { to: string; message: string } | null = null;

    setMockSvxSmsDriver({
      isAvailable: async () => true,
      requestPermissions: async () => ({ granted: true, permissions: {} }),
      sendSms: async (to, message) => {
        sentPayload = { to, message };
        return { sent: true, delivered: true };
      },
      getCellId: async () => null,
    });

    const result = await sendSmsAsync("+213550000000", "SVX1#L:2#GH:sn2j5x7k#T:j9w4#V:1#C:1#CK:7F");
    expect(result).toEqual({ sent: true, delivered: true });
    expect(sentPayload).toEqual({
      to: "+213550000000",
      message: "SVX1#L:2#GH:sn2j5x7k#T:j9w4#V:1#C:1#CK:7F",
    });
  });

  it("retrieves serving Cell-ID via TelephonyManager (mcc, mnc, lac, cid)", async () => {
    const expectedCell: SvxCellId = { mcc: 603, mnc: 2, lac: 1024, cid: 50401 };

    setMockSvxSmsDriver({
      isAvailable: async () => true,
      requestPermissions: async () => ({ granted: true, permissions: {} }),
      sendSms: async () => ({ sent: true }),
      getCellId: async () => expectedCell,
    });

    const cell = await getCellIdAsync();
    expect(cell).toEqual(expectedCell);
  });

  it("subscribes to incoming SVXACK SMS broadcasts and delivers parsed ack ref", async () => {
    let triggerAck: ((event: { sender: string; body: string; ackRef: string }) => void) | null = null;

    setMockSvxSmsDriver({
      isAvailable: async () => true,
      requestPermissions: async () => ({ granted: true, permissions: {} }),
      sendSms: async () => ({ sent: true }),
      getCellId: async () => null,
      onAck: (cb) => {
        triggerAck = cb;
        return { remove: () => {} };
      },
    });

    const listener = vi.fn();
    const subscription = addSvxAckListener(listener);

    expect(triggerAck).not.toBeNull();
    triggerAck!({
      sender: "+213550000000",
      body: "SVXACK#3F9A12BC",
      ackRef: "3F9A12BC",
    });

    expect(listener).toHaveBeenCalledWith({
      sender: "+213550000000",
      body: "SVXACK#3F9A12BC",
      ackRef: "3F9A12BC",
    });

    subscription.remove();
  });

  describe("iOS Fallback behavior (FR-S4-05)", () => {
    it("falls back to ExpoSMS composer when Platform.OS is ios", async () => {
      const { Platform } = await import("react-native");
      (Platform as any).OS = "ios";

      const ExpoSMS = await import("expo-sms");
      (ExpoSMS.isAvailableAsync as any).mockResolvedValueOnce(true);
      (ExpoSMS.sendSMSAsync as any).mockResolvedValueOnce({ result: "sent" });

      const res = await sendSmsAsync("+213550000000", "SVX1#L:2#GH:sn2j5x7k#T:j9w4#CK:7F");
      expect(ExpoSMS.sendSMSAsync).toHaveBeenCalledWith(
        ["+213550000000"],
        "SVX1#L:2#GH:sn2j5x7k#T:j9w4#CK:7F"
      );
      expect(res).toEqual({ sent: true, delivered: false });

      // iOS cannot access cellular tower ID
      const cell = await getCellIdAsync();
      expect(cell).toBeNull();

      // Reset Platform.OS back to android
      (Platform as any).OS = "android";
    });

    it("handles iOS when SMS composer is cancelled or unavailable", async () => {
      const { Platform } = await import("react-native");
      (Platform as any).OS = "ios";

      const ExpoSMS = await import("expo-sms");
      (ExpoSMS.isAvailableAsync as any).mockResolvedValueOnce(false);

      const res = await sendSmsAsync("+213550000000", "hello");
      expect(res.sent).toBe(false);
      expect(res.error).toMatch(/not available/i);

      (Platform as any).OS = "android";
    });
  });
});
