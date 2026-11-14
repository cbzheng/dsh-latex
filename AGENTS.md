# LaTeX Studio

Independent DSH plugin, independently installed and released. Never add this
application to the Next Space repository, core bundle or builtin catalog.
Read README.md, docs/architecture.md and docs/private/operations.md before changes.
Public docs (README, docs/*.md) must not mention Next Space until it is released. Use the frontend-design
and storage-management skills. Preserve ordinary project folders as authority.

Host code lives in src/, browser code in web/, tooling in scripts/. DSH and Next
Space are optional peers provided by the host, never vendored or patched.
Background AI (the latex_studio Agent tool) may only create revision-checked
proposals; only a user's accept action applies them. Next Space In-place AI,
started by the user on the open editor, may write directly within its declared
actions: buffer edits are one undoable step saved with the normal revision check
(a refused save rolls the AI text back); other-file edits and created files are
revision-checked and undoable. Never silently overwrite an external edit or dirty editor.
No credentials, paper contents, private paths, runtime archives or QA screenshots
belong in Git. Tests use synthetic projects. Record development, verification
and release readback in docs/private/operations.md (gitignored; this repository
is public, so deployment logs and host details stay out of Git; a copy is kept
on the host's backup disk). npm test runs portable backend tests;
npm run build builds the standalone installable package. macOS acceptance is
separate from Linux validation. Use the official DSH plugin manager to install.
