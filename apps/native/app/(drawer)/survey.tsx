import React from "react";
import { View } from "react-native";
import { CellSurvey } from "@/components/cell-survey";

export default function SurveyScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: "#020617" }}>
      <CellSurvey />
    </View>
  );
}
