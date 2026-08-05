# Security

## The threat model, stated plainly

**Skins run with the exact same privileges as Amee itself. There is no
sandbox.** A skin's JavaScript executes in the same webview, with the same
access to `invoke()` — and therefore to every Tauri command Amee has — the same
DOM, and the same network access as the rest of the app. A skin could read your
now-playing history, make arbitrary network requests, or misuse whatever OS
permissions Amee has been granted (it already asks for system-audio and
media-remote access).

That is a deliberate trade-off in Amee's design, made in favour of giving skin
authors real power, and it is documented in
[the skin documentation](https://docs.amee.thiennguyen.dev/customization/skins).
Amee's own import check validates a package's *shape* — does the manifest
parse, does the entry file exist, are the dimensions sane. It makes no attempt
to decide whether the JavaScript is safe, because a file-format check can't.

So: **the only real control on this registry is that a human reads the code.**
Everything below exists to make that read possible and to make it count.

## What the pipeline guarantees

| | |
|---|---|
| **Source, not blobs** | Packages commit source. A skin built from TypeScript declares a build and CI runs it; the bundle is never committed. A reviewer reads what actually runs. |
| **Reproducible artifacts** | Staged files get a fixed timestamp and the zip runs under `TZ=UTC`, so the same source always yields the same SHA-256. A published release asset can be re-derived from the merged source and compared. |
| **Digest in the index** | `index.json` carries each artifact's SHA-256. Amee verifies it before the archive is ever opened, and refuses to install on a mismatch. |
| **Host allowlist** | Amee's installer only downloads from GitHub release assets. A deep link pointing anywhere else is refused before any request is made. |
| **Explicit consent** | Amee never installs silently. It shows the skin's name, author, version and source host — read from the *verified archive*, not from the link — with Cancel as the default button. |
| **Fork PRs are contained** | `validate.yml` runs on `pull_request`, not `pull_request_target`, so a package's build command runs with a read-only token and no secrets. |
| **Ownership** | Updates to an existing package must come from the `owner` in its `store.json`, or from a maintainer. |

## What it does *not* guarantee

Be clear-eyed about this:

- **Review is not proof.** A maintainer reading a few hundred lines of
  JavaScript can miss something. Subtle malice is hard to spot on purpose.
- **The digest is integrity, not authenticity.** The download URL and its hash
  come from the same page. It catches corruption and catches an asset being
  swapped after publication; it does not defend against a compromised store
  page. Signing the index is planned and would close that gap.
- **Anything on your machine can open an `amee://` link.** The consent prompt is
  what stands between that and an install. Read it.
- **A skin can be fine at v1.0.0 and hostile at v1.1.0.** Every version gets
  reviewed, but you're trusting a person over time, not a one-off audit.

## Review checklist

What a maintainer looks for before approving. Contributors: reading this first
saves a review round trip.

**Readability**
- No obfuscated, minified, or machine-generated code without matching source.
- No `eval`, `new Function`, or dynamic `import()` over a string that came from
  the network or from storage.
- Third-party code is either a lockfile-pinned dependency or vendored with a
  stated origin — not an unexplained blob pasted into `main.js`.

**Behaviour**
- Every `fetch` / `XMLHttpRequest` / `WebSocket` is disclosed in the PR, with a
  reason. A skin that draws a mini player has no business calling out.
- No now-playing data, listening history, or anything else about the user
  leaving the machine.
- No `invoke()` of Amee commands beyond what the documented SDK wraps.
  `window.amee` is the supported surface; reaching past it is a flag.
- No writing outside the skin's own `amee.storage`.
- No attempt to modify Amee's own UI, settings, other skins, or the theme.

**Packaging**
- `id` matches the directory, isn't a built-in id, and isn't squatting a name
  that belongs to someone else's project.
- `preview.png` shows the actual skin.
- Declared dimensions match what the skin draws.
- Nothing unexpected in the file list.

## Reporting a problem

If you find a malicious or compromised package, or a hole in this pipeline, use
GitHub's **[Report a vulnerability](https://github.com/thiennguyen93/amee-store/security/advisories/new)**
for a private disclosure. Please don't open a public issue for something
actively exploitable.

A package found to be malicious is removed from `registry/`, its releases are
deleted, and it drops out of `index.json` on the next publish. Note the limit
of that: **it does not uninstall anything already on a user's machine.** If it
comes to that, the removal will be announced.
