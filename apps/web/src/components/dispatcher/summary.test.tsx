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
  const summary = screen.getByLabelText("Synthèse opérationnelle").textContent;
  expect(summary).toContain("2 en cours");
  expect(summary).toContain("1 RED");
  expect(summary).toContain("1 en attente");
  expect(screen.getByText(/Flux interrompu/)).toBeTruthy();
});

it("does not render 'Flux en direct' on the dispatcher page when connection is healthy", () => {
  render(
    <DispatcherSummary
      incidents={[]}
      status="pending"
    />,
  );
  expect(screen.queryByText(/Flux en direct/)).toBeNull();
});
