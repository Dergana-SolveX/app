import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Render native UI through React Native Web; device/emulator layout is checked separately.
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"], alias: [
    ...["@tanstack/react-query", "@trpc/tanstack-react-query"].map(name => ({ find: name, replacement: fileURLToPath(new URL("./node_modules/" + name, import.meta.url)) })),
    ...["expo-haptics", "expo-location", "expo-sensors", "@expo/vector-icons"].map(name => ({ find: name, replacement: fileURLToPath(new URL("../native/node_modules/" + name, import.meta.url)) })),
    { find: "react", replacement: fileURLToPath(new URL("./node_modules/react", import.meta.url)) },
    { find: /^react-native$/, replacement: fileURLToPath(new URL("../native/node_modules/react-native-web/dist/index.js", import.meta.url)) },
    { find: "@", replacement: fileURLToPath(new URL("../native", import.meta.url)) },
  ] },
  test: { environment: "jsdom", restoreMocks: true, include: ["src/native-tests/*.test.tsx"], setupFiles: ["./src/test-setup.ts"] },
});
