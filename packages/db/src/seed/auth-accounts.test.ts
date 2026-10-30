import { describe, expect, it } from "vitest";

import { buildDemoAccounts } from "./auth-accounts";
import { userRows } from "./users";

const accounts = buildDemoAccounts(userRows);
const emailOf = (appUserId: string) => accounts.find((a) => a.appUserId === appUserId)?.email;

describe("buildDemoAccounts", () => {
  it("creates exactly one account per seeded app user", () => {
    expect(accounts).toHaveLength(userRows.length);
    expect(new Set(accounts.map((a) => a.appUserId)).size).toBe(userRows.length);
  });

  it("gives every account a unique email", () => {
    expect(new Set(accounts.map((a) => a.email)).size).toBe(accounts.length);
  });

  it("uses the documented email for each role", () => {
    expect(emailOf("00000000-0000-4000-8000-000000000601")).toBe("dispatcher@svx.demo");
    expect(emailOf("00000000-0000-4000-8000-000000000602")).toBe("admin@svx.demo");
    expect(emailOf("00000000-0000-4000-8000-000000000603")).toBe("medic1@svx.demo");
    expect(emailOf("00000000-0000-4000-8000-000000000604")).toBe("medic2@svx.demo");
  });

  it("derives hospital emails from the hospital name without accents or spaces", () => {
    expect(emailOf("00000000-0000-4000-8000-000000000700")).toBe("hospital-mustapha@svx.demo");
    expect(emailOf("00000000-0000-4000-8000-000000000705")).toBe("hospital-ait-idir@svx.demo");
    expect(emailOf("00000000-0000-4000-8000-000000000710")).toBe(
      "hospital-poly-bab-ezzouar@svx.demo",
    );
  });

  it("gives each account a stable, unique auth user id so seeding is repeatable", () => {
    const again = buildDemoAccounts(userRows);
    expect(again.map((a) => a.authUserId)).toEqual(accounts.map((a) => a.authUserId));
    expect(new Set(accounts.map((a) => a.authUserId)).size).toBe(accounts.length);
  });
});
