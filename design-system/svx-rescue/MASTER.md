# SVX Rescue design system (MASTER)

Source of truth for every screen (PRD NFR-UI1/UI2). Built with the UI/UX Pro Max skill
(`.claude/skills/ui-ux-pro-max`): style **Data-Dense Dashboard**, healthcare palette,
accessibility-first typography. Tokens live in `packages/ui/src/styles/globals.css`.
Page-specific overrides go in `design-system/svx-rescue/pages/<page>.md` and win over this file.

**Rule: never use a stock shadcn look.** Use the components in `packages/ui` (already restyled) and
the tokens below. Do not add `rounded-none`, `ring-foreground/10`, raw hex colors, or default grey/black themes.

## Identity
- Brand = clinical teal (`primary`). It means "system / action".
- **Red is only for severity and danger.** Never use it as decoration or brand.
- The sidebar is the brand anchor: deep navy in light and dark themes.
- Tone: calm, precise, no playfulness. Information first, flat surfaces, 1px borders, tiny shadows.

## Color tokens (use the token, never the hex)
| Token | Use |
|---|---|
| `background` / `card` / `raised` | page / panel / nested panel |
| `foreground` / `muted-foreground` | text / secondary text |
| `primary` / `accent` | actions, selection, links / soft selected background |
| `border` / `input` | hairlines / form control borders |
| `destructive` | destructive actions only |
| `sev-red`, `sev-yellow`, `sev-green`, `sev-unknown` (+ `-soft`) | triage severity |
| `sev-ai` (+ `-soft`) | "Suggestion IA — à vérifier" content |
| `emulation` (+ `-soft`) | ÉMULATION / TRACE SYNTHÉTIQUE (honesty rule) |
| `sidebar-*` | sidebar and brand panels |

Light and dark are designed together. Text pairs meet 4.5:1. Severity is **never color alone**:
use `SeverityBadge` (icon + word). UNKNOWN is never green.

## Typography
- UI: **Figtree Variable**. Data, IDs, SVX strings, timers: **JetBrains Mono Variable** (`font-mono`, add `tabular`).
- Arabic: **Noto Sans Arabic Variable** is in the font stack; use logical properties
  (`ms-*`, `ps-*`, `start-*`, `text-start`) and flip arrows with `rtl:rotate-180`.
- All fonts are bundled locally (offline-first). Body 14px, inputs 16px on mobile, headings extrabold with tight tracking.
- Scale: 12 / 14 / 16 / 20 / 24 / 30. Line height 1.5 for body.

## Shape, spacing, motion
- Radius: controls and cards `rounded-md` / `rounded-lg` (8px). Pills `rounded-full` only for avatars.
- Spacing on a 4px grid. Dense screens (dispatcher, hospital) use 8–12px gaps; forms use 20px.
- Touch targets: 40px default controls, **44px+ on tablet and phone screens** (`size="lg"` = 48px).
- Motion: 150ms color/transform transitions only. No decorative animation. `prefers-reduced-motion` is honored globally.
- Focus: 2px `ring` outline with offset on every interactive element. Never remove it.

## Components (packages/ui)
`Button` (default/secondary/outline/ghost/destructive/link; xs–lg, icon), `Input`, `Textarea`, `Checkbox`,
`Label`, `Card` (panel), `DropdownMenu`, `Tooltip`, `Skeleton`, `Toaster`, `Logo`, `LogoMark`,
`SeverityBadge`, `EmulationBadge`.
App-level (apps/web): `AppShell` (sidebar, top bar, bottom nav under `md`), `PageHeader` / `ScreenShell`,
`ConnectionStatus`, `ThemeToggle`, `AccountMenu`.

## Layout
- Desktop/tablet: 16rem sidebar + 4rem top bar + scrolling content. Below `md`: bottom navigation (hidden when a role has one screen).
- Every screen starts with `PageHeader`. Simulated screens pass `emulated` to show the badge.
- The IoT Showcase may use its own full-screen dark projector layout on top of these tokens.

## Anti-patterns
Stock shadcn grey/black look, neumorphism, gradients as decoration, emoji as icons (use Lucide SVG),
color-only status, placeholder-only labels, hover-only controls, raw hex in components.
