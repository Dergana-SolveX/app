import React from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { WitnessReport } from "@/components/witness-report";

export default function EmergencyScreen() {
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#ffffff" }} edges={["top", "bottom"]}>
      <WitnessReport onBack={handleBack} />
    </SafeAreaView>
  );
}
