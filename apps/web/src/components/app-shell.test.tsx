import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppShell from "./app-shell";

vi.mock("@/components/locale-provider", () => ({
  useLocale: () => ({ locale: "fr", setLocale: vi.fn() }),
}));

vi.mock("@/components/connection-status", () => ({
  default: () => <div data-testid="connection-status">Online</div>,
}));

vi.mock("@/components/theme-toggle", () => ({
  default: () => <div data-testid="theme-toggle">Theme</div>,
}));

vi.mock("@/components/account-menu", () => ({
  default: ({ name, role }: { name: string; role: string }) => (
    <div data-testid="account-menu">
      {name} ({role})
    </div>
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className, activeProps, ...props }: any) => (
    <a className={className} data-testid="nav-link" {...props}>
      {children}
    </a>
  ),
  linkOptions: (opts: any) => opts,
}));

describe("AppShell navigation layout", () => {
  const user = { name: "Adem", email: "adem@svx.demo" };

  it("renders desktop sidebar only for admin", () => {
    const { container } = render(
      <AppShell user={user} appUser={{ role: "admin", hospitalId: null, unitId: null }}>
        <p>Admin Workspace</p>
      </AppShell>,
    );

    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside?.textContent).toContain("Poste de commandement");
    expect(aside?.textContent).toContain("Console de démo");
    expect(aside?.textContent).toContain("Démonstration IoT");
  });

  it("removes sidebar and renders top navigation for dispatcher", () => {
    const { container } = render(
      <AppShell user={user} appUser={{ role: "dispatcher", hospitalId: null, unitId: null }}>
        <p>Dispatcher Workspace</p>
      </AppShell>,
    );

    const aside = container.querySelector("aside");
    expect(aside).toBeNull();

    // Top header should have navigation item next to logo
    const topNav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(topNav).toBeTruthy();
    expect(screen.getByText("Poste de commandement")).toBeTruthy();
  });

  it("removes sidebar and renders top navigation for medic (secouriste)", () => {
    const { container } = render(
      <AppShell user={user} appUser={{ role: "medic", hospitalId: null, unitId: "PC-ALG-01" }}>
        <p>Ambulance Workspace</p>
      </AppShell>,
    );

    const aside = container.querySelector("aside");
    expect(aside).toBeNull();

    const topNav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(topNav).toBeTruthy();
    expect(screen.getByText("Ma mission")).toBeTruthy();
  });

  it("removes sidebar and renders top navigation for hospital", () => {
    const { container } = render(
      <AppShell user={user} appUser={{ role: "hospital", hospitalId: "chu-mustapha", unitId: null }}>
        <p>Hospital Workspace</p>
      </AppShell>,
    );

    const aside = container.querySelector("aside");
    expect(aside).toBeNull();

    const topNav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(topNav).toBeTruthy();
    expect(screen.getByText("Tableau des arrivées")).toBeTruthy();
  });
});
