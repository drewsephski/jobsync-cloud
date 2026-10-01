---
name: JobSync Cloud
description: A refined job-search workspace with restrained blue accents and soft neutral surfaces.
colors:
  destructive: "oklch(57.7% 0.245 27.325)"
  destructive-hover: "oklch(50.5% 0.213 27.518)"
  main: "#2563eb"
  main-foreground: "#ffffff"
  background: "#f7f8fa"
  secondary-background: "oklch(100% 0 0)"
  foreground: "#182230"
  border: "#e2e6ec"
  ring: "#2563eb"
  tab-active: "#dce6f5"
  placeholder: "#657184"
  overlay: "oklch(0% 0 0 / 0.8)"
  main-dark: "#84aaff"
  main-foreground-dark: "#10151e"
  background-dark: "#10151e"
  secondary-background-dark: "#181f2a"
  foreground-dark: "#f3f6fc"
  border-dark: "#2c3543"
  ring-dark: "#5294ff"
  tab-active-dark: "#0b111a"
  placeholder-dark: "#a0adbf"
  overlay-dark: "#000000cc"
typography:
  display:
    fontFamily: "Geist, sans-serif"
    fontSize: "48px"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Geist, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Geist, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  caption:
    fontFamily: "Geist, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  badge: "6px"
  tab: "8px"
  base: "12px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
components:
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.main-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.base}"
    padding: "8px 16px"
    height: "40px"
  button-no-shadow:
    backgroundColor: "{colors.main}"
    textColor: "{colors.main-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.base}"
    padding: "8px 16px"
    height: "40px"
  button-reverse:
    backgroundColor: "{colors.main}"
    textColor: "{colors.main-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.base}"
    padding: "8px 16px"
    height: "40px"
  button-primary:
    backgroundColor: "{colors.main}"
    textColor: "{colors.main-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.base}"
    padding: "8px 16px"
    height: "40px"
  button-neutral:
    backgroundColor: "{colors.secondary-background}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.base}"
    padding: "8px 16px"
    height: "40px"
  input:
    backgroundColor: "{colors.secondary-background}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.base}"
    padding: "8px 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.secondary-background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.base}"
    padding: "24px"
  card-compact:
    backgroundColor: "{colors.secondary-background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.base}"
    padding: "16px"
  badge:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.badge}"
    padding: "2px 10px"
  tabs-active:
    backgroundColor: "{colors.tab-active}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.tab}"
    padding: "8px 12px"
---

# Design System: JobSync Cloud

## Overview

**Creative North Star: "The clear workspace"**

JobSync is a calm, minimal workspace: soft neutral grounds, gently rounded surfaces, a single restrained blue accent, and readable Geist typography. The public surfaces carry more space and a larger type scale; the application keeps the same materials at a practical working density.

Hierarchy comes from type, spacing, and restrained tonal contrast. Light and dark themes preserve semantic roles while changing their colors. The J-hook and outward-arrow mark provides the recurring identity; the product itself supplies the visual story.

**Key Characteristics:**

- One blue accent for primary actions and selected states.
- Soft neutral grounds with thin surface borders.
- Shared UI primitives, compact working controls, and spacious public sections.
- Brief state motion with reduced-motion support.

## Colors

The palette pairs clear blue with cool, quiet neutrals. Frontmatter values describe the light theme; explicitly suffixed dark tokens capture the theme overrides in app/globals.css. In source, use semantic CSS variables rather than choosing theme literals.

### Primary

- **Workspace Blue** (`main`): primary buttons, active navigation, useful icons, and selected emphasis. Its lighter dark-theme counterpart keeps the same action role.
- **Action Ink** (`main-foreground`): white in light mode and deep ink in dark mode, maintaining contrast on blue controls.
- **Focus Blue** (`ring`): visible keyboard rings; dark mode uses its separately defined focus blue.

### Neutral

