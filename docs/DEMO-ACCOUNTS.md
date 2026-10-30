# Demo accounts

Seeded by `bun run db:seed` / `bun run db:reset` (see `packages/db/src/seed/auth-accounts.ts`).
Each `app_users` row gets a Better Auth email/password login, linked through `app_users.auth_user_id`.

## Password

All demo accounts share one password: the `DEMO_PASSWORD` value in `apps/server/.env`.
The local-dev default in `apps/server/.env.example` is `svx-demo-2026` (copy it, and set the same
value as `VITE_DEMO_PASSWORD` in `apps/web/.env`). Use a different one for any deployed instance.
The web app reads the same value from `VITE_DEMO_PASSWORD` in `apps/web/.env` for the quick-login
buttons (keep the two equal). It is never shown in the UI.

To change it: edit both `.env` files, then run `bun run db:reset` (reset recreates the demo logins;
a plain `db:seed` keeps existing ones).

## Accounts (17)

| Email | Role | Lands on |
|---|---|---|
| `dispatcher@svx.demo` | dispatcher | `/dispatcher` |
| `admin@svx.demo` | admin (presenter) | `/console`, can open every screen incl. `/iot` |
| `medic1@svx.demo` | medic, unit PC-ALG-01 | `/ambulance/<unit id>` |
| `medic2@svx.demo` | medic, unit PC-HRH-01 | `/ambulance/<unit id>` |
| `hospital-<name>@svx.demo` | hospital staff, one per hospital | `/hospital/<hospital id>` |

Hospital emails: `hospital-mustapha`, `hospital-bab-el-oued`, `hospital-beni-messous`,
`hospital-hussein-dey`, `hospital-zemirli`, `hospital-ait-idir`, `hospital-brules`,
`hospital-rouiba`, `hospital-bologhine`, `hospital-ain-taya`, `hospital-poly-bab-ezzouar`,
`hospital-poly-el-madania`, `hospital-poly-baraki` (all `@svx.demo`).

The login page has quick-login buttons for dispatcher, medic 1, medic 2, CHU Mustapha and admin.
The other hospitals log in by typing their email.

## Access rules

Defined in `packages/shared/src/roles.ts` (`canAccess`), enforced on the web by `requireAccess`
and on the API by `roleProcedure(...roles)` in `packages/api`.

- The admin opens every screen.
- The dispatcher opens `/dispatcher` only.
- A medic opens only `/ambulance/<their own unit id>`.
- Hospital staff open only `/hospital/<their own hospital id>`.
- Anyone else is redirected to their own screen; a login with no `app_users` row sees "Accès refusé".
