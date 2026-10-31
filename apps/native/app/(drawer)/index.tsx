import React from "react";
import { View } from "react-native";
import { WitnessReport } from "@/components/witness-report";

export default function Home() {
  return (
    <View className="flex-1 bg-background">
      <WitnessReport />
    </View>
  );
}
