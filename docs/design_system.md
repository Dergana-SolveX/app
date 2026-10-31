# AWN — Visual Identity & Design System

> **عون | AWN**  
> A digital emergency-response system designed to make reporting accidents and requesting assistance faster, clearer and more accessible.

---

## 1. Brand Identity

**Brand name**
- French / Latin: AWN
- Arabic: عون

**Brand personality**
- Reassuring
- Human
- Reliable
- Responsive
- Accessible
- Modern

**Visual direction**

AWN uses a clean, modern and minimal visual language built around teal and deep forest green.

The interface should communicate trust, safety and responsiveness without overwhelming users, especially in stressful emergency situations.

Avoid unnecessary decoration, excessive gradients, distracting animations and complicated visual elements.

## 2. Logo & Brand Assets

Official logo assets are located in:

`public/images/`

Available assets:
- `logo_bright` — logo for bright/light backgrounds.
- `logo_dark` — logo for dark backgrounds.

**Logo guidelines**
- Always use the original logo assets.
- Never distort, stretch or modify the logo proportions.
- Maintain sufficient clear space around the logo.
- Use the appropriate logo variant depending on the background.
- Do not recreate the logo using text or alternative icons.

## 3. Color System

### 3.1 Brand Colors

The primary identity is based on two foundational colors.

| Token | Hex | Purpose |
|---|---|---|
| Primary Teal | `#0D9488` | Brand identity, accents, interactive elements |
| Deep Forest | `#042E2A` | Dark surfaces, deep backgrounds, brand contrast |

Supporting brand colors:

| Token | Hex | Purpose |
|---|---|---|
| Teal Light | `#CCFBF1` | Light highlights |
| Teal Soft | `#99F6E4` | Secondary accents |
| Teal Medium | `#2DD4BF` | Dark-mode interactive accents |
| Teal Dark | `#0F766E` | Accessible primary buttons in light mode |
| Forest Soft | `#164E48` | Supporting dark surfaces |
| Forest Deep | `#021C19` | Deepest backgrounds |

### 3.2 Light Theme

The bright theme should feel clean, breathable and welcoming.

| Token | Hex | Usage |
|---|---|---|
| Background | `#F7FAF9` | Main application background |
| Surface | `#FFFFFF` | Cards, panels and dialogs |
| Surface Secondary | `#EFF5F3` | Secondary sections |
| Surface Tertiary | `#E5EFEC` | Subtle highlighted areas |
| Primary | `#0D9488` | Brand accents |
| Primary Action | `#0F766E` | Primary buttons with white text |
| Primary Hover | `#115E59` | Hover states |
| Text Primary | `#102A27` | Main headings and content |
| Text Secondary | `#526B66` | Supporting text |
| Text Muted | `#78908A` | Metadata and placeholders |
| Border | `#DCE8E4` | Default borders |
| Border Strong | `#B8CDC6` | Emphasized borders |

### 3.3 Dark Theme

The dark theme should use deep green-tinted surfaces instead of pure black.

| Token | Hex | Usage |
|---|---|---|
| Background | `#071B19` | Main application background |
| Surface | `#0B2522` | Cards and panels |
| Surface Secondary | `#10312D` | Secondary sections |
| Surface Tertiary | `#164039` | Elevated surfaces |
| Primary | `#2DD4BF` | Brand accents |
| Primary Action | `#0F766E` | Primary buttons |
| Primary Hover | `#0D9488` | Hover states |
| Text Primary | `#EAF5F2` | Main headings and content |
| Text Secondary | `#A7C2BB` | Supporting text |
| Text Muted | `#789B92` | Metadata |
| Border | `#1E4841` | Default borders |
| Border Strong | `#32645B` | Emphasized borders |

### 3.4 Semantic Colors

Semantic colors must remain distinguishable from the brand palette.

They communicate system status and must never be used purely for decoration.

| Meaning | Light Theme | Dark Theme |
|---|---|---|
| Success | `#15803D` | `#4ADE80` |
| Success Background | `#DCFCE7` | `#123522` |
| Warning | `#B45309` | `#FBBF24` |
| Warning Background | `#FEF3C7` | `#3B2B12` |
| Danger / Critical | `#B91C1C` | `#F87171` |
| Danger Background | `#FEE2E2` | `#3B191B` |
| Information | `#1D4ED8` | `#60A5FA` |
| Information Background | `#DBEAFE` | `#172C49` |

**Emergency-state rules**
- Red is reserved for critical emergencies, dangerous situations and destructive actions.
- Orange/amber indicates warnings and situations requiring attention.
- Green indicates successful actions and confirmed states.
- Blue indicates neutral information.
- Teal represents AWN's brand identity and normal interactive actions.
- Never communicate an emergency state through color alone. Always include clear labels and recognizable icons.

## 4. Typography

AWN supports French and Arabic as first-class interface languages.

### 4.1 Font Families

| Language | Font | Usage |
|---|---|---|
| French | Geist | All Latin interface text |
| Arabic | IBM Plex Sans Arabic | All Arabic interface text |

Use the appropriate font automatically based on the active language.

### 4.2 Typography Scale

| Element | Size | Weight |
|---|---:|---:|
| Display | 36px | 700 |
| H1 | 30px | 700 |
| H2 | 24px | 650 |
| H3 | 20px | 600 |
| H4 | 18px | 600 |
| Body Large | 18px | 400 |
| Body | 16px | 400 |
| Body Small | 14px | 400 |
| Caption | 12px | 500 |
| Button | 16px | 600 |

