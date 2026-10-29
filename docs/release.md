# Releasing Shinsa

Shinsa ships as one Mac app (`apps/desktop`) that carries its engine, interface and `shinsa` command, all under one
version (`docs/plans/app-plan.md` → Versions and updates). A release is a GitHub release of `shinsa-dev/shinsa`
made by the Release workflow (`.github/workflows/release.yml`); nothing is bumped by hand, since the version lives
in the tag. There are three channels: **Stable** and **Beta**, cut by hand, and **Canary**, built every three hours from
the newest `main` that passes the tests. All three are builds of the same app, Shinsa (`studio.overclock.shinsa`), so you switch
between them in Settings → General → Updates and Shinsa updates itself in place, with the same data and engine.

## Running a release

Actions → Release → Run workflow, or from a terminal:

```sh
gh workflow run release.yml -f channel=beta -f bump=minor
gh workflow run release.yml -f channel=stable -f bump=minor
```

The first releases use `bump=major`: betas `1.0.0-beta.N`, then `1.0.0` (The first releases, below). A canary needs
no run: every three hours the newest `main` commit whose Test workflow passed makes one when the app changed (Canary
builds, below); `gh workflow run release.yml -f channel=canary` makes one of the current `main` by hand, tested or
not.

| Input | Values | Default |
|---|---|---|
| `channel` | `stable`: a normal GitHub release, marked latest. `beta`: a GitHub pre-release of the next version. `canary`: a GitHub pre-release of `main`, as the build every three hours makes | `beta` |
| `bump` | `patch`, `minor` or `major`: which part of the **last stable** version goes up; a canary ignores it | `patch` |

The workflow first decides, on Ubuntu (`trigger`), whether to build and which commit: a run by hand always builds
the commit it runs on; a canary is decided by `scripts/release-canary.ts` (Canary builds, below). Then, on a
GitHub-hosted macOS 15 runner (`macos-15`, free for a public repository), the `mac` job checks out that commit and:

1. Works out the version (`scripts/release.ts`, the rules below; `scripts/release-version.ts` holds them, tested at
   100%) and writes it to the run's summary.
2. Signing preflight: states in the summary and as a notice whether this build is **signed and notarized** (all
   five secrets set) or **not signed** (none set). Some but not all set fails the run, naming the missing ones.
3. Builds the web app, the engine with `SHINSA_VERSION=<version>` (`apps/engine/scripts/build-engine.ts`) and the app
   with `extraMetadata.version=<version>`, then `electron-builder --mac dmg zip --arm64`, signing and notarizing when
   the secrets are there. Every channel builds the same app from `electron-builder.yml`. The disk image's volume is
   `Shinsa <version>` and opens on the install window, the app beside an Applications link on the site's
   background; a beta or a canary passes `-c.dmg.background=dmg/background-<channel>.png` for the one with its Beta
   or Canary pill (`apps/desktop/CLAUDE.md` → The disk image).
4. Checks that the app (`CFBundleShortVersionString`) and the engine inside it (`shinsa version --json`) both say the
   release's version, prerelease suffix included, that the bundle id is `studio.overclock.shinsa` on every channel, and verifies the signature (`codesign --verify --deep --strict`;
   `spctl` and `stapler validate` too when signed).
5. Writes the update files for the channels (below) and publishes the release with GitHub's generated notes under a
   one-line channel note: `Shinsa-mac-arm64.dmg`, `.zip`, their `.blockmap`s and the update files. A beta or a canary
   is a pre-release titled `Shinsa <version> (beta)` or `(canary)`, never marked latest.
6. In a second job (`downloads`, on Ubuntu, after the release is published), copies the release's disk image to the
   site's R2 bucket and points the download channels at it (`scripts/release-upload.ts`, below). It is its own job
   so that a failure there (a token without R2 access, an R2 outage) leaves the published release alone, and
   Re-run failed jobs retries only the copy. After a canary, the same job removes the GitHub releases and tags of all
   but the newest five canaries (`scripts/release-prune.ts`), even when the copy failed.

## Canary builds

