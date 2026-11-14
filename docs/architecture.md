# Architecture

## Independent installation

`@cbzheng/dsh-latex` is the single DSH installation unit. It has its own Host row,
browser module, version and release. The DSH `main` / `sidebar.panellist` slots
provide the entry. Optional host services (`nextSpace` / `spaceData`, used by an
unreleased workspace host) can register the same view as a window; when absent
they are skipped. View navigation is per instance; registered project folders,
compiler and Git state are shared by every view.

## Data and writes

An ordinary folder is authoritative. A private registry remembers folder IDs,
main file and engine. UI buffers save with SHA-256 base revisions, atomic rename,
per-project serialization and readback. Externally changed files reject writes.
Unsent browser drafts survive reload in sessionStorage and block navigation when
unsaved. Saving never starts a build: a per-view timer (project
`compileInterval`, default 5 minutes, 0 disables) builds only when sources changed
since the last build. AI tools persist proposed file replacements with their base revision;
the user can preview, accept or reject. Acceptance rechecks the revision. The
plugin does not impose changes macros on ordinary Git projects.

## Compilation

TinyTeX 2026.11 archives and hashes are pinned in src/runtime.mjs. Runtime files,
downloads, dependency metadata, proposals and build output are private plugin
state outside paper directories and npm archives. The runtime is installed by
the Host, using absolute binary paths and a child-only PATH. A single runtime
queue prevents tlmgr writes during builds. The package resolver searches CTAN
for missing files and retries a bounded number of times; offline mode disables
all preparation/downloads. Missing external tools and custom fonts remain clear
build errors, with the previous good PDF retained.

Each asynchronous job snapshots source files, records their digest and runs
latexmk in that snapshot with an external output directory. Project latexmkrc
execution and shell escape are disabled. Shell-dependent documents require an
explicit future feature. Polling returns queued/running/success/error and logs;
each project retains its last good PDF across restart. A changed source can
queue the next build. Forward/inverse SyncTeX uses the matching job snapshot.

The job also exposes preparation progress: download bytes/total when available,
verification, extraction, live package installation and compilation attempts.
The main document and engine are explicit project settings; opening a different
source file does not change the build entry. Discovery prioritizes real document
roots and TeX root directives over template examples.

## Git and authentication

Git runs against the real folder with argv arrays, bounded output and no terminal
prompt. Existing SSH/credential-helper configuration stays on the host. There is
no token input, credential database or forced push. Commit operates on explicitly
selected paths, preserving unrelated staged changes. Pull requires a clean tree
and fast-forward; dirty/divergent trees remain available for Agent assistance.
GitHub HTTPS/SSH and branch URLs can be imported into a selected local folder.
The host's existing Git credentials are reused, with GitHub CLI authentication as
a fallback. A missing origin can be connected explicitly; an existing different
origin is never overwritten. No credentials are included in project metadata.

Clone jobs start without holding an HTTP request open. Git runs with --progress,
reported as bounded redacted logs and stage/object percentages. Activity resets
an inactivity deadline, with a separate one-hour budget. Cancellation terminates
the process group, including helper children. Destinations are exclusively created
and never recursively removed on failure; pre-existing folders are refused. Browser
reload can reattach, while Host restart requires inspection of a preserved folder.

## Outline and PDF rendering

The read-only outline scanner follows the configured main's input/include graph,
retains file/line locations, masks comments/literal environments and ignores macro
definitions. Visible TeX source overrides support live drafts without writing.
Paths, recursion, repeated visits, input bytes and result size are bounded. This is
a structural navigator, not a full TeX macro interpreter; unresolved dynamic inputs
are omitted. Detached source headings are grouped separately.

The PDF viewer retains page-size placeholders, renders visible pages first through
a bounded queue and releases distant canvases/text layers. Zoom cancels stale work
and preserves a page-relative reading position. Outline navigation uses the existing
snapshot-specific forward SyncTeX; inverse source navigation remains on double-click.

PDF.js parsing uses its worker, while canvas painting still shares the browser UI
thread. Paint continuations therefore yield between chunks and pause during input
or scrolling; inactive/hidden viewers suspend work. Only the latest visible pages
are scheduled, and a finished detached drawing surface is presented once, using
bitmap transfer where supported. The independent text layer remains selectable.
Page positions are measured after geometry changes and cached for scroll handling.
Identical viewport queues, diagnostic attributes and idle polling results do not
trigger repeated updates. This bounds work as well as memory; it does not move all
PDF painting into a worker or guarantee a frame rate for arbitrary PDF operators.

HTTP routes use DSH authorization, same-origin mutation checks, bounded requests
and no CORS. File access is confined to explicitly registered folders, excludes
internal directories and rejects symlink escapes. The development server binds
loopback and has no production role. DSH tools expose only registered projects.

## AI integration and Agent context

AI co-editing of the open paper (web/assist.mjs, src/assist.mjs) targets a host
SDK that is not yet released; hosts without it simply skip registration. It is
documented here once that host is public.

The background `latex_studio` tool keeps proposal-only writes. It adds `context`,
`outline`, ranged `read`, `search`, `errors` and `propose-edit` (find/replace or
line-range edits converted to the existing whole-file proposal) so an Agent reads
and proposes small pieces instead of whole files. The brief is a user-only project
setting (8000 characters).

## Interface

One toolbar carries the sidebar toggle, back to projects, title, pending AI
changes (only when present), logs, settings and, when the host provides
`setImmersive`, a full-screen toggle (`data-immersive-control`, so the host
shows a single exit). A windowing host that passes `headerTarget` receives the
toolbar through a portal, and the view marks the heading
`data-app-header` so the window title is not duplicated. Without a target (DSH standalone) it renders inline. The sidebar is one panel
with Files / Outline / Git; settings, logs and AI changes open as sheets. The
compile button heads the source column. Theme follows the host's
`html[data-theme]`, then `prefers-color-scheme`. Width breakpoints are container
queries on the root, so a narrow window on a wide screen adapts; phone layout
still uses a viewport query. Pure Git view helpers live in web/git-ui.mjs.
