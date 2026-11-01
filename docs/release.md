# Releasing Shinsa

Shinsa ships as two products under one version (`docs/plans/app-plan.md` → Versions and updates): **the apps**, today
the Mac app (`apps/desktop`), which carries the engine, interface and `shinsa` command and updates itself; and **the
engine on its own**, the same compiled engine with its interface inside, for Linux (x64, arm64) and Apple Silicon Macs
without the app (The engine on its own, below). Both come from the same GitHub release; npm and shinsa.dev only point
at it. A release is a GitHub release of `shinsa-dev/shinsa`
made by the Release workflow (`.github/workflows/release.yml`); nothing is bumped by hand, since the version lives
in the tag. There are three channels: **Stable** and **Beta**, cut by hand, and **Canary**, built from every merge to
`main` that passes the tests. All three are builds of the same app, Shinsa (`studio.overclock.shinsa`), so you switch
between them in Settings → General → Updates and Shinsa updates itself in place, with the same data and engine.

## Running a release

Actions → Release → Run workflow, or from a terminal:

```sh
gh workflow run release.yml -f channel=beta -f bump=minor
gh workflow run release.yml -f channel=stable -f bump=minor
```

The first releases use `bump=major`: betas `1.0.0-beta.N`, then `1.0.0` (The first releases, below). A canary needs
no run: every merge to `main` whose Test workflow passes makes one (Canary builds, below); `gh workflow run
release.yml -f channel=canary` makes one of the current `main` by hand, tested or not.

| Input | Values | Default |
|---|---|---|
| `channel` | `stable`: a normal GitHub release, marked latest. `beta`: a GitHub pre-release of the next version. `canary`: a GitHub pre-release of `main`, as a merge makes | `beta` |
| `bump` | `patch`, `minor` or `major`: which part of the **last stable** version goes up; a canary ignores it | `patch` |

The workflow first decides, on Ubuntu (`trigger`), whether to build and which commit: a run by hand always builds
the commit it runs on; a canary is decided by `scripts/release-canary.ts` (Canary builds, below). Then, on a
GitHub-hosted macOS 15 runner (`macos-15`, free for a public repository), the `mac` job checks out that commit and:

1. Works out the version (`scripts/release.ts`, the rules below; `scripts/release-version.ts` holds them, tested at
   100%) and writes it to the run's summary.
2. Signing preflight: states in the summary and as a notice whether this build is **signed and notarized** (all
   five secrets set) or **not signed** (none set). Some but not all set fails the run, naming the missing ones.
3. Builds the web app, the engine with `SHINSA_VERSION=<version>` (`apps/engine/scripts/build-engine.ts`) and the app
   with `extraMetadata.version=<version>`, then the release in three steps: `electron-builder --mac dir --arm64`
   builds and signs `release/mac-arm64/Shinsa.app` (ad hoc when unsigned) without notarizing; when signed,
   `scripts/release-notarize.ts` notarizes and staples that app, retrying (Signing and notarization, below); and
   `electron-builder --mac dmg zip --arm64 --prepackaged release/mac-arm64/Shinsa.app` packages the disk image and the
   zip from it, without signing it again, so both carry the stapled ticket. electron-builder writes the updater's
   `Contents/Resources/app-update.yml` only when the run that packs builds a `dmg` or `zip`, which neither step does,
   so the app carries a checked-in `apps/desktop/resources/app-update.yml` (`extraResources`) that the first step
   copies in before signing; without it electron-updater finds an update and fails to download it. Every channel
   builds the same app from `electron-builder.yml`. The disk image's volume is
   `Shinsa <version>` and opens on the install window, the app beside an Applications link on the site's
   background; a beta or a canary passes `-c.dmg.background=dmg/background-<channel>.png` for the one with its Beta
   or Canary pill (`apps/desktop/CLAUDE.md` → The disk image).
4. Checks that the app (`CFBundleShortVersionString`) and the engine inside it (`shinsa version --json`) both say the
   release's version, prerelease suffix included, that the bundle id is `studio.overclock.shinsa` on every channel, that the app has `Contents/Resources/app-update.yml`, and verifies the signature (`codesign --verify --deep --strict`;
   `spctl` and `stapler validate` too when signed).
