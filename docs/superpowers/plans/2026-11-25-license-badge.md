# License Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a shields.io-style split licence badge after the "Source:" link on each framework's source line.

**Architecture:** A new presentational `LicenseBadge` component renders a link with two spans (a grey key segment and a blue value segment). `SourceLine` renders it after the rights-holder link and becomes a wrapping flex row. `SourceLine` is used on both the framework cards and the framework page header, so both get the badge.

**Tech Stack:** React + TypeScript, Tailwind v4 (dark mode via the `.dark` class), lucide-react `Scale` icon, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-25-license-badge-design.md`

## Global Constraints

- One colour for every licence. No per-licence or per-family colouring.
- No new dependency, and no request to the shields.io service.
- Visible copy is spelled "licence", matching the rest of the app (Sources & licences dialog, footer). The manifest field stays `license`.
- Light: key `bg-zinc-600`, value `bg-blue-600`. Dark: key `bg-zinc-700`, value `bg-blue-700`. White text in both segments.
- Badge is 20px tall (`h-5`), `text-[11px]`, `rounded` (4px), `whitespace-nowrap`.
- The link opens `license.url` in a new tab (`target="_blank" rel="noreferrer"`), with accessible name `Licence: <name> (opens in a new tab)`.
- No em dash characters in code or copy.

## Review Focus

- The longest name, "CC0 1.0 (public domain)" (if present), at 375px: the badge should drop below "Source: ..." rather than overflow the card. Covered by the Task 1 screenshot step.
- Dark mode contrast: the blue value segment should stay readable but not glare on the dark panel. Covered by the Task 1 dark screenshot step.
- Keyboard focus: tabbing onto the badge shows a visible focus ring. Covered by the Task 1 e2e assertion on `focus-visible` styling via a screenshot of the focused state.
- A source without a licence: `SourceLine` keeps rendering "Source: ..." without a badge, and nothing crashes. No current manifest source triggers this, so the component guards on `source.license` and the code review checks it.

---

### Task 1: LicenseBadge on the source line

**Files:**
- Create: `webui/src/components/frameworks/LicenseBadge.tsx`
- Modify: `webui/src/components/frameworks/SourceLine.tsx`
- Test: `webui/e2e/license-badge.spec.ts` (new)
- Modify: `docs/superpowers/specs/2026-11-25-license-badge-design.md` (add a `## Progress log` entry, per `.claude/CLAUDE.md`)

**Interfaces:**
- Produces: `export function LicenseBadge({ license }: { license: License }): JSX.Element` (`License` from `webui/src/types/library.ts`).

- [ ] **Step 1: Write the failing e2e spec `webui/e2e/license-badge.spec.ts`**

Read the manifest the way `e2e/frameworks.spec.ts` does. Tests:

```ts
test('every framework card shows its source licence as a link beside the source', async ({ page }) => {
  await page.goto('/frameworks')
  for (const source of manifest.sources) {
    const card = page.getByTestId('framework-card').filter({ has: page.getByRole('heading', { name: source.display_name, exact: true }) })
    const badge = card.getByRole('link', { name: `Licence: ${source.license.name} (opens in a new tab)` })
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('href', source.license.url)
    await expect(badge).toHaveAttribute('target', '_blank')
    await expect(badge).toContainText('licence')
    await expect(badge).toContainText(source.license.name)
    // On the source line, not in the title row.
    await expect(card.getByText(/^Source:/).locator('..').getByRole('link', { name: /^Licence:/ })).toHaveCount(1)
  }
})

test('a framework page header shows the licence badge', async ({ page }) => {
  await page.goto('/frameworks?framework=nist_800_53&tab=rules')
  const nist = manifest.sources.find((source) => source.name === 'nist_800_53')!
  await expect(page.getByRole('link', { name: `Licence: ${nist.license.name} (opens in a new tab)` })).toBeVisible()
})
```

Adjust the "on the source line" locator to whatever wraps the "Source:" text once `SourceLine` is a flex row. The point is that the badge shares the source line's container, not the `h2` row.

- [ ] **Step 2: Run it to verify it fails**

The dev server is shared on port 5199 (started by the coordinating session; wait for it to answer 200, never start or stop it).
Run from `webui/`: `PLAYWRIGHT_BASE_URL=http://localhost:5199 bun run test:e2e -- e2e/license-badge.spec.ts`
Expected: FAIL, no link named `Licence: ...`.

- [ ] **Step 3: Implement `LicenseBadge` in `webui/src/components/frameworks/LicenseBadge.tsx`**

An `<a>` (`inline-flex h-5 overflow-hidden rounded text-[11px] font-medium leading-5 whitespace-nowrap`, plus a focus-visible ring using the theme's `focus-ring` token like `badge.tsx`) containing:
- key span: `<Scale aria-hidden="true" />` (size 11px) and the text `licence`, `bg-zinc-600 dark:bg-zinc-700 text-white px-1.5 gap-1 inline-flex items-center`
- value span: `license.name`, `bg-blue-600 dark:bg-blue-700 text-white px-1.5`

`aria-label` = `Licence: ${license.name} (opens in a new tab)`.

- [ ] **Step 4: Render it in `SourceLine`**

Change the `<p>` to `flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground`, wrap "Source: <ExternalLink>" in a `<span>` so it stays together, and append `{source.license && <LicenseBadge license={source.license} />}`. Keep the existing early-return guard unchanged.

- [ ] **Step 5: Run the spec to verify it passes**

Run: `PLAYWRIGHT_BASE_URL=http://localhost:5199 bun run test:e2e -- e2e/license-badge.spec.ts e2e/provenance.spec.ts e2e/frameworks.spec.ts`
Expected: all PASS (`provenance` and `frameworks` cover the neighbouring title row and card layout).

- [ ] **Step 6: Typecheck, lint, unit tests**

Run from `webui/`: `bun run typecheck`, `bun run lint`, `bun run test` (use the actual script names in `package.json`).
Expected: clean, all pass.

- [ ] **Step 7: Screenshots and look at them**

With a short ad hoc Playwright script against port 5199, capture `/frameworks` and `/frameworks?framework=asd_ism&tab=rules`:
- 375px wide and 1280px wide, light (`colorScheme: 'light'`)
- 1280px wide, dark (`colorScheme: 'dark'`)
- one close-up with the badge keyboard-focused (Tab to it)

Save under the session scratchpad, open each with the Read tool, and confirm: the badge sits after "Source: ..." on the same line at desktop width and wraps cleanly below it at 375px; the segments read as one badge; dark mode is readable; the focus ring is visible.

- [ ] **Step 8: Progress log and commit**

Add a `## Progress log` section to the spec with today's date and a one-line summary, then:

```bash
git add webui/src/components/frameworks/LicenseBadge.tsx webui/src/components/frameworks/SourceLine.tsx webui/e2e/license-badge.spec.ts docs/superpowers/specs/2026-11-25-license-badge-design.md
git commit -m "feat: show a shields-style licence badge on the source line"
git push
```

Then add the commit hash to the log in a small follow-up `docs:` commit and push.