Every three hours the newest tested `main` is built and published as a canary when it changes the app, signed and
notarized like any release, so the Canary channel is never more than a few hours behind the newest tested `main`.
One build per window instead of one per merge keeps the macOS minutes and the release feed small when merges come in
bursts. The rules, all in `.github/workflows/release.yml`:

- **What starts one.** The Release workflow runs on a `schedule` (`17 */3 * * *`, UTC, off the hour when GitHub's
  scheduler is busiest). The `trigger` job asks GitHub for the newest successful Test run of a push to `main`
  (`gh run list --workflow test.yml --branch main --event push --status success`, which needs `actions: read`), and
  every later job checks out that run's `headSha`, the commit Test passed, and tags it (`gh release create
  --target`). A commit whose Test failed, was cancelled or did not run (Test skips a change only to docs) is never
  built; the canary waits for the next commit that passes.
- **What it skips.** A commit already in the newest canary makes no canary (`git merge-base --is-ancestor`, reason
  `released`), so a quiet window, or a newer commit whose Test failed, builds nothing. A change that touches only
  `docs/`, `apps/marketing/`, a Markdown file at the root, a `CLAUDE.md`, `.claude/` or `.github/assets/` (none of
  them is in the app) makes no canary either. Both rules are in `scripts/release-canary.ts` (`CANARY_IGNORED_PATHS`
  and `resolveCanaryDecision` in `scripts/release-version.ts`, tested at 100%): it compares the commit with the
  newest canary tag, so everything merged since the last canary is in the next one. The first canary always builds.
  The decision and the files are in the run's summary.
- **Overlaps.** The `mac` job of a canary is in the concurrency group `release-canary` with `cancel-in-progress`, so a
  newer canary, scheduled or by hand, cancels one still building; stable and beta builds keep their own group,
  `release`, and are never cancelled. The group is on the job, not the workflow, so a Release run that decides not to
  build never cancels a canary in progress. A run cancelled while it uploads can leave a draft release behind; the
  next canary takes the same version (a draft has no tag), so it deletes that draft before it publishes.
- **Loops.** The workflow pushes nothing itself: `gh release create` makes the tag through the API, a tag is not a
  push to `main`, and GitHub never starts a workflow from its own token's events.
- **Notes.** The generated notes start at the previous canary's tag, so they list everything merged since it.
- **How many are kept.** Five. GitHub's release feed, which electron-updater and the site's fallback read, lists only
  the newest 10 releases, so canaries left alone would push every beta and stable release out of it within ten
  builds and leave the Beta channel with nothing to find. `scripts/release-prune.ts` deletes the older canary
  releases with their tags (`gh release delete --cleanup-tag`), and `scripts/release-upload.ts` deletes their disk
  images from R2. Only `vX.Y.Z-canary.N` tags are ever touched (`listStaleCanaries` in `scripts/release-version.ts`).

## Versions

Versions are semver, tags `v<version>`. Stable releases are `X.Y.Z`; a beta is always a prerelease of the **next**
version, `X.Y.Z-beta.N`, and a canary `X.Y.Z-canary.N`:

- **Stable** = the bump of the last stable tag. Prerelease tags are ignored when finding it, and tags are compared by
  semver, not by date or name.
- **Beta** = `<bump of the last stable>-beta.N`, where N is one more than the highest `v<that version>-beta.*` tag.
- **Canary** = `<the version in progress>-canary.N`. The version in progress comes from the highest stable or beta
  tag by semver (canary tags are ignored when finding it): a beta `X.Y.Z-beta.M` gives `X.Y.Z`, the version its betas
  lead to, and a stable `X.Y.Z` gives the patch after it, `X.Y.(Z+1)`. N is one more than the highest
  `v<that version>-canary.*` tag. Canary tags are never the last stable release or the base of a beta.

Semver compares prerelease words alphabetically, so `beta` sorts **below** `canary`: `1.3.0-beta.9 < 1.3.0-canary.1 <
1.3.0`. The canary rule relies on that order: while `1.3.0` betas run, canaries are `1.3.0-canary.N`, newer than every
beta of that version and older than the stable `1.3.0` they lead to, so a canary never jumps a version ahead of the
release in progress: `1.2.0 < 1.3.0-beta.1 < 1.3.0-canary.1 < 1.3.0-canary.2 < 1.3.0`. Once the stable `1.3.0` ships,
the next canary is `1.3.1-canary.1`, above it; a new beta `1.4.0-beta.1` moves the next one to `1.4.0-canary.1`.
Canaries never go down as long as betas only go up: a stable hotfix `1.3.1` cut while `1.4.0` betas run is below
them, so canaries stay on `1.4.0`. Shinsa Canary updates only to canaries, so a canary is only ever compared with
other canaries.

So a beta sorts after the stable release before it and before the stable release it leads to, never above a newer
stable: `1.2.0 < 1.3.0-beta.1 < 1.3.0-beta.2 < 1.3.0 < 1.3.1-beta.1`.

| Last stable | Existing betas | Run | Version |
|---|---|---|---|
| none | none | beta, major | `1.0.0-beta.1` (the first release) |
| none | `v1.0.0-beta.1`, `v1.0.0-beta.2` | stable, major | `1.0.0` (the first stable release) |
| `1.0.0` | `v1.0.0-beta.*` | beta, minor | `1.1.0-beta.1` |
| `1.2.0` | none | beta, minor | `1.3.0-beta.1` |
| `1.2.0` | `v1.3.0-beta.1`, `v1.3.0-beta.2` | beta, minor | `1.3.0-beta.3` |
| `1.2.0` | `v1.3.0-beta.1`…`3` | stable, minor | `1.3.0` (ships what the betas led to) |
| `1.3.0` | `v1.3.0-beta.*` | beta, minor | `1.4.0-beta.1` (betas start again) |
| `1.3.0` | none | stable, patch | `1.3.1` (a hotfix while `1.4.0` betas run is fine) |
| none | `v1.0.0-beta.5` | canary | `1.0.0-canary.1`, then `.2`, `.3` on the next merges |
| `1.2.0` | `v1.3.0-beta.2` | canary | `1.3.0-canary.1` (the version its betas lead to) |
| `1.3.0` | `v1.3.0-beta.*`, `v1.3.0-canary.*` | canary | `1.3.1-canary.1` (above the stable `1.3.0`) |
| `1.3.0` | `v1.4.0-beta.1` | canary | `1.4.0-canary.1` (a new beta moves canaries to its version) |

Pick the same bump for a version's betas and its stable release. A beta of a different bump is still valid but sorts
by semver: after `1.3.0-beta.3`, a `patch` beta is `1.2.1-beta.1`, lower, so nobody already on `1.3.0-beta.3` gets it.

The engine and the app carry the same version string: `SHINSA_VERSION` and `extraMetadata.version` both come from the
one step, and the workflow refuses a build where they differ. The engine compares versions with prereleases by semver
(`resolveVersionOrder` in `packages/core/src/protocol/engine.ts`), so an engine on `1.3.0-beta.2` restarts into the
app's `1.3.0` like any older engine.

## Channels and updates

The app updates itself with electron-updater from the releases of `shinsa-dev/shinsa` (`apps/desktop/src/main/updater.ts`):

- **Stable** (`channel = latest`, `allowPrerelease = false`) reads the release GitHub marks latest, which is never a
  pre-release, and its `latest-mac.yml`: the newest stable release, never a beta.
- **Beta** (`channel = beta`, `allowPrerelease = true`) reads the newest release that is a beta or stable release,
  and its `beta-mac.yml`; electron-updater skips any other pre-release word, so a beta is never offered a canary. A stable release carries `beta-mac.yml` too, so Beta gets every stable release once it is newer:
  on `3.0.1-beta.1`, a stable `4.0.0` is offered like any beta. "Newest" is the release published last (the feed's
  order), not the highest version: a stable hotfix `4.0.1` published after `4.1.0-beta.1` is what Beta offers a
  `4.0.0` until the next beta ships, while `4.1.0-beta.1` itself is not offered the lower `4.0.1`.
  `apps/desktop/test/lib/update-feed.test.ts` runs electron-updater's own GitHub provider over such feeds.
- **Canary** (`channel = canary`, `allowPrerelease = true`) reads the newest canary and its `canary-mac.yml`:
  electron-updater's GitHub provider treats any pre-release word but `alpha` and `beta` as a channel of its own, so
  a beta or stable release is never offered on Canary. Nothing is missed: a canary's version is the patch above the
  newest beta or stable release (Versions, above), so the next merge after a release brings a canary above it.
- All three read the same `github` feed (`UPDATE_FEED` in `apps/desktop/src/lib/update-channel.ts`).
- `allowDowngrade` is false (electron-updater turns it on whenever `channel` is set, so the app sets it back), with
  one exception: going back from a beta or a canary when you switch to a channel below it. A version's channel is its pre-release word
  (`resolveReleaseChannel` in `packages/core`). Switching from Beta to Stable on a beta newer than the latest stable
  (on `1.3.0-beta.2` with `1.2.0` the latest stable) offers to go back: Settings → General → Updates shows "Go back
  to 1.2.0 (stable)?" with Download and install and Stay on this beta, and the app asks the same once in a dialog
  right after the switch. Download and install turns `allowDowngrade` on for that one check, downloads the version and
  installs it when you quit, like any update. Stay keeps the version until the channel passes it, and the app stops
  offering (`keptVersion` in `userData/prefs.json`, cleared on the next channel switch); Shinsa → Check for Updates…
  offers again. The same holds for a canary switched to Beta or Stable (on `1.3.1-canary.4` switched to Beta,
  "Go back to 1.3.0-beta.2 (beta)?" with Stay on this canary). Downgrades stay off in every other case, and switching
  to Canary never goes back.
- Switching to a channel below a beta or canary that is downloading or downloaded discards it: the download is cancelled, and an
  update already handed to macOS's installer (Squirrel.Mac stages it for the next quit) is removed, its ShipIt job
  (`launchctl remove <bundle id>.ShipIt`) and its folder (`~/Library/Caches/<bundle id>.ShipIt`), before the new
  channel's check runs.
- The update files: electron-builder writes `latest-mac.yml` and, for the `github` provider, never a file per channel
  (`generateUpdatesFilesForAllChannels` and `detectUpdateChannel` do not apply to it), so the workflow derives them: a
  stable release uploads `latest-mac.yml` and a copy as `beta-mac.yml`, a beta uploads it as `beta-mac.yml` only and
  a canary as `canary-mac.yml` only. The file names the zip by its plain name (`Shinsa-mac-arm64.zip`), which the
  updater fetches from the same tag.
- A new install starts on the channel of its own version (Canary for a canary, Beta for a beta, Stable otherwise);
  the choice is the app's own (Settings → General → Updates, ⌘K's Update channel), switching checks again at once,
  and every channel is offered. An old Shinsa Canary app (`studio.overclock.shinsa.canary`, from before canaries were
  a channel) is not updated any more: delete it and its `~/.config/shinsa-canary`, and pick Canary in Shinsa.

## Downloads

`https://shinsa.dev/download` is the DMG of the newest stable release, `https://shinsa.dev/download/beta` the DMG
of the newest beta or stable release, and `https://shinsa.dev/download/canary` the DMG of the newest canary, which
installs Shinsa on the Canary channel; until the first stable release, `/download` serves the beta. `/download` and
`/download/beta` never serve a canary, and `/download/canary` never serves anything else. All three come from
Cloudflare R2, not from GitHub, so heavy traffic never meets GitHub's rate limits; the download is named
`Shinsa-<version>.dmg` and never leaves shinsa.dev. GitHub's download count no longer includes them.

