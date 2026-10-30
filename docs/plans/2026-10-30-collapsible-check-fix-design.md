# Design: checks and fixes as buttons that expand

Date: 2026-10-30
Status: Implemented 2026-10-30

## Intent

A rule's details showed every check script and every remediation script or payload expanded.
A rule with a Bash script and a DDM declaration, or with per-version checks, ran to several
screens of code before the reader reached what they wanted. The Check and Remediation sections
now show a row of buttons and open one item at a time, so the details stay short and each
script is one click away.

## Behaviour

Both sections:

- One button per item, in a `flex flex-wrap` row with a small gap. The buttons use the app's
  small outline pill style (`buttonVariants`, variant `outline`, size `xs`); the open one is
  marked by the outline variant's `aria-expanded` fill plus a stronger border.
- Each button is a native `<button>` that toggles a disclosure: `aria-expanded`, `aria-controls`
  pointing at the content region, and a visible focus ring.
- Only one item is open at a time. Clicking a closed button opens it and closes any other;
  clicking the open one closes it.
- A section with exactly one button starts with it open. A section with several starts closed.
- The open state is local to the section and is lost when the details close.
- DOM ids come from `useId()`, never from rule ids, because the same rule can be on screen
  twice (the main table and the nested details in the "Mapped rules" tab).

Check section:

- The warnings above the buttons are unchanged: "No macOS version listed", "Applies to ... Macs
  only" and "No automated check ...".
- One button per platform in `rule.check`, labelled with the platform icon and the script
  language (for example the Apple icon and "Bash").
- When the open platform has per-version checks, a second, smaller row sits at the top of its
  content: "Default" first, then one button per version, newest first, labelled with the version
  term. "Default" is selected at first and selecting another swaps the content below. A platform
  with no per-version checks shows no second row and keeps the "Check (all listed versions)"
  wording.
- The content is unchanged: the script with copy and organisation-defined value substitution,
  the expected result and the additional info.

Remediation section:

- One button per fix item: each step and each payload of each platform, in the order platform,
  then steps, then payloads, newest versions first. Items are not grouped into a version row.
- Each button is the platform icon and the item type: "Bash script" (language and "script"),
  "Configuration profile", "DDM declaration", or the raw payload kind for any other. An item that
  does not cover every version adds its scope, for example "Configuration profile · macOS 15".
  The label comes from `remediationItemButtonLabel` in `webui/src/logic/targetDisplay.ts`.
- The content is unchanged: `StepEntry`, `PayloadFile` and `JsonEntry`.

The content region keeps `data-testid="check-target"` or `"remediation-target"`; it exists only
while its item is open.

## Left to the builder

- The shared button row and the version row live in
  `webui/src/components/rules/DisclosureButtons.tsx`.
- The version row uses `aria-pressed` buttons in a labelled group ("Check versions"), because
  exactly one is always selected, which makes it a selection rather than a disclosure.
- When a platform has per-version checks but no default check, "Default" shows the existing "No
  default check" message.
- `TargetHeading` and `targetHeading` are no longer used by the sections and were left in place.

## Progress log

- 2026-10-30: Built the buttons for both sections, the label function and the e2e tests - `feat: show checks and fixes as buttons that expand`
