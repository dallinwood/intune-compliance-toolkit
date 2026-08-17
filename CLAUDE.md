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