`bun scripts/release-upload.ts <tag>` (the workflow passes `RELEASE_TAG`) does the copy: it reads the release with
`gh release view`, downloads its `Shinsa-mac-arm64.dmg` and checks the size and SHA-256 against GitHub's digest,
uploads it to `shinsa-releases/releases/<version>/Shinsa-mac-arm64.dmg`, then writes the channel pointers
`channels/stable.json` (a stable release), `channels/beta.json` (a stable or beta release) and `channels/canary.json`
(a canary only), each only when the release is not older by semver than what it points at, so a stable release moves
Beta too once it is newer, a stable hotfix below a running beta leaves Beta alone, and a stable or beta release never
moves Canary. Then it deletes the
disk images of all but the newest five canaries from the bucket (`listStaleCanaryKeys`). The rules are `scripts/release-downloads.ts`, tested at 100%; the layout and how the
site serves it are `apps/marketing/CLAUDE.md` → Deploy. It talks to R2's S3 API with the `CLOUDFLARE_API_TOKEN` secret, the
**Shinsa CI** account token of Overclock Studio, which needs only **Workers R2 Storage Bucket Item Read** and **Write**
on `shinsa-releases`. The script asks Cloudflare for the token's id (`/accounts/<id>/tokens/verify`) and signs in with
the id as the access key and the token's SHA-256 as the secret, as R2 defines them; a bucket-scoped token works there
and not on Cloudflare's REST object API, which `wrangler r2 object` uses. Large files go up in parts, so there is no
size limit to watch. Running it again for the same tag is safe, and
`CLOUDFLARE_API_TOKEN=… bun scripts/release-upload.ts v1.2.0` backfills a release by hand.

