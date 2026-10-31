import { LocaleProvider } from "@/contexts/locale-context";
import "@/global.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { AppThemeProvider } from "@/contexts/app-theme-context";
import { queryClient } from "@/utils/trpc";

export default function Layout() {
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <AppThemeProvider>
            <HeroUINativeProvider>
              <LocaleProvider>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: "#ffffff" },
                    animation: "fade_from_bottom",
                  }}
                >
                  <Stack.Screen name="index" options={{ headerShown: false }} />
                  <Stack.Screen name="emergency" options={{ headerShown: false }} />
                  <Stack.Screen name="witness" options={{ headerShown: false }} />
                  <Stack.Screen name="modal" options={{ headerShown: false, presentation: "modal" }} />
                </Stack>
              </LocaleProvider>
            </HeroUINativeProvider>
          </AppThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
