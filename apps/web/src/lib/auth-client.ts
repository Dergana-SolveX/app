import { createAuthClient } from "better-auth/react";

import { ENV } from "../env";

function getServerUrl(url: string) {
  const processEnv = typeof process === "undefined" ? undefined : process.env;
  if (typeof window === "undefined" && processEnv?.SERVER_URL) {
    return processEnv.SERVER_URL.endsWith("/")
      ? processEnv.SERVER_URL.slice(0, -1)
      : processEnv.SERVER_URL;
  }

  return url.endsWith("/") ? url.slice(0, -1) : url;
}

let configuredServerUrl = "http://localhost:3000";
try {
  configuredServerUrl = ENV?.VITE_SERVER_URL || "http://localhost:3000";
} catch {
  configuredServerUrl = "http://localhost:3000";
}

export const authClient = createAuthClient({
  baseURL: new URL("/api/auth", getServerUrl(configuredServerUrl)).toString(),
});