- **Soft Ground** (`background`): page background and quiet nested surfaces.
- **Workspace Surface** (`secondary-background`): cards, fields, header, sidebar, and dock; white in light mode and charcoal in dark mode.
- **Reading Ink** (`foreground`): text and neutral icons. Supporting copy uses controlled opacity on this role.
- **Quiet Edge** (`border`): thin container borders and separators.
- **Selected Tab Surface** (`tab-active`): persistent filled-tab selection, with a distinct darker surface in dark mode.
- **Field Hint** (`placeholder`): placeholder text on fields.
- **Modal Veil** (`overlay`): translucent separation behind dialogs and drawers.

**The Action Accent Rule.** Reserve the blue accent for primary actions, selection, focus, and useful status or icon emphasis; optional actions use neutral surfaces.

## Typography

**Display Font:** Geist with a sans-serif fallback.
**Body Font:** Geist with a sans-serif fallback.

Geist supplies both expressive headlines and compact controls. Headings use semibold rather than a second display family. Geist Mono is loaded in the root layout, but no recurring mono role was established in the sampled surfaces.

### Hierarchy

- **Display:** the landing headline starts at the frontmatter size, reaches 60px at the small breakpoint and 72px at the desktop breakpoint, with tight tracking and a short line height. Pricing uses its own 36px-to-60px headline expression.
- **Headline:** public section headings use the recorded starting size and grow to 36px at the small breakpoint. FAQ headings start at 24px and grow to 30px.
- **Title:** compact headings and card labels; the hierarchy also uses 20px and 24px where the content needs stronger prominence.
- **Body:** recurring descriptions are 14px with generous leading; public lead paragraphs rise to 18px. Description text uses foreground at 75% opacity; FAQ answers use 70% and a maximum measure of 70ch.
- **Label:** ordinary button text is regular; tab labels use medium (500) and app navigation uses semibold (600).
- **Caption:** hints, metadata, and compact mobile labels use the smaller recorded role.

## Layout

A four-pixel spacing rhythm supports compact controls and more generous containers. Standard cards use the 24px step; compact cards use 16px. Public and workspace shells cap the content area at 72rem. Public main content uses 20px horizontal and 48px vertical padding initially, then 32px and 80px at 640px. Public sections commonly separate by 64–96px, growing to 96–128px where the surface calls for more breathing room.

The application switches to a 224px sidebar at 1024px, with content in a minmax(0, 1fr) column. Workspace padding is 16px horizontally and 24px vertically, growing to 32px horizontally at 640px, then 40px on desktop. Below 1024px, Home, Jobs, Discover, and Resume occupy a fixed four-destination bottom dock. The dock includes safe-area padding and the workspace reserves 110px plus the safe-area inset below its content. Settings and theme controls remain in the top header.

**The Contained Navigation Rule.** Keep tab overflow within the tab list and reserve content clearance for the mobile dock.

## Elevation & Depth

Depth combines subtle ambient shadows, thin borders, and tonal layering. The shared surface shadow is `0 2px 6px -2px rgb(24 34 48 / .08), 0 12px 28px -18px rgb(24 34 48 / .12)`. Primary buttons and cards use it. Nested cards drop their border and shadow and use the page ground. Fields use an inset `0 1px 2px rgb(0 0 0 / .025)` shadow. The mobile dock uses `0 -4px 24px rgb(0 0 0 / .04)` to separate it from scrolling content. Tabs use a small state shadow. The larger landing-preview shadow is a local composition treatment, not an additional general-purpose elevation token.

**The Shared Surface Rule.** Use the shared UI primitives and semantic theme variables for recurring controls and containers.

## Shapes

Controls, navigation selection, and cards share softly rounded base corners. Tabs use the smaller tab radius; badges use the tighter badge radius. Borders are thin (1px) and low contrast. Identity comes from the J-shaped hook and outward arrow rather than ornamental container geometry. Small SVG icons accompany labels and statuses.

