# Releasing Shinsa

Shinsa ships as one Mac app (`apps/desktop`) that carries its engine, interface and `shinsa` command, all under one
version (`docs/plans/app-plan.md` → Versions and updates). A release is a GitHub release of `shinsa-dev/shinsa`
made by the Release workflow (`.github/workflows/release.yml`); nothing is bumped by hand, since the version lives
in the tag. There are two channels: **Stable** and **Beta**.

## Running a release

Actions → Release → Run workflow, or from a terminal:

```sh
gh workflow run release.yml -f channel=beta -f bump=minor
gh workflow run release.yml -f channel=stable -f bump=minor
```

The first releases use `bump=major`: betas `1.0.0-beta.N`, then `1.0.0` (The first releases, below).

| Input | Values | Default |
|---|---|---|
| `channel` | `stable`: a normal GitHub release, marked latest. `beta`: a GitHub pre-release of the next version | `beta` |
| `bump` | `patch`, `minor` or `major`: which part of the **last stable** version goes up | `patch` |

The workflow, on `macos-15`:

1. Works out the version (`scripts/release.ts`, the rules below; `scripts/release-version.ts` holds them, tested at
   100%) and writes it to the run's summary.
2. Signing preflight: states in the summary and as a notice whether this build is **signed and notarized** (all
   five secrets set) or **not signed** (none set). Some but not all set fails the run, naming the missing ones.
3. Builds the web app, the engine with `SHINSA_VERSION=<version>` (`apps/engine/scripts/build-engine.ts`) and the app
   with `extraMetadata.version=<version>`, then `electron-builder --mac dmg zip --arm64`, signing and notarizing when
   the secrets are there.
4. Checks that the app (`CFBundleShortVersionString`) and the engine inside it (`shinsa version --json`) both say the
   release's version, prerelease suffix included, and verifies the signature (`codesign --verify --deep --strict`;
   `spctl` and `stapler validate` too when signed).
5. Writes the update files for both channels (below) and publishes the release with GitHub's generated notes under a
   one-line channel note: `Shinsa-mac-arm64.dmg`, `.zip`, their `.blockmap`s and the update files.

## Versions

Versions are semver, tags `v<version>`. Stable releases are `X.Y.Z`; a beta is always a prerelease of the **next**
version, `X.Y.Z-beta.N`:

- **Stable** = the bump of the last stable tag. Prerelease tags are ignored when finding it, and tags are compared by
  semver, not by date or name.
- **Beta** = `<bump of the last stable>-beta.N`, where N is one more than the highest `v<that version>-beta.*` tag.

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
- **Beta** (`channel = beta`, `allowPrerelease = true`) reads the newest release, pre-releases included, and its
  `beta-mac.yml`. A stable release carries `beta-mac.yml` too, so Beta gets every stable release once it is newer:
  on `3.0.1-beta.1`, a stable `4.0.0` is offered like any beta. "Newest" is the release published last (the feed's
  order), not the highest version: a stable hotfix `4.0.1` published after `4.1.0-beta.1` is what Beta offers a
  `4.0.0` until the next beta ships, while `4.1.0-beta.1` itself is not offered the lower `4.0.1`.
  `apps/desktop/test/lib/update-feed.test.ts` runs electron-updater's own GitHub provider over such feeds.
- `allowDowngrade` is false (electron-updater turns it on whenever `channel` is set, so the app sets it back), with
  one exception. Switching from Beta to Stable on a beta newer than the latest stable (on `1.3.0-beta.2` with
  `1.2.0` the latest stable) offers to go back: Settings → General → Updates shows "Go back to 1.2.0 (stable)?" with
  Download and install and Stay on this beta, and the app asks the same once in a dialog right after the switch.
  Download and install turns `allowDowngrade` on for that one check, downloads `1.2.0` and installs it when you
  quit, like any update. Stay on this beta keeps it until a stable release passes it (`1.3.0`), and the app stops
  offering (`keptBeta` in `userData/prefs.json`, cleared on the next channel switch); Shinsa → Check for Updates…
  offers again. Downgrades stay off in every other case.
- Switching to Stable discards a beta that is downloading or downloaded: the download is cancelled, and a beta
  already handed to macOS's installer (Squirrel.Mac stages it for the next quit) is removed, its ShipIt job
  (`launchctl remove <bundle id>.ShipIt`) and its folder (`~/Library/Caches/<bundle id>.ShipIt`), before the
  Stable check runs.
- The update files: electron-builder writes `latest-mac.yml` and, for the `github` provider, never a file per channel
  (`generateUpdatesFilesForAllChannels` and `detectUpdateChannel` do not apply to it), so the workflow derives them: a
  stable release uploads `latest-mac.yml` and a copy as `beta-mac.yml`, a beta uploads it as `beta-mac.yml` only.
  The file names the zip by its plain name (`Shinsa-mac-arm64.zip`), which the updater fetches from the same tag.
- A new install starts on Beta when its version is a beta and on Stable otherwise; the choice is the app's own
  (Settings → General → Updates, ⌘K's Update channel) and switching checks again at once.

Downloads: `https://shinsa.dev/download` is the latest stable DMG
(`https://github.com/shinsa-dev/shinsa/releases/latest/download/Shinsa-mac-arm64.dmg`), and
`https://shinsa.dev/download/beta` the DMG of the newest release, pre-releases included (`apps/marketing/CLAUDE.md` →
Deploy).

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
