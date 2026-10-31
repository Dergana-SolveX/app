import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { VittelIndicator } from "./vittel-indicator";

const result = {
  severe: true,
  positives: [
    {
      level: "l3" as const,
      id: "penetratingHead",
      label: "Plaie pénétrante de la tête",
      source: "medic" as const,
    },
    {
      level: "l3" as const,
      id: "penetratingAbdomen",
      label: "Plaie pénétrante de l'abdomen",
      source: "medic" as const,
    },
  ],
};

it("shows a severe Vittel icon and reveals its details on hover or click", () => {
  render(<VittelIndicator victim={1} result={result} />);
  const trigger = screen.getByRole("button", {
    name: "Détails Vittel de la victime 1",
  });

  expect(screen.queryByText("Plaie pénétrante de la tête")).toBeNull();
  fireEvent.mouseEnter(trigger);
  expect(screen.getByText(/Plaie pénétrante de la tête/)).toBeTruthy();
  expect(screen.getByText(/Plaie pénétrante de l'abdomen/)).toBeTruthy();

  fireEvent.mouseLeave(trigger);
  expect(screen.queryByText(/Plaie pénétrante de la tête/)).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByText("Traumatisé grave (Vittel)")).toBeTruthy();
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});
