---
name: AgentHQ — Quiet workspace
description: A calm mission workspace for readable decisions and scoped team work.
colors:
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  border: "oklch(0.922 0 0)"
  sidebar-surface: "color-mix(in oklch, oklch(0.97 0 0) 75%, oklch(1 0 0))"
  destructive: "oklch(0.577 0.245 27.325)"
typography:
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-1px"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.4px"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  numeric:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  control: "6px"
  announcement: "7px"
spacing:
  xs: "7px"
  sm: "12px"
  md: "20px"
  lg: "30px"
  mobile-gutter: "18px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "36px"
  button-ghost:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "36px"
  input:
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
    height: "45px"
  mission-nav-active:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  detail:
    backgroundColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "20px"
---

# Design System: AgentHQ

## Overview

**Creative North Star: "Quiet workspace"**

AgentHQ feels like a clear shared workbench: restrained, readable and spacious. A subtly toned mission rail supports one bright working page. Typography, alignment and hairline separators organize the work; decoration stays secondary to decisions.

The user approved option 01 on 2026-11-21 as the replacement visual direction. This is an original AgentHQ identity, with a monochrome SVG mark expressing coordinated scoped work. It does not imitate Apple or the earlier generic dashboard.

**Key Characteristics:**

- A neutral light canvas, graphite controls and a quiet sidebar.
- Flat rows, generous spacing and details revealed on demand.
- Geist Sans for reading; Geist Mono with tabular figures for operational numbers.
- Explicit action labels, visible focus and readable status words.

### Decided

- Base: shadcn/ui components and semantic Tailwind/CSS tokens. No inline hex colors in application code.
- Typography: Geist Sans for UI; Geist Mono and tabular figures for numeric figures, timestamps, percentages and code. This explicit user-approved pair replaces the original one-font-family rule.
- Mobile first; the mission workspace must work at 375px wide.
- Every async action shows a loading state; empty states provide concise context and an action.
- Keep the approved light Quiet workspace: flat, largely borderless surfaces, hairline dividers, generous spacing and no heavy shadows.
- Keep a strict neutral palette with at most one desaturated decorative accent. Current production uses graphite as its primary emphasis; failure red is semantic feedback.
- For the mission page, Attention is the default. Its initial two decisions stay separate from the three drafts awaiting approval. Tasks, Team and Activity are alternate tabs; coordination is a compact disclosure.
- Task evidence appears inline on demand. The selected mission page replaces the earlier dense board and permanent inspector direction.
- Preserve the AgentHQ name and native monochrome AgentHQMark SVG.

## Colors

The palette is achromatic paper and graphite. Its gentle rail tone comes from a mix of the existing muted and background tokens; it is not a separate warm color added to the global theme.

### Primary

- **Graphite:** primary actions and the brand mark. It creates emphasis without adding another hue.
- **Soft White:** text on graphite actions.

### Neutral

- **Paper:** the working canvas, form surfaces and transient announcements.
- **Ink:** headings, selected navigation and important action text.
- **Soft Chalk:** selected mission rows and expanded detail backgrounds; shared by the existing muted and secondary roles.
- **Quiet Grey:** explanatory copy, metadata and inactive navigation.
- **Hairline Grey:** row separators, field boundaries and the sidebar divider.
- **Rail Mist:** the slightly toned mission rail.

### Semantic feedback

- **Failure Red:** actual failed checks, blocked worker emphasis and validation errors. Status is also written in text; color never carries the state alone.

**The Neutral First Rule.** Use semantic tokens from the incumbent stylesheet. Do not add decorative status palettes, gradients or colored panels to this workspace.

## Typography

**UI Font:** Geist Sans, loaded by next/font/google as --font-geist-sans.

**Numeric / Code Font:** Geist Mono, loaded as --font-geist-mono.

The UI is direct and quiet. Sentence case labels, medium-weight row titles and darker headings supply hierarchy without uppercase labels or large display decoration. The numeric role uses font-variant-numeric: tabular-nums.

### Hierarchy

- **Headline:** mission title; reduces to (29px) below the intermediate breakpoint and (27px) on mobile.
- **Title:** section heading; reduces to (19px) on mobile. Task-group headings use (17px).
- **Row title:** attention items use (16px, 500), reducing to (15px) on mobile.
- **Body:** workspace default; mission goal has a more open line height (1.65) and a maximum measure (68ch).
- **Label:** controls and compact metadata. Secondary notes range from (12px) to (14px).
- **Numeric:** tab counts, relative timestamps, queue order and workload points. File paths and SHA evidence also use the monospace family.

**The Two Roles Rule.** Geist Mono identifies operational values; it is not a second headline or body style.

## Layout

The desktop workspace is a two-column grid: a sticky mission rail (240px) and one flexible main area. The rail fills the viewport height. The main page is centered at a maximum width (920px), with desktop padding (65px 64px 72px). A creator form narrows the readable region to (680px).