If R2 cannot serve (no pointer yet, an error), the site redirects to the file on GitHub instead of showing a page, so
a download always works. The fallback for `/download/canary` is the newest canary on GitHub, or the releases page when
there is none.

Apple Silicon only. A universal or an extra x64 build would need an x64 engine (`SHINSA_ENGINE_TARGET=bun-darwin-x64`)
per architecture in `extraResources`, roughly doubles the build and the download, and needs the updater files to name
both zips; not worth it until someone asks for Intel.

## Signing and notarization

macOS installs an update (Squirrel.Mac) only when it is signed by the same Developer ID as the running app. **An
unsigned build installs and runs, but never updates itself**: it finds and downloads the update, then cannot install
it. It also asks for confirmation on first launch (Gatekeeper), and `SMAppService` may refuse to register the engine
from it. So the first release meant to update itself must be signed, and every later one with the same team.

Set these repository secrets (Settings → Secrets and variables → Actions):

| Secret | What |
|---|---|
| `CSC_LINK` | The Developer ID Application certificate and its private key, as a base64 `.p12` |
| `CSC_KEY_PASSWORD` | The `.p12`'s password |
| `APPLE_ID` | The Apple Account email of a member of the team |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that account (account.apple.com → Sign-In and Security → App-Specific Passwords) |
| `APPLE_TEAM_ID` | The 10-character team ID (developer.apple.com → Membership details) |

