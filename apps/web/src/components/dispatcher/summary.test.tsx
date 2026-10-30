import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DispatcherSummary } from "./summary";
it("counts active incidents and shows a lost live connection", () => {
  render(
    <DispatcherSummary
      incidents={[
        { status: "open", recSeverity: "red" },
        { status: "dispatched", recSeverity: "yellow" },
        { status: "false_alarm", recSeverity: "red" },
        { status: "closed", recSeverity: "red" },
      ]}
      status="error"
    />,
  );
  expect(screen.getByText("2 en cours")).toBeTruthy();
  expect(screen.getByText("1 RED")).toBeTruthy();
  expect(screen.getByText("1 en attente")).toBeTruthy();
  expect(screen.getByText(/Flux interrompu/)).toBeTruthy();
});
