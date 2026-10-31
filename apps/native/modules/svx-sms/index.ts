import { Platform } from "react-native";
import { EventEmitter, requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";
import * as ExpoSMS from "expo-sms";

export type SvxCellId = {
  mcc: number;
  mnc: number;
  lac: number;
  cid: number;
  formatted?: string;
};

export type SendSmsResult = {
  sent: boolean;
  delivered?: boolean;
  error?: string;
};

export type SmsPermissionsResult = {
  granted: boolean;
  permissions: Record<string, boolean>;
};

export type SvxAckEvent = {
  sender: string;
  body: string;
  ackRef: string;
};

export type SvxSubscription = {
  remove: () => void;
};

export type MockSvxSmsDriver = {
  isAvailable?: () => Promise<boolean>;
  requestPermissions?: () => Promise<SmsPermissionsResult>;
  sendSms?: (to: string, message: string) => Promise<SendSmsResult>;
  getCellId?: () => Promise<SvxCellId | null>;
  onAck?: (callback: (event: SvxAckEvent) => void) => SvxSubscription;
};

let currentMockDriver: MockSvxSmsDriver | null = null;

/**
 * Injects a mock driver for unit testing and CI simulation.
 */
export function setMockSvxSmsDriver(driver: MockSvxSmsDriver | null) {
  currentMockDriver = driver;
}

const NativeSvxSms = requireOptionalNativeModule("SvxSms");
const eventEmitter = NativeSvxSms
  ? new EventEmitter<{ onSvxAckReceived: (event: SvxAckEvent) => void }>(NativeSvxSms)
  : null;

/**
 * Returns whether SMS capabilities are available on this device.
 */
export async function isAvailableAsync(): Promise<boolean> {
  if (currentMockDriver?.isAvailable) {
    return currentMockDriver.isAvailable();
  }

  if (Platform.OS === "android") {
    if (NativeSvxSms?.isAvailableAsync) {
      return await NativeSvxSms.isAvailableAsync();
    }
    return false;
  }

  if (Platform.OS === "ios") {
    return await ExpoSMS.isAvailableAsync();
  }

  return false;
}

/**
 * Requests required runtime permissions for Android background SMS & Cell-ID.
 * On iOS, returns granted as composer requires no special runtime permission.
 */
export async function requestPermissionsAsync(): Promise<SmsPermissionsResult> {
  if (currentMockDriver?.requestPermissions) {
    return currentMockDriver.requestPermissions();
  }

  if (Platform.OS === "android" && NativeSvxSms?.requestPermissionsAsync) {
    return await NativeSvxSms.requestPermissionsAsync();
  }

  return {
    granted: true,
    permissions: {},
  };
}

/**
 * Dispatches an SMS alert.
 * - Android: Direct background transmission via SmsManager (no composer).
 * - iOS: 1-tap composer fallback via expo-sms.
 */
export async function sendSmsAsync(to: string, message: string): Promise<SendSmsResult> {
  if (currentMockDriver?.sendSms) {
    return currentMockDriver.sendSms(to, message);
  }

  if (Platform.OS === "android") {
    if (NativeSvxSms?.sendSms) {
      return await NativeSvxSms.sendSms(to, message);
    }
    throw new Error("SvxSms native Android module is not linked or running outside dev client");
  }

  if (Platform.OS === "ios") {
    const isAvailable = await ExpoSMS.isAvailableAsync();
    if (!isAvailable) {
      return { sent: false, delivered: false, error: "SMS service not available on this iOS device" };
    }
    const result = await ExpoSMS.sendSMSAsync([to], message);
    return {
      sent: result.result === "sent",
      delivered: false,
    };
  }

  return {
    sent: false,
    delivered: false,
    error: `Unsupported platform: ${Platform.OS}`,
  };
}

/**
 * Retrieves the serving cell tower identity (mcc, mnc, lac, cid) on Android.
 * Returns null if unavailable or on iOS/Web.
 */
export async function getCellIdAsync(): Promise<SvxCellId | null> {
  if (currentMockDriver?.getCellId) {
    return currentMockDriver.getCellId();
  }

  if (Platform.OS === "android" && NativeSvxSms?.getCellId) {
    return await NativeSvxSms.getCellId();
  }

  return null;
}

/**
 * Subscribes to incoming SVXACK broadcasts (e.g. SVXACK#<ref>).
 */
export function addSvxAckListener(listener: (event: SvxAckEvent) => void): SvxSubscription {
  if (currentMockDriver?.onAck) {
    return currentMockDriver.onAck(listener);
  }

  if (eventEmitter) {
    return eventEmitter.addListener("onSvxAckReceived", listener);
  }

  return {
    remove: () => {},
  };
}
