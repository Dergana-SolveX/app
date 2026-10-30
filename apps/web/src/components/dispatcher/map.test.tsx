import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DispatcherMap } from "./map";

it("selects a located incident on the map while excluding an unlocated report", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 400,
    width: 800,
    height: 400,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const select = vi.fn();
  render(
    <DispatcherMap
      incidents={[
        {
          id: "a",
          lat: 36.7,
          lng: 3.1,
          locationUncertaintyM: 100,
          recSeverity: "red",
          commune: "Rouiba",
        },
        {
          id: "b",
          lat: null,
          lng: null,
          locationUncertaintyM: null,
          recSeverity: "unknown",
          commune: null,
        },
      ]}
      layers={{ units: [], hospitals: [], zones: [] }}
      selectedId={null}
      onSelect={select}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Incident Rouiba — RED" }),
    { clientX: 100, clientY: 100 },
  );
  expect(select).toHaveBeenCalledWith("a");
  expect(screen.queryByRole("button", { name: /Incident b/ })).toBeNull();
  expect(screen.getByRole("link", { name: /OpenStreetMap/ })).toBeTruthy();
});
