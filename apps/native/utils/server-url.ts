import Constants from "expo-constants";
import { Platform } from "react-native";
import { ENV } from "../src/env";

/**
 * Resolves the server backend URL.
 * Automatically resolves the developer host machine LAN IP on physical phones running Expo Go.
 */
export function getServerUrl(): string {
  const configured = ENV.EXPO_PUBLIC_SERVER_URL;

  // If explicitly configured with a non-localhost IP/domain, use it directly
  if (configured && !configured.includes("localhost") && !configured.includes("127.0.0.1")) {
    return configured;
  }

  // On native platforms (Expo Go / standalone dev client), infer host machine IP from Metro bundler URI
  if (Platform.OS !== "web") {
    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) {
      const host = hostUri.split(":")[0];
      if (host && host !== "localhost" && host !== "127.0.0.1") {
        return `http://${host}:3000`;
      }
    }
  }

  return configured || "http://localhost:3000";
}