### 4.3 Typography Guidelines

- Prioritize readability over decorative typography.
- Avoid thin font weights.
- Maintain comfortable line heights.
- Important emergency instructions should use at least 16px.
- Use clear visual hierarchy.
- Avoid long uppercase text.
- Keep numerical information easy to scan.
- Arabic text must have appropriate line height and spacing.
- Support proper Arabic shaping, punctuation and right-to-left rendering.

## 5. Border Radius System

AWN follows a rounded, friendly and consistent interface language.

**Every component that benefits from rounded corners should use the shared radius system. Avoid sharp, inconsistent corners.**

| Token | Value | Usage |
|---|---:|---|
| Radius XS | 6px | Small tags and compact elements |
| Radius SM | 8px | Small controls |
| Radius MD | 12px | Inputs and buttons |
| Radius LG | 16px | Cards and containers |
| Radius XL | 20px | Large cards and dialogs |
| Radius 2XL | 24px | Large panels and featured sections |
| Radius Full | 9999px | Pills, badges and circular elements |

Avoid arbitrary radius values. Reuse the established tokens.

## 6. Spacing System

Use a consistent 4px-based spacing scale.

| Token | Value |
|---|---:|
| Space 1 | 4px |
| Space 2 | 8px |
| Space 3 | 12px |
| Space 4 | 16px |
| Space 5 | 20px |
| Space 6 | 24px |
| Space 8 | 32px |
| Space 10 | 40px |
| Space 12 | 48px |
| Space 16 | 64px |

Maintain comfortable spacing, especially around emergency instructions, buttons and important information.

## 7. Shadows & Elevation

Use subtle shadows and borders to establish visual hierarchy.

- Small elevation: subtle shadow for buttons and inputs.
- Medium elevation: cards and dropdowns.
- Large elevation: dialogs and overlays.

Light mode should use soft neutral shadows.

Dark mode should rely more on surface contrast and subtle borders than heavy shadows.

Avoid excessive glow effects, strong blur and overly decorative glassmorphism.

## 8. Components & UI Patterns

All reusable components must follow the same visual language.

### Buttons
- Rounded corners.
- Clear action labels.
- Comfortable touch targets.
- Strong contrast.
- Distinct primary, secondary, outline and destructive variants.
- Disabled states must remain visually understandable.

### Cards
- Rounded corners.
- Consistent internal padding.
- Subtle borders.
- Clear information hierarchy.
- Avoid unnecessary decoration.

### Inputs
- Rounded corners.
- Clearly visible labels.
- Distinct focus, error, disabled and filled states.
- Error messages must be explicit.

### Alerts
- Use semantic colors.
- Include an icon and descriptive text.
- Critical alerts must be immediately recognizable.

### Navigation
- Keep navigation simple.
- Maintain consistent active states.
- Support both LTR and RTL layouts.

## 9. Icons

Use a consistent outline icon family.

Recommended library: Lucide Icons.

Guidelines:
- Prefer simple, universally recognizable icons.
- Maintain consistent stroke weight.
- Use consistent sizing.
- Never use emojis as replacements for interface icons.
- Emergency actions must have both an icon and a clear text label.

## 10. Backgrounds & Visual Patterns

AWN should use subtle visual patterns that reinforce its identity without competing with the interface.

Recommended patterns:
- Very subtle grid patterns.
- Soft teal radial backgrounds.
- Minimal geometric shapes.
- Low-opacity decorative elements.
- Subtle gradients using the existing brand colors.

Avoid:
- Busy backgrounds.
- Strong textures.
- Excessive decorative elements.
- Patterns behind important emergency instructions.

## 11. Accessibility & Emergency UX

Accessibility is a core part of AWN's visual identity.

- Maintain WCAG AA contrast wherever possible.
- Normal text should have at least 4.5:1 contrast.
- Large text should have at least 3:1 contrast.
- Interactive touch targets should preferably be at least 44 × 44px.
- Never rely on color alone to convey meaning.
- Keep emergency actions visible and easy to understand.
- Minimize the number of steps required to report an accident.
- Use direct, simple and human language.
- Avoid unnecessary animations during emergency flows.
- Respect reduced-motion preferences.

## 12. Responsive Design

AWN is mobile-first.

Priority:
1. Mobile phones.
2. Tablets.
3. Desktop screens.

Guidelines:
- Prioritize one-handed mobile interaction.
- Make primary actions easy to reach.
- Prevent horizontal overflow.
- Maintain readable typography at every breakpoint.
- Adapt layouts without changing the underlying visual identity.

## 13. Development Rules

The visual identity must be consistent across the entire application.

1. Always read this document before creating or modifying UI.
2. Reuse existing design tokens instead of introducing arbitrary values.
3. Support both light and dark themes.
4. Support French LTR and Arabic RTL layouts.
5. Use Geist for French and IBM Plex Sans Arabic for Arabic.
6. Use the official logo assets from `public/images/`.
7. Never introduce additional brand colors without a clear reason.
8. Maintain accessible contrast and readable typography.
9. Build reusable components rather than duplicating styles.
10. Keep the implementation and documentation synchronized.

---

**AWN — عون**

*Technology that responds. Assistance when it matters.*