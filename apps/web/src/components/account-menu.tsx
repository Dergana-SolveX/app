import { Button } from "@solvex-dergana/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@solvex-dergana/ui/components/dropdown-menu";
import type { AppRole } from "@solvex-dergana/shared";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, LogOutIcon } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { ROLE_LABEL } from "@/lib/nav";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export default function AccountMenu({
  name,
  email,
  role,
}: {
  name: string;
  email: string;
  role: AppRole;
}) {
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="h-11 gap-2.5 px-2" />}>
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
        >
          {initials(name)}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-semibold">{name}</span>
          <span className="block text-xs font-medium text-muted-foreground">{ROLE_LABEL[role]}</span>
        </span>
        <ChevronDownIcon className="size-4 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Compte</DropdownMenuLabel>
          <div className="px-2.5 pb-2">
            <p className="font-semibold">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              authClient.signOut({
                fetchOptions: { onSuccess: () => navigate({ to: "/login" }) },
              })
            }
          >
            <LogOutIcon />
            Se déconnecter
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
