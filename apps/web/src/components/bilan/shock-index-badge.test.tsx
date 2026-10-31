import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { ShockIndexBadge } from "./shock-index-badge";

it("does not crash when a persisted handover contains an unknown shock-index flag", () => {
  render(
    <ShockIndexBadge
      result={{ value: 1.18, flag: "unknown-from-storage", caveats: [] } as never}
    />,
  );

  expect(screen.getByRole("status").textContent).toContain("1,18");
  expect(screen.getByText("Statut inconnu")).toBeTruthy();
});

it("does not crash when a persisted shock-index reading is incomplete", () => {
  render(
    <ShockIndexBadge
      result={{ flag: "unknown-from-storage" } as never}
    />,
  );

  expect(screen.getByRole("status").textContent).toContain("—");
  expect(screen.getByText("Statut inconnu")).toBeTruthy();
});