At viewport widths up to (1000px), the rail becomes (205px) and main padding becomes (48px 34px 65px). At widths up to (700px), the rail becomes a compact top bar with a Missions toggle; its navigation expands below the brand. Main padding becomes (29px 18px 60px). Tabs remain in one readable row, attention actions move below their copy, evidence becomes one column and activity timestamps move below their event text.

The mission page presents decisions first, then draft approval. Divided rows replace card grids. Tasks, workers and activity use the same aligned reading model; selected evidence expands in the content flow. Workload balance and coordination stay behind disclosures. Keep this composition specific to the mission workspace rather than imposing it on unrelated screens.

## Elevation & Depth

Resting content is flat. A subtle tonal shift separates the rail and inline details from the canvas, and hairlines divide related rows. The only custom production shadow is the transient action announcement (0 8px 28px with foreground mixed to 8% opacity). It distinguishes feedback from the page without creating a floating dashboard aesthetic.

**The Flat Surface Rule.** Do not add resting card shadows or elevated panels. Focus is an accessibility cue, not ambient depth.

Motion stays functional: built-in control state transitions, a rotating disclosure chevron and loading indicators. Loading spinners and skeletons honor reduced motion. Expanding evidence scrolls into view without animated travel.

## Shapes

Controls and expanded details have gently curved corners. Navigation uses the same modest curve. Full-width tab lines and content rows remain square and open; broad pill badges are not part of the production visual vocabulary.

The AgentHQ mark uses a (24 × 24) SVG view box: one left-hand work unit connects through a central spine to two right-hand units. It renders in currentColor, with rounded stroke ends and joins. Its base stroke is (1.7); the workspace normalizes SVG strokes to (1.6) and displays the brand mark at (25 × 25px).

## Components

### Buttons

Restrained controls with clear verbs. Primary buttons use graphite and soft white; outline actions use a paper fill and a hairline border; ghost actions rest directly on the surface. Hover uses the existing primary-opacity or muted-surface variants. Disabled controls reduce opacity and stop interaction.

Workspace controls grow to (44px) high on mobile; compact detail-close controls remain (36px). Workspace buttons, links and summaries receive a foreground focus outline (2px) with an offset (4px), alongside applicable component focus rings. Async primary actions show a spinner and changed wording.

### Inputs / Fields

Visible labels sit above single-line inputs and the goal textarea. Input boundaries use the input token; fields use restrained corners. The textarea has a minimum height (140px), padding (11px 12px), and vertical resizing. Mobile field text is (16px). Validation appears as a readable error message with the destructive semantic color.

### Navigation

Mission navigation uses quiet text and a small file icon. The selected mission gains a muted background and stronger text weight. Mission view tabs use a hairline baseline, active underline and semibold selected label; numeric counts remain subdued. Preserve the underlying accessible tab semantics and keyboard behavior.

### Rows / Containers

Attention, task, worker and event containers are open rows with a bottom divider. Reserve filled containers for evidence revealed by the user. Inline evidence has a muted background and breaks long scopes and SHA values so the page stays within its viewport. Worker and draft disclosures expose detail without a permanent inspector.

### Feedback

Status words remain legible without color. Failures receive semantic red; other states are quiet text. The action announcement is a compact fixed surface near the bottom of the working page with a live region. The current workspace explicitly identifies mock planning, approvals, queue changes, workers and review evidence; visual polish must not imply live execution.

## Do's and Don'ts

### Do

- **Do** preserve the semantic shadcn tokens and light Quiet workspace.
- **Do** use hairlines, alignment and spacing before adding containers.
- **Do** keep numeric figures and timestamps in Geist Mono with tabular figures.
- **Do** expose action consequences and evidence when the user needs them.
- **Do** keep loading, empty, validation, disabled and keyboard-focus states readable at 375px.
- **Do** distinguish local mock behavior from live planning, dispatch or review.

### Don't

- **Don't** bring back the generic dashboard identity or an Apple imitation.
- **Don't** reintroduce a dense card grid or permanent inspector into the approved mission page.
- **Don't** add heavy shadows, gradient decoration or competing accent colors.
- **Don't** use color alone to identify task or worker state.
- **Don't** make a Gemini review appear to replace checks or human merge.

### Exploring

- Five sparse network/map explorations inspired by the user's ControlAI and Shopify references remain unselected: Orbit, Relay, Constellation, Branches and Focus. They have not replaced option 01 or its production rules.
- The runnable React preview is at /lab/network, implemented in src/app/(dashboard)/lab/network/page.tsx, src/components/agent-network-dashboard.tsx and src/components/agent-network-dashboard.module.css. It opens on Agents and supports worker/server selection, sections, local mock planning and approval, and zoom.
- The standalone HTML reference gallery at .impeccable/mocks/decision/network-options.html and network-01.html through network-05.html is separate from the runnable React preview.
- Prototype typography and radius differences remain advisory findings against Quiet workspace. Variant tokens are not approved system tokens; retain the canonical Quiet frontmatter and component previews.

### Rejected

- The earlier generic dashboard visual world.
- Apple imitation.
- The earlier dense mission board and permanent inspector composition for this mission page.
