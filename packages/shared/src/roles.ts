export type AppRole = "dispatcher" | "medic" | "hospital" | "admin";

export type RoleHolder = {
  role: AppRole;
  unitId: string | null;
  hospitalId: string | null;
};

/** The screen a role lands on after login, or null when the account is missing its unit/hospital. */
export function landingPathFor({ role, unitId, hospitalId }: RoleHolder): string | null {
  switch (role) {
    case "dispatcher":
      return "/dispatcher";
    case "admin":
      return "/console";
    case "medic":
      return unitId ? `/ambulance/${unitId}` : null;
    case "hospital":
      return hospitalId ? `/hospital/${hospitalId}` : null;
  }
}

export type Screen =
  | { screen: "dispatcher" | "console" | "iot" }
  | { screen: "ambulance"; unitId: string }
  | { screen: "hospital"; hospitalId: string };

/** Whether a role may open a screen. The admin (presenter) sees everything. */
export function canAccess(holder: RoleHolder, target: Screen): boolean {
  if (holder.role === "admin") return true;
  switch (target.screen) {
    case "dispatcher":
      return holder.role === "dispatcher";
    case "ambulance":
      return holder.role === "medic" && holder.unitId === target.unitId;
    case "hospital":
      return holder.role === "hospital" && holder.hospitalId === target.hospitalId;
    case "console":
    case "iot":
      return false;
  }
}
