import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { GcsPicker, NumberStepper, ToggleChip } from "./controls";

it("offers precise and ten-unit adjustments on numeric measures", () => {
  const onChange = vi.fn();
  render(
    <NumberStepper
      label="Âge estimé"
      unit="ans"
      value={30}
      onChange={onChange}
      min={0}
      max={120}
      fallback={30}
      quickStep={10}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Diminuer Âge estimé de 10" }));
  expect(onChange).toHaveBeenLastCalledWith(20);
  fireEvent.click(screen.getByRole("button", { name: "Augmenter Âge estimé" }));
  expect(onChange).toHaveBeenLastCalledWith(31);
});

it("sets the detailed Glasgow components on separate red-to-green sliders", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <GcsPicker eye={null} verbal={null} motor={null} onChange={onChange} />,
  );
  const sliders = screen.getAllByRole("slider");
  expect(sliders).toHaveLength(3);

  fireEvent.change(screen.getByRole("slider", { name: "Yeux (E)" }), {
    target: { value: "4" },
  });
  expect(onChange).toHaveBeenCalledWith({ eye: 4, verbal: null, motor: null });

  fireEvent.click(screen.getByRole("button", { name: "Moteur 4 : Évitement" }));
  expect(onChange).toHaveBeenCalledWith({ eye: null, verbal: null, motor: 4 });

  rerender(<GcsPicker eye={4} verbal={5} motor={6} onChange={onChange} />);
  expect(screen.getByText(/15 \/ 15.*Rassurant/)).toBeTruthy();
});

it("shows a selected chip as green without a checkbox container", () => {
  render(
    <ToggleChip label="Fracture ouverte" pressed onPressedChange={vi.fn()} />,
  );

  const chip = screen.getByRole("button", { name: "Fracture ouverte" });
  expect(chip.getAttribute("aria-pressed")).toBe("true");
  expect(chip.className).toContain("bg-sev-green-soft");
  expect(chip.querySelector("span")).toBeNull();
});
