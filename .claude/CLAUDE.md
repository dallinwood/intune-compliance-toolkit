# CLAUDE.md

Instructions for Claude Code when working in this repository.

## Keep plan documents' progress logs current

Plan documents under `docs/plans/` (e.g. `docs/plans/2026-08-17-web-ui-mvp-plan.md`)
are living documents, not one-shot specs. Whenever you complete work toward
a plan - a milestone, a bug fix, a design change made mid-implementation -
add an entry to that plan's `## Progress log` section (create the section
at the end of the file if it doesn't exist yet) recording:

- The date
- What was done, in one or two sentences
- Which commit(s) it landed in (short hash + subject line)

Do this in every session that touches the work a plan describes, not only
when explicitly asked, and not only in the session that wrote the plan.
Add the log entry in the same commit as the work it describes when
practical; a small follow-up docs commit is fine when the work spans
several commits.

## Commit and push after finishing a change, without being asked

This repo's history commits every completed milestone, bug fix, or
requested round of changes as its own commit, then pushes it. Keep doing
that by default - don't wait for an explicit "commit this" each time:

- Once a coherent unit of work is complete and verified (tests pass,
  typecheck/lint clean where applicable), create a commit for it.
- Match the existing message style: a `type: summary` subject line
  (`feat:`, `fix:`, `docs:`, ...), a body explaining *why* when it isn't
  obvious from the diff. Do not add a `Co-Authored-By` trailer or any
  other AI attribution line to commits or PR descriptions.
- Push the commit to the current branch's tracked remote right after
  committing.
- Keep each commit scoped to one coherent change - don't bundle unrelated
  fixes together, and don't commit before the change is verified.
- If the current branch is `main`, confirm with the user before pushing
  instead of doing it automatically - everything else in this section still
  applies without asking.
- This does not cover destructive or history-rewriting operations
  (force-push, rebase, amend, `reset --hard`) - those still require asking
  first, per standard git safety practice.

## Run Playwright after any visual change to the web UI

`webui/`'s Vitest suite covers `logic/*` (pure functions) - it does not
render anything, so it cannot catch a layout that looks wrong. Whenever a
change touches `webui/` in a way that affects rendering or layout
(component markup, Tailwind classes, responsive breakpoints, new UI
states), verify it with Playwright before calling the change done, not
just Vitest/typecheck/lint:

- Run the e2e suite: `bun run test:e2e` (see the plan's "Package
  manager/runtime" for why this one script needs real Node, not Bun).
- For anything visual/layout/responsive specifically, also take an ad hoc
  screenshot (or a few, at representative viewport widths, e.g. a narrow
  ~375px width and a normal desktop width) via a short Playwright script
  and actually look at it with the Read tool before claiming the change
  works. A passing DOM assertion is not the same as a readable layout -
  the Milestone 5 "responsive" table fix passed every test that existed
  at the time while actually squeezing the title column into unreadable
  single-word wrapping; only looking at a real screenshot caught it.
- This supplements manual-in-browser verification and the existing e2e
  spec, it doesn't replace either.

## The coordinating session owns the dev server

The web UI dev server takes several minutes to start (copying baselines),
so it must not be started and stopped once per subagent:

- When work will need the running app (e2e, screenshots) across more than
  one step or subagent, the coordinating (main) session starts one dev
  server itself, in the background, from `webui/`:
  `bun run dev -- --port 5199 --strictPort`. It waits for
  `http://localhost:5199/` to answer 200 before dispatching work that
  needs it.
- Subagents never start or stop a dev server. Their dispatch prompt tells
  them the server is shared on port 5199, to use
  `PLAYWRIGHT_BASE_URL=http://localhost:5199`, to wait for it to answer if
  it is still starting, and to leave it running when they finish.
- If the server dies (crash, reboot, closed terminal), the coordinating
  session restarts it and tells any running subagent to wait for the new
  instance rather than starting its own.
- The coordinating session stops the server only when all pending work
  that needs it is finished.
- This holds for every dev server, including a second one for a separate
  git worktree (on another port). If a task genuinely needs to start the
  server itself (e.g. it is measuring startup time), say so to the user
  before dispatching it.