5. Packs the signed app's engine folder as `shinsa-darwin-arm64.tar.gz` with its `.sha256` (`scripts/release-engine.ts`),
   writes the update files for the channels (below) and publishes the release with GitHub's generated notes under a
   one-line channel note: `Shinsa-mac-arm64.dmg`, `.zip`, their `.blockmap`s, the update files and the Mac engine
   archive. A beta or a canary
   is a pre-release titled `Shinsa <version> (beta)` or `(canary)`, never marked latest.
6. A `linux` job (Ubuntu, a matrix over `bun-linux-x64` and `bun-linux-arm64`) builds each Linux engine at the
   release's version, checks that `shinsa version --json` reports it (the arm64 one on an arm64 runner), packs it the
   same way and adds `shinsa-linux-<cpu>.tar.gz` and its `.sha256` to the release.
7. Once those are in, an `npm` job publishes the engine to npm (The engine on its own, below), and in another job (`downloads`, on Ubuntu, after the release is published), copies the release's disk image to the
   site's R2 bucket and points the download channels at it (`scripts/release-upload.ts`, below). It is its own job
   so that a failure there (a token without R2 access, an R2 outage) leaves the published release alone, and
   Re-run failed jobs retries only the copy. Nothing is ever deleted: every GitHub release and tag and every build in
   R2 stays (How many are kept, below).
8. Reports the release on the commit it built, as a commit status named `Release` linked to the run, so it shows
   beside lint and test on GitHub and turns the commit red when it fails. Check runs of a `workflow_run` workflow
   never count in the commit's status, so the jobs post it through the statuses API (`statuses: write`): the `mac`
   job sets `pending` as it starts, and a closing `status` job (`if: always()`) sets `success` once the Linux engines,
   the downloads and npm are all done, `failure` when the decision, the build, the Linux engines, the downloads or npm
   failed (its description names which), or `error` when the run was cancelled,
   such as a canary a newer merge replaced. A run that decides not to build posts nothing.

## Canary builds

Every merge to `main` that passes the tests builds and publishes a canary, signed and notarized like any release, so
the newest tested `main` is always what the Canary channel installs. The rules, all in `.github/workflows/release.yml`:

- **What starts one.** The Release workflow runs on `workflow_run` of Test: when Test finishes, the `trigger` job goes
  on only if it succeeded on a push to `main` of this repository (`conclusion == 'success'`, `event == 'push'`,
  `head_branch == 'main'`), and every later job checks out that run's `head_sha`, the commit Test passed, and tags it
  (`gh release create --target`). A failed or cancelled Test makes no canary.
- **What it skips.** A change that touches only `docs/`, `apps/marketing/`, a Markdown file at the root, a
  `CLAUDE.md`, `.claude/` or `.github/assets/` (none of them is in the app) makes no canary. `workflow_run` has no
  `paths-ignore`, so the rule moved into `scripts/release-canary.ts` (`CANARY_IGNORED_PATHS` and
  `resolveCanaryDecision` in `scripts/release-version.ts`, tested at 100%): it compares the commit with the newest
  canary tag, not only with its parent, so a merge whose canary was cancelled by the next one still reaches a canary
  when the next one changes only docs. The first canary always builds. The decision and the files are in the run's
  summary.
- **Rapid merges.** The `mac` job of a canary is in the concurrency group `release-canary` with `cancel-in-progress`,
  so a newer tested merge cancels the canary still building for an older one; stable and beta builds keep their own
  group, `release`, and are never cancelled. The group is on the job, not the workflow, so a Release run that decides
  not to build (Test failed, or only docs changed) never cancels a canary in progress. A run cancelled while it uploads
  can leave a draft release behind; the next canary takes the same version (a draft has no tag), so it deletes that
  draft before it publishes.
- **Loops.** The workflow pushes nothing itself: `gh release create` makes the tag through the API, a tag is not a
  push to `main`, and GitHub never starts a workflow from its own token's events.
- **Notes.** The generated notes start at the previous canary's tag, so they list what this merge brought.
- **How many are kept.** All of them. Every canary's GitHub release and tag stays, so its commit and the day it
  shipped can always be found, and its disk image, zip and blockmap stay in R2 under `releases/<version>/`. The app
  reads its updates from shinsa.dev, one file per channel, so the number of releases on GitHub never crowds a channel
  out (Moving off GitHub's feed, below).

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

The app updates itself with electron-updater from `https://shinsa.dev/updates` (`apps/desktop/src/main/updater.ts`),
electron-updater's `generic` provider over the update files `scripts/release-upload.ts` writes to R2 (Downloads,
below), not GitHub's release feed. GitHub's feed lists only the newest ten releases and tags, so reading it meant
deleting old canaries to keep betas and stable releases on it; the files on shinsa.dev name one version per channel
and never run out.

