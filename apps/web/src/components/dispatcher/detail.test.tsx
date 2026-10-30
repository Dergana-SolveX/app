import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { IncidentDetailPanel } from "./detail";
import { incident } from "./fixtures";


it("shows original signals, simulation labels and the correction journal through tabs", async () => {
  render(
    <IncidentDetailPanel
      incident={incident}
      profiles={[]}
      candidates={[]}
      onCorrect={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("tab", { name: "Signaux bruts" }));
  expect(screen.getByText("SVX1 original")).toBeTruthy();
  expect(screen.getByText("TRACE SYNTHÉTIQUE")).toBeTruthy();
  expect(screen.getByText("ÉMULATION")).toBeTruthy();
  expect(screen.getByText("Un véhicule")).toBeTruthy();
  await userEvent.click(screen.getByRole("tab", { name: "Journal" }));
  expect(screen.getByText(/Deux accidents/)).toBeTruthy();
});

it("requires a reason before confirming a false alarm and keeps failures visible", async () => {
  const correct = vi
    .fn()
    .mockRejectedValue(new Error("Incident modifié : actualisez"));
  render(
    <IncidentDetailPanel
      incident={incident}
      profiles={[]}
      candidates={[]}
      onCorrect={correct}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Marquer fausse alerte" }),
  );
  const confirm = screen.getByRole("button", {
    name: "Confirmer la correction",
  });
  expect(confirm.hasAttribute("disabled")).toBe(true);
  await userEvent.type(
    screen.getByRole("textbox", { name: "Motif de correction" }),
    "Appel vérifié",
  );
  await userEvent.click(confirm);
  expect(correct).toHaveBeenCalledWith({
    kind: "false_alarm",
    reason: "Appel vérifié",
  });
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Incident modifié : actualisez",
  );
});

it("splits only selected signals after a reason is supplied", async () => {
  const correct = vi.fn().mockResolvedValue(undefined);
  const second = {
    ...incident.alerts[0]!,
    id: "00000000-0000-4000-8000-000000000003",
    rawPayload: "SVX second",
  };
  render(
    <IncidentDetailPanel
      incident={{
        ...incident,
        alertCount: 2,
        alerts: [...incident.alerts, second],
      }}
      profiles={[]}
      candidates={[]}
      onCorrect={correct}
    />,
  );
  await userEvent.click(screen.getByRole("tab", { name: "Signaux bruts" }));
  await userEvent.click(screen.getAllByRole("checkbox")[1]!);
  await userEvent.click(
    screen.getByRole("button", { name: "Séparer les signaux sélectionnés" }),
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Motif de correction" }),
    "Autre accident",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Confirmer la correction" }),
  );
  expect(correct).toHaveBeenCalledWith({
    kind: "split",
    alertIds: [second.id],
    reason: "Autre accident",
  });
});

it("merges into the target explicitly chosen by the dispatcher", async () => {
  const correct = vi.fn().mockResolvedValue(undefined);
  const target = {
    ...incident,
    id: "00000000-0000-4000-8000-000000000099",
    commune: "Rouiba",
    emulated: false,
    tentative: false,
  };
  render(
    <IncidentDetailPanel
      incident={incident}
      profiles={[]}
      candidates={[target]}
      onCorrect={correct}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Fusionner" }));
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Incident de destination" }),
    target.id,
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Motif de correction" }),
    "Même lieu confirmé",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Confirmer la correction" }),
  );
  expect(correct).toHaveBeenCalledWith({
    kind: "merge",
    targetId: target.id,
    reason: "Même lieu confirmé",
  });
});
