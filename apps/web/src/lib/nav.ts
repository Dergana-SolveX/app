import type { AppRole, RoleHolder } from "@solvex-dergana/shared";
import { linkOptions, type LinkProps } from "@tanstack/react-router";
import {
  AmbulanceIcon,
  CpuIcon,
  HospitalIcon,
  RadioTowerIcon,
  TerminalSquareIcon,
  type LucideIcon,
} from "lucide-react";

export const ROLE_LABEL: Record<AppRole, string> = {
  dispatcher: "Dispatcher",
  medic: "Secouriste",
  hospital: "Urgences hôpital",
  admin: "Administrateur",
};

export type NavItem = {
  label: string;
  icon: LucideIcon;
  link: LinkProps;
};

/** Sidebar entries for a role. Only screens the role may open (see `canAccess`). */
export function navFor(user: RoleHolder): NavItem[] {
  const dispatcher: NavItem = {
    label: "Poste de commandement",
    icon: RadioTowerIcon,
    link: linkOptions({ to: "/dispatcher" }),
  };
  switch (user.role) {
    case "dispatcher":
      return [dispatcher];
    case "medic":
      return user.unitId
        ? [
            {
              label: "Ma mission",
              icon: AmbulanceIcon,
              link: linkOptions({ to: "/ambulance/$unitId", params: { unitId: user.unitId } }),
            },
          ]
        : [];
    case "hospital":
      return user.hospitalId
        ? [
            {
              label: "Tableau des arrivées",
              icon: HospitalIcon,
              link: linkOptions({
                to: "/hospital/$hospitalId",
                params: { hospitalId: user.hospitalId },
              }),
            },
          ]
        : [];
    case "admin":
      return [
        dispatcher,
        { label: "Console de démo", icon: TerminalSquareIcon, link: linkOptions({ to: "/console" }) },
        { label: "IoT Showcase", icon: CpuIcon, link: linkOptions({ to: "/iot" }) },
      ];
  }
}