- **Stable** (`channel = latest`) reads `latest-mac.yml`: the newest stable release, never a beta.
- **Beta** (`channel = beta`) reads `beta-mac.yml`: the newest beta or stable release by semver. A stable release
  moves `beta-mac.yml` too once it is newer, so on `3.0.1-beta.1` a stable `4.0.0` is offered like any beta; a stable
  hotfix `4.0.1` below a running `4.1.0-beta.1` leaves it alone, so Beta never moves back.
- **Canary** (`channel = canary`) reads `canary-mac.yml`: the newest canary, and only canaries. Nothing is missed: a
  canary's version is the patch above the newest beta or stable release (Versions, above), so the next merge after a
  release brings a canary above it.
- All three read the same feed (`UPDATE_FEED` in `apps/desktop/src/lib/update-channel.ts`, `publish` in
  `electron-builder.shared.yml` and the bundled `resources/app-update.yml`, which `test/release/build.test.ts` keeps
  equal). `useMultipleRangeRequest` is false: R2 answers one byte range per request, so the updater fetches the parts
  of the zip a blockmap says changed one range at a time. Each file names its zip as
  `<version>/Shinsa-mac-arm64.zip`, which the updater fetches from `shinsa.dev/updates/<version>/`, served from
  `releases/<version>/` in the bucket (`apps/marketing/CLAUDE.md` → Deploy).
  `apps/desktop/test/lib/update-feed.test.ts` runs electron-updater's own generic provider over such files.
- A channel's file only moves when its download pointer moves (`resolveChannelUpdates`), so a release older by semver
  than what a channel offers never takes it back.
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
- The update files: electron-builder writes `latest-mac.yml` only (`detectUpdateChannel: false` in
  `electron-builder.shared.yml`; with the `generic` provider it would otherwise name the file after the version's
  pre-release word, `canary-mac.yml` for a canary, and the workflow would not find it), so the workflow derives the channel's own: a
  stable release uploads `latest-mac.yml` and a copy as `beta-mac.yml`, a beta uploads it as `beta-mac.yml` only and
  a canary as `canary-mac.yml` only, each naming the zip by its plain name (`Shinsa-mac-arm64.zip`). A build from
  before the move to shinsa.dev still reads them from GitHub; `scripts/release-upload.ts` copies them to R2 with the
  zip's path rewritten.
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
moves Canary. Before any of that it also downloads the zip, its blockmap and the release's own update file
(`latest-mac.yml`, `beta-mac.yml` or `canary-mac.yml`), checks the zip's size and SHA-512 against that file
(`parseUpdateFile`, `assertUpdateZip`) and uploads both next to the disk image; then, for the same channels as the
pointers, it writes `updates/<channel>-mac.yml` with every URL rewritten to `<version>/Shinsa-mac-arm64.zip`
(`serializeUpdateFile`), the files the Mac app's updater reads at `shinsa.dev/updates`. The update files are written
last, so none ever names a zip the bucket does not hold. Nothing in the bucket is ever deleted: every version's disk
image, zip and blockmap stay under `releases/<version>/`. The rules are `scripts/release-downloads.ts`, tested at 100%; the layout and how the
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

## The engine on its own

Every release, on every channel, carries the engine three times, each a `.tar.gz` with a `.sha256` beside it (one line,
`<sha256>  <archive>`): `shinsa-darwin-arm64` (packed from the signed, notarized app, so the binary keeps its
Developer ID signature), `shinsa-linux-x64` and `shinsa-linux-arm64`. Each unpacks to one folder holding `bin/shinsa`,
`plugin/` (the plugin agents load) and `web/` (the built interface, served on the engine's port and through remote
access). `scripts/release-engine.ts` packs them (`packEngine`: the folder must hold all three, the binary must report
the release's version, and macOS's `._` files are kept out) and refuses any other target. Intel Macs, Windows and
musl (Alpine) have none.

Two ways in, both reading those archives:

