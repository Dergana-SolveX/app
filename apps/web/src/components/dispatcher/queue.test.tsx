import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DispatcherQueue } from "./queue";

it("prioritizes red incidents and lets a dispatcher select an unlocated report", async () => {
  const select = vi.fn();
  render(
    <DispatcherQueue
      incidents={[
        {
          id: "a",
          recSeverity: "yellow",
          status: "open",
          lat: 36.7,
          lng: 3.1,
          firstAlertAt: "2026-10-30T10:00:00Z",
          alertCount: 1,
          estimatedVictims: 1,
          commune: "Alger",
          emulated: false,
          tentative: false,
        },
        {
          id: "b",
          recSeverity: "red",
          status: "open",
          lat: 36.8,
          lng: 3.1,
          firstAlertAt: "2026-10-30T09:00:00Z",
          alertCount: 2,
          estimatedVictims: 3,
          commune: "Rouiba",
          emulated: true,
          tentative: false,
        },
        {
          id: "c",
          recSeverity: "unknown",
          status: "open",
          lat: null,
          lng: null,
          firstAlertAt: "2026-10-30T11:00:00Z",
          alertCount: 1,
          estimatedVictims: null,
          commune: null,
          emulated: false,
          tentative: false,
        },
      ]}
      selectedId={null}
      onSelect={select}
    />,
  );
  const located = screen.getByRole("region", { name: "Incidents localisés" });
  expect(within(located).getAllByRole("button")[0]?.textContent).toContain(
    "Rouiba",
  );
  const unknown = screen.getByRole("region", { name: "Sans position" });
  await userEvent.click(within(unknown).getByRole("button"));
  expect(select).toHaveBeenCalledWith("c");
  expect(within(unknown).getByText(/rappeler/i)).toBeTruthy();
});
