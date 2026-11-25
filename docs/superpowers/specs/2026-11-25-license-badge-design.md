# License badge on framework cards - design

## Intent

Show each framework's license on its card in the frameworks pane, next to
the "Source:" line, so a reader can see at a glance the terms the upstream
source is published under. Putting it on the source line, not next to the
title, makes it clear the license belongs to the source, not to the
framework entry or this app. It should look visibly different from the
Official/Community badge, with a bit of colour.

## Goals

- A license badge on every framework card whose manifest entry has a
  `license`, showing `license.name` (for example "CC BY 4.0", "MIT").
- One shared colour for every license.
- The badge links to `license.url` in a new tab.

## Non-goals

- A different colour per license or license family. Colour coding would
  imply a legal judgment the UI shouldn't make, and every current license
  is permissive anyway.
- Changing the Official/Community badge, or the "Source:" link's text or
  target.

## Approaches

- **A - Blue tinted pill with scale icon:** matches the shadcn badge shape,
  with a tinted colour.
- **B - Violet tinted pill:** the same as A, but further from the app's teal
  primary colour.
- **C - shields.io split badge (picked):** a grey "license" segment with a
  scale icon, then a blue segment holding the license name, with
  small-radius corners. The user picked this one from the mockup because
  they liked how it looks, and because people recognise the README
  convention.

We won't use the shields.io service or a package. Their badges are SVGs
fetched from a remote server, which would add a network dependency for
something two styled spans can do. No npm package does colour-per-license
either, and we don't want that anyway.

## Design

- New component `webui/src/components/frameworks/LicenseBadge.tsx`,
  rendered inside `SourceLine`, right after the "Source: <rights holder>"
  link. `SourceLine` becomes a wrapping flex row (`flex flex-wrap
  items-center gap-x-2 gap-y-1`) so the 20px badge lines up with the
  12px text. `SourceLine`'s existing guard (rights holder and repository
  URL both present) is kept. Every current manifest source has a license,
  a rights holder, and a repository URL, so every card shows the badge.
- The title row and `ProvenanceBadge` stay as they are.
- Markup: an `<a href={license.url} target="_blank" rel="noreferrer">`
  wrapping two spans:
  - key segment: lucide `Scale` icon (aria-hidden) plus the text "license",
    neutral zinc background, white text
  - value segment: `license.name`, blue background, white text
- Size: 20px tall to match the existing badge height, `text-[11px]`,
  `rounded` (4px), `whitespace-nowrap`.
- Colours: light theme zinc-600 key and blue-600 value. Dark theme
  zinc-700 key and blue-700 value, so it isn't glaring on the dark panel.
- Accessible name: "License: CC BY 4.0 (opens in a new tab)".
- Visible focus ring consistent with the other links.

## Left to the builder

- The exact Tailwind tokens, if the theme already defines matching ones.
- Check the longest name, "CC0 1.0 (public domain)", at a ~375px viewport
  in a Playwright screenshot. Because the source line wraps, the badge
  should drop below the "Source:" text rather than overflow.

## Progress log

- 2026-11-25: Built `LicenseBadge` and rendered it in `SourceLine`, so it shows on the framework cards and the framework page header. The longer source line pushed the cards' Rules/Coverage links out of the title row, so the title column now has a 16rem flex basis and the source line wraps the badge onto its own line instead.