- **npm.** `npm i -g shinsa` (or `bunx shinsa`) installs `shinsa`, a small Node launcher
  (`apps/engine/npm/shinsa.js`), and through its `optionalDependencies` the one engine package for the machine:
  `@shinsa/darwin-arm64`, `@shinsa/linux-x64` or `@shinsa/linux-arm64` (each names its `os` and `cpu`, and glibc on Linux, so
  npm skips the others). The launcher runs that package's `bin/shinsa` with the same arguments, passing on its exit
  code and signals, and on an Intel Mac, another system or a missing engine package says why instead. The `npm` job
  downloads the release's archives, checks each against its `.sha256`, unpacks them into packages at the release's
  version (`scripts/release-npm.ts`) and publishes the engine packages first, the launcher last, all under the
  channel's dist-tag: `latest` for stable, `beta` and `canary` otherwise. So `npm i -g shinsa@beta` or `@canary`
  picks a channel, and plain `shinsa` stays on the 0.0.1 placeholder until the first stable release. A version npm
  already has is skipped, so Re-run failed jobs is safe.
- **The install script.** `curl -fsSL https://shinsa.dev/install | sh` (`apps/marketing/public/install`, served as
  text) picks the archive for the machine, asks `shinsa.dev/download/version` (`/beta`, `/canary`) for the channel's
  version, downloads the archive and its `.sha256` from that GitHub release, checks the sum, runs the engine once,
  and only then replaces `~/.local/share/shinsa` and links `~/.local/bin/shinsa`. `SHINSA_CHANNEL` picks the channel
  (canary by default, like the site's download buttons, until a stable release exists) and `SHINSA_VERSION` a version.
  A failed run leaves an earlier install as it was. It is the site's (`apps/marketing/CLAUDE.md` → The install
  script), so it changes with a site deploy, not a release.

Neither updates itself: run the script again, or `npm i -g shinsa@<tag>`. Then `shinsa start` sets the engine up as a
background service, systemd on Linux and launchd on a Mac without the app (`docs/engine.md` → Run on a server).

**Publishing to npm needs the `NPM_TOKEN` secret**: an npm automation (or granular) token allowed to publish
`shinsa` and every package under the `@shinsa` scope, so the `shinsa` package and a `shinsa` npm organization owned
by the same account. Without it the `npm` job adds a notice and skips its steps, and the release still counts as
published, as an unsigned build does.

## Moving off GitHub's feed

Apps built before `UPDATE_FEED` pointed at shinsa.dev read GitHub's release feed, which lists only the newest ten
releases. Canary apps move with the next canary. Apps on `1.0.0-beta.1` to `1.0.0-beta.5` take a newer beta only
while it is among those ten: once ten newer releases push it out, they find no update and need a reinstall from
`shinsa.dev/download/beta`. Before the first beta on the new feed, copy the newest beta's update files to R2, so the
Beta channel has a file before any app reads it: `CLOUDFLARE_API_TOKEN=… bun scripts/release-upload.ts v1.0.0-beta.5`
(the next canary writes `canary-mac.yml`).

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
memory for the engine's Bun runtime). Notarizing is its own step, `bun scripts/release-notarize.ts <app>`, because
Apple's services drop connections now and then and electron-builder's notarize never retries, so one lost connection
used to fail the whole release. The script zips the app with `ditto`, submits it with
`xcrun notarytool submit --wait --output-format json` (three attempts, 30 s and 60 s apart) and staples the ticket
with `xcrun stapler staple` (five attempts, 15 s, 30 s, 60 s and 120 s apart), writing a warning annotation for each
retry. Apple rejecting the app is not retried: the step fails at once with Apple's log. The retry and the parsing are
`scripts/release-retry.ts`, tested at 100%. If a release still fails there, Re-run failed jobs on the run builds it
again from the start.

## The first releases

1. Set the five secrets (or knowingly ship unsigned betas that will not update themselves).
2. Run a beta: `channel=beta`, `bump=major` gives `1.0.0-beta.1` while nothing is tagged. Install it from
   `shinsa.dev/download/beta` (once the site is deployed) and check that the app opens, starts its engine and shows
   Beta in Settings → General → Updates.
3. Run another beta and see the first one update itself (signed builds only).
4. Run `channel=stable` with the same bump, `major`: `1.0.0`, marked latest; `shinsa.dev/download` serves it.
   Later releases bump from `1.0.0` (`minor` for features, `patch` for fixes).
