import React from "react";
import { View } from "react-native";
import { WitnessReport } from "@/components/witness-report";

export default function Home() {
  return (
    <View style={{ flex: 1, backgroundColor: "#020617" }}>
      <WitnessReport />
    </View>
  );
}
