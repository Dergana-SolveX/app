import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DispatcherQueue } from "./queue";

const base = {
  status: "open" as const,
  alertCount: 1,
  estimatedVictims: 1,
  emulated: false,
  tentative: false,
};
const incidents = [
  { ...base, id: "a", recSeverity: "red" as const, lat: 36.7, lng: 3.1, commune: "Rouiba", firstAlertAt: "2026-10-30T09:00:00Z", lastAlertAt: "2026-10-30T09:00:00Z" },
  { ...base, id: "b", recSeverity: "green" as const, lat: 36.8, lng: 3.1, commune: "Alger", firstAlertAt: "2026-10-30T08:00:00Z", lastAlertAt: "2026-10-30T11:30:00Z" },
  { ...base, id: "c", recSeverity: "unknown" as const, lat: null, lng: null, commune: null, firstAlertAt: "2026-10-30T10:00:00Z", lastAlertAt: "2026-10-30T10:00:00Z" },
  { ...base, id: "d", recSeverity: "yellow" as const, status: "closed" as const, lat: 36.7, lng: 3.2, commune: "Closed", firstAlertAt: "2026-10-30T12:00:00Z", lastAlertAt: "2026-10-30T12:00:00Z" },
];

it("lists active alerts by arrival, latest signal first, whatever their severity", () => {
  render(<DispatcherQueue incidents={incidents} selectedId={null} onSelect={vi.fn()} />);
  const list = screen.getByRole("list", { name: /la plus récente en premier/ });
  const names = within(list).getAllByRole("listitem").map((li) => li.textContent);
  expect(names[0]).toContain("Alger");
  expect(names[1]).toContain("Incident #C");
  expect(names[2]).toContain("Rouiba");
  expect(names.join(" ")).not.toContain("Closed");
  expect(within(list).getByText(/rappeler pour préciser/i)).toBeTruthy();
});

it("selects, highlights on hover and locates an alert; filters by severity", async () => {
  const select = vi.fn();
  const highlight = vi.fn();
  const locate = vi.fn();
  render(
    <DispatcherQueue
      incidents={incidents}
      selectedId={null}
      onSelect={select}
      onHighlight={highlight}
      onLocate={locate}
      unseenIds={new Set(["a"])}
    />,
  );
  expect(screen.getByText("Nouveau")).toBeTruthy();
  const rouiba = screen.getByRole("button", { name: /Rouiba/, pressed: false });
  fireEvent.mouseEnter(rouiba.closest("li")!);
  expect(highlight).toHaveBeenCalledWith("a");
  await userEvent.click(rouiba);
  expect(select).toHaveBeenCalledWith("a");
  await userEvent.click(screen.getByRole("button", { name: "Voir Rouiba sur la carte" }));
  expect(locate).toHaveBeenCalledWith("a");
  expect(screen.getByRole("button", { name: "Incident #C : position inconnue" }).hasAttribute("disabled")).toBe(true);

  const filters = screen.getByRole("group", { name: "Filtrer par gravité" });
  await userEvent.click(within(filters).getByRole("button", { name: /Rouge/ }));
  const list = screen.getByRole("list", { name: /la plus récente en premier/ });
  expect(within(list).getAllByRole("listitem")).toHaveLength(1);
});
