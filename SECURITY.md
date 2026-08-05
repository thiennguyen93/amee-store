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
| **Signed index** | `index.json` is signed by this registry's own key, and Amee checks the digest against that signed document rather than against the link that asked for it. See [The signed index](#the-signed-index). |
| **Host allowlist** | Amee's installer only downloads from GitHub release assets. A deep link pointing anywhere else is refused before any request is made. |
| **Explicit consent** | Amee never installs silently. It shows the skin's name, author, version and source host — read from the *verified archive*, not from the link — with Cancel as the default button. |
| **Fork PRs are contained** | `validate.yml` runs on `pull_request`, not `pull_request_target`, so a package's build command runs with a read-only token and no secrets. |
| **Ownership** | Updates to an existing package must come from the `owner` in its `store.json`, or from a maintainer. |

## What it does *not* guarantee

Be clear-eyed about this:

- **Review is not proof.** A maintainer reading a few hundred lines of
  JavaScript can miss something. Subtle malice is hard to spot on purpose.
- **A signature is not a safety review.** It says this registry published
  exactly these bytes. It says nothing about what the JavaScript does, and it
  does not narrow a skin's access by one bit — a signed skin is as unsandboxed
  as any other. The control is still the human read above.
- **There is no revocation.** The index is signed but its age isn't enforced, so
  a valid old index stays valid. Anyone able to serve a stale copy can keep
  offering a package this registry has since pulled.
- **The signing key is a trust root.** Whoever holds it can sign anything. It
  lives in one place and is used by one workflow, and it is deliberately not the
  key that signs Amee's own app updates.
- **Anything on your machine can open an `amee://` link.** The consent prompt is
  what stands between that and an install. Read it.
- **A skin can be fine at v1.0.0 and hostile at v1.1.0.** Every version gets
  reviewed, but you're trusting a person over time, not a one-off audit.

## The signed index

A digest that travels in the same install link as the URL is integrity, not
authenticity — a page that lies about both isn't caught, and neither is anyone
with write access here swapping a published release asset. Signing `index.json`
closes that: Amee carries this registry's public key, so a link can still claim
anything, but the claim has to agree with something this registry signed.

Two files on `main`, both written by the publish workflow, never by hand:

| File | What it is |
|---|---|
| `index.json` | The index. |
| `index.json.minisig` | A detached [minisign](https://jedisct1.github.io/minisign/) signature over it, in the raw 4-line format. |

`keys/store-index.pub` is the public half. Amee compiles the same value in as
`STORE_INDEX_PUBKEYS`, so changing it here is only half of a rotation — the other
half is an app release, and older builds fall back to treating the index as
unsigned until they catch up. minisign, rather than anything else, because Amee
already uses it to verify its own app updates: one key format, one CLI.

### Verifying by hand

```sh
node tools/verify-index-sig.mjs
```

Zero dependencies, and it mirrors what the app does — including refusing
minisign's legacy non-prehashed algorithm, which `minisign -V` would accept and
Amee would not.

### How CI decides to sign

The workflow verifies the existing signature and signs only when that fails.
It does not compare the index against its previous bytes, for two reasons:

- **Signing isn't deterministic.** minisign stamps `timestamp:<epoch>` into the
  trusted comment, so re-signing a byte-identical index yields a different file
  every run. Signing unconditionally would commit on every push.
- **A file diff misses the cases that matter.** An index that hasn't changed can
  still have a signature that is missing entirely, or left over from a rotated
  key. A valid signature *is* proof the index is unchanged, so verifying covers
  the diff's job and those two as well.

Both files land in one commit, so `main` never serves an index newer than the
signature over it. `workflow_dispatch` is the way to re-sign after a key
rotation or a failed run.

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