## Components

### Buttons

Primary controls are quiet but easy to locate: blue fill, contrasting action text, base corners, and ambient depth. Ordinary controls are 40px tall; small and large sizes are 36px and 44px. Neutral controls use surface fill and a thin edge. Primary hover lowers the fill to 90% opacity; neutral hover adopts the page ground. Keyboard focus uses a 2px ring with a 2px offset. Disabled controls reduce opacity to 50% and stop pointer interaction. Pressed buttons translate down 1px. Destructive actions use the existing red variant; this is an error/action semantic, not a second decorative palette.

### Chips

Badges are compact sentence-case metadata with a thin edge, tight corners, and small text. Neutral and ground fills are available. The product preview demonstrates restrained blue status emphasis; it does not introduce a general multi-color chip palette.

### Cards / Containers

Cards use the workspace surface, base corners, quiet borders, and shared ambient depth. Header, content, and footer align to the same internal spacing. Description leading and wrapping are shared globally. Nested cards, resume review entries, and upload introductions use the page ground without an additional shadow or enclosing border.

### Inputs / Fields

Inputs are full-width, 40px tall, with base corners, thin borders, surface fill, and hint-colored placeholders. Hover strengthens the border using a 25% foreground mix. Keyboard focus adds the blue 2px ring and offset. Disabled fields use 50% opacity and a disabled cursor. Long content can wrap in related select controls, and field/container minimum widths are cleared to avoid overflow.

### Navigation

Desktop destinations pair small SVG icons and 14px semibold labels; the mobile dock places 12px labels below icons. Selected destinations use blue text over a 10% blue surface. One mounted indicator measures the current destination and translates to it over 220ms with cubic-bezier(0.22, 1, 0.36, 1); width and height update immediately. Reduced motion removes that transition. Route content enters with a brief 150ms fade and 4px vertical movement, disabled for reduced motion.

### Tabs

Tabs use a quiet 5% foreground track with base corners, medium-weight labels, and a filled smaller-radius selected surface. The line variant retains a lower separator and a 10% blue selection surface. Labels stay intact while the list scrolls horizontally within its own boundary. Selection translates over 180ms; the panel fades from 75% to full opacity over 160ms. Base UI supplies keyboard behavior and state semantics.

### Accordion

FAQs use thin row separators, medium labels, a small SVG chevron, and restrained blue hover text. A 2px focus ring stays visible for keyboard users. The chevron rotates on expansion; content animates its height over 180ms and remains constrained to readable line lengths. The shared reduced-motion stylesheet shortens CSS animation and transition durations.

## Do's and Don'ts

### Do:

- **Do** use components from components/ui and preserve their focus and keyboard behavior.
- **Do** keep light and dark semantic roles together when introducing a recurring surface.
- **Do** use the shared spacing rhythm and allow long content to wrap.
- **Do** retain reduced-motion behavior and mobile safe-area clearance.

### Don't:

- **Don't** introduce an additional decorative accent palette into the main product surfaces.
- **Don't** replace ambient depth with hard offset shadows.
- **Don't** use decorative uppercase kickers, glyph icons, or system display faces as new house styles.
- **Don't** animate indicator dimensions; measure dimensions immediately and animate position with transforms.

Not canonized: the legacy offset-shadow spacing variables, unused chart palette, and marquee definitions in the stylesheet do not establish a recurring rule in the shipped surfaces. The landing preview's unique shadow is also excluded from the reusable elevation vocabulary.

Evidence: app/globals.css; app/layout.tsx; components/ui/button.tsx, input.tsx, card.tsx, badge.tsx, tabs.tsx, app-shell.tsx, public-shell.tsx, accordion.tsx, product-preview.tsx; app/page.tsx; app/pricing/page.tsx. The redesign was code-led under the pinned restrained-blue direction (seed cd6257cd, index 3), with no approved raster comp.
