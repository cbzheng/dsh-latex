# User guide

## Install

Requires DeepSeek Harness 0.2.2-rc.1 or later and Node.js 22+. Download the
release archive and `SHA256SUMS`, verify with `shasum -a 256 -c SHA256SUMS`, then
add the .tgz in DSH **Plugins → Install → local archive path**. Enable the LaTeX
Studio bundle, restart DSH if requested, and open it from the DSH sidebar.

CLI alternative, using the same profile and `DSH_HOME` as your DSH installation:

```sh
dsh plugin --profile desktop add ./cbzheng-dsh-latex-VERSION.tgz --ignore-scripts
```

Upgrade by installing the newer archive into the same profile. Projects, settings
and the prepared TeX runtime are kept. The package has no install scripts or
network npm dependencies.

## Preparing TeX

Installing the plugin and preparing TeX are separate. The first compile downloads
a checksum-pinned private TinyTeX, then any missing packages and downloadable
fonts. Progress shows downloaded size, verification, extraction, package
resolution and compilation; complex papers may need several dependency rounds.
Failures keep the last good PDF and offer the log and a retry.

Keep network on until a representative document compiles, then turn off online
packages in Settings to confirm offline builds. Newly introduced packages need an
online build again. TinyTeX lives in the plugin's own data directory and never
changes the global `PATH`. Git must be available; macOS may ask to install the
Command Line Tools the first time Git runs. Custom system fonts and packages that
require shell escape are not guaranteed.

## Projects

Open an existing folder, create a new paper, or paste a GitHub URL on the home
screen and choose where to clone it. An unzipped Overleaf export opens directly.
On a desktop, the native folder picker selects local folders; on a remote DSH
host, folders are on that host. Clones run in the background with real Git
progress and can be cancelled; reloading the page reconnects to the job, and an
interrupted folder is kept for inspection.

## Writing

- The toolbar holds the sidebar button, back to projects, logs and settings.
- **Settings**: main .tex file, compiler (pdfLaTeX / XeLaTeX / LuaLaTeX), build
  interval, online packages and language. Multi-entry projects should pick the
  real paper entry explicitly; opening another .tex file does not change it.
- **Sidebar**: Files (nested, folders first), Outline and Git.
- **Editing**: Cmd+B / Cmd+I (Ctrl elsewhere) or the toolbar buttons. The list
  and figure buttons insert itemize, enumerate (selected lines become items) and
  a figure environment, each as one undoable step.
- **Saving**: automatic, with content revision checks. If the file changed on
  disk, your draft is kept for copying and an explicit reload.
- **Compiling**: the Compile button at the top of the source column or
  Cmd+Enter. By default a build also runs every 5 minutes when the source has
  changed since the last build; choose 1–30 minutes or off in Settings.
- **PDF**: the source toolbar arrow jumps to the PDF position; double-click the
  PDF to jump back. Only visible and nearby pages are rendered.
- **Outline**: follows the main file's `\input` / `\include` order; clicking a
  heading opens its line and syncs the last successful PDF. Detached .tex files
  are grouped below.

## Git

Git reuses the host's existing identity, SSH agent, credential helpers and `gh`
login; it never collects tokens or changes global Git settings. The Git tab shows
the branch with ahead/behind counts, pull and push, colour-coded changes with
inline diffs, a commit box (Cmd+Enter) for the selected files, and a commit
timeline. Pull requires a clean tree and a fast-forward; divergence and conflicts
are never force-overwritten. A repository without `origin` can connect one; an
existing different `origin` is protected.

## Agent proposals

The `latex_studio` Agent tool can propose revision-checked changes. While any are
pending, a badge appears in the toolbar; nothing touches your source until you
accept. A generic shell Agent can still edit files directly, so ask it to use this
tool when you want review.

## Removal and backup

Removing the plugin keeps your paper folders and private plugin state, and
reinstalling reuses that state. Back up paper folders and your DSH profile
separately; Git does not contain the compiler cache.