Exporting the certificate:

1. In Xcode → Settings → Accounts → your team → Manage Certificates, add a **Developer ID Application** certificate
   (only the team's Account Holder can create one), or create it at developer.apple.com → Certificates with a CSR from
   Keychain Access.
2. In Keychain Access → login → My Certificates, find "Developer ID Application: ‹name› (‹team›)", expand it to check
   the private key is there, select the certificate, File → Export Items…, save as `.p12` with a strong password.
3. `base64 -i developer-id.p12 | pbcopy`, paste as `CSC_LINK`; the password goes in `CSC_KEY_PASSWORD`. Delete the
   `.p12` afterwards.

electron-builder signs with the hardened runtime and `resources/entitlements.mac.plist` (JIT and unsigned executable
memory for the engine's Bun runtime), then notarizes with `notarytool` and staples the ticket.

## The first releases

1. Set the five secrets (or knowingly ship unsigned betas that will not update themselves).
2. Run a beta: `channel=beta`, `bump=major` gives `1.0.0-beta.1` while nothing is tagged. Install it from
   `shinsa.dev/download/beta` (once the site is deployed) and check that the app opens, starts its engine and shows
   Beta in Settings → General → Updates.
3. Run another beta and see the first one update itself (signed builds only).
4. Run `channel=stable` with the same bump, `major`: `1.0.0`, marked latest; `shinsa.dev/download` serves it.
   Later releases bump from `1.0.0` (`minor` for features, `patch` for fixes).
