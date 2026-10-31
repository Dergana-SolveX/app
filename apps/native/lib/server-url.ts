import Constants from "expo-constants";
import { Platform } from "react-native";

import { ENV } from "../src/env";

/**
 * Resolves the backend server URL.
 * When running in Expo Go or on a physical native device, "localhost" points
 * to the mobile device itself (127.0.0.1) instead of the host machine running the API.
 * This helper dynamically detects the development host IP provided by Expo / Metro
 * so requests work seamlessly on both physical devices and emulators.
 */
export function getServerUrl(): string {
  const configured = ENV.EXPO_PUBLIC_SERVER_URL || "http://localhost:3000";

  // If the configured URL is already an explicit LAN IP or remote domain, use it directly.
  const hasLocalhost = /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(configured);
  if (!hasLocalhost) {
    return configured.replace(/\/+$/, "");
  }

  // On Web, localhost is the browser host machine. If accessed remotely, use the browser hostname.
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.location.hostname && window.location.hostname !== "localhost") {
      return configured.replace(/localhost|127\.0\.0\.1/, window.location.hostname).replace(/\/+$/, "");
    }
    return configured.replace(/\/+$/, "");
  }

  // On native devices, retrieve the Metro packager host IP from Expo Constants.
  // In Expo Go, hostUri is formatted like "192.168.96.30:8081".
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ??
    (Constants as any).expoGoConfig?.debuggerHost;

  if (hostUri) {
    const hostIp = hostUri.split(":")[0];
    if (hostIp) {
      return configured.replace(/localhost|127\.0\.0\.1/, hostIp).replace(/\/+$/, "");
    }
  }

  // Android emulator fallback: 10.0.2.2 maps to host 127.0.0.1
  if (Platform.OS === "android") {
    return configured.replace(/localhost|127\.0\.0\.1/, "10.0.2.2").replace(/\/+$/, "");
  }

  return configured.replace(/\/+$/, "");
}
