# GDNG — GDevelop Next Generation

GDNG is an independently maintained downstream fork of [GDevelop](https://github.com/4ian/GDevelop). It keeps the upstream editor, Core, GDJS runtime and built-in extensions while maintaining a small set of local-editor changes.

GDNG is not an official GDevelop product and is not affiliated with the GDevelop project.

## Repository topology

| Remote | URL | Purpose |
|---|---|---|
| `origin` | `https://github.com/AiratGaliev/GDNG.git` | This downstream fork |
| `upstream` | `https://github.com/4ian/GDevelop.git` | Official source repository |

The default branch is `custom`. It was initialized from upstream release `v5.6.287` (4 November 2026). Keep downstream changes on `custom` or short-lived branches based on it. Do not develop directly on the mirrored `master` branch.

The local checkout is expected at `C:\Users\Airat\WebstormProjects\GDNG`. The Windows desktop executable and bundle identify themselves as **GDNG**, with a separate Electron application ID (`com.gdng.editor`) and Windows AppUserModelID so they do not replace an official GDevelop installation. The packaged desktop updater is explicitly configured for GitHub releases from `AiratGaliev/GDNG`; it never checks or installs releases from the upstream `4ian/GDevelop` repository. The current Windows artifact is a portable ZIP, for which `electron-updater` does not support automatic installation. Portable builds therefore detect their package marker, report that updates are manual, and do not call `autoUpdater`. Download a newer ZIP from GDNG Releases when one is published. A future signed NSIS distribution can enable the configured in-app updater.

## Local feature policy

The single switch is:

`newIDE/app/src/Utils/LocalFeaturePolicy.js`

`LOCAL_FULL_FEATURES_ENABLED = true` enables local editor functionality that upstream presents as Premium-only. It is intentionally separate from subscription and account entitlements.

The current local policy covers:

- Debugger access without subscription nag dialogs.
- Live preview / Hot Reload without periodic subscription nag dialogs.
- Preview over Wi-Fi without subscription nag dialogs.
- Local editor controls for disabling the GDevelop splash/logo and exported-game watermark per project.
- Local loading-screen timing controls when GDevelop branding is disabled.

The editor still uses upstream runtime functionality. This patch does not grant cloud projects, AI credits, cloud builds, multiplayer capacity, leaderboards, publishing services, storage, analytics, or any other server-side capability. The global `hasValidSubscriptionPlan` implementation and API-provided `limits` remain unchanged.

A focused unit test lives at `newIDE/app/src/Utils/LocalFeaturePolicy.spec.js`. The repository-level guard `scripts/verify-gdng-local-policy.cjs` is also run by CI and after upstream updates.

## Upstream release automation

`.github/workflows/sync-upstream-release.yml` runs daily at 08:23 UTC and can also be started manually.

The workflow:

1. Looks up the latest published release in `4ian/GDevelop`, or uses an explicitly supplied tag.
2. Fetches the exact upstream tag.
3. Skips a tag already contained in `custom`.
4. Merges the release into a temporary `automation/upstream-<tag>` branch.
5. Stops without pushing if Git reports merge conflicts. In particular, a conflict in `.circleci/config.yml` is never resolved by blindly choosing either side.
6. Runs `scripts/verify-gdng-ci.cjs` after a successful merge and before publishing the candidate branch.
7. Opens a pull request targeting `custom`.
8. Dispatches a candidate Windows build for that pull-request branch.

Upstream updates are **not auto-merged**. Review the PR diff and wait for the candidate build before merging. A conflicting CircleCI file blocks the automation instead of overwriting the GDNG pipeline; reconcile upstream CI improvements with the GDNG platform/artifact requirements explicitly, then rerun `scripts/verify-gdng-ci.cjs`. Never resolve that conflict by taking the complete `ours` or `theirs` version without reviewing the resulting jobs and workflows.

The automation uses the repository-scoped `GITHUB_TOKEN`; no personal access token or manually stored secret is required. The repository Actions setting permits write tokens and PR creation; each workflow/job still declares only the required `contents`, `pull-requests`, and `actions` scopes. The workflow explicitly dispatches the candidate build because GitHub does not automatically start a new workflow for most events created with `GITHUB_TOKEN`; `workflow_dispatch` is an exception.

## Build and artifacts

`.github/workflows/build-portable-windows.yml` is manually dispatched against a branch, tag or commit. The upstream-sync workflow dispatches it against each candidate update branch; it is not an automatic push-triggered build.

The workflow runs the complete IDE unit suite and Flow on Ubuntu (the upstream resource-path tests assume POSIX path semantics), checks GDJS TypeScript types, then builds an unsigned portable Windows ZIP on Windows and uploads it as a GitHub Actions artifact for 30 days. It does not publish installers, sign binaries, create a GitHub Release, or deploy anything externally.

### Local Windows setup

Use Node.js 24 and npm. The repository's own setup scripts import the GDJS runtime and native `GDevelop.js` bindings into the editor resources.

From PowerShell:

```powershell
cd C:\Users\Airat\WebstormProjects\GDNG

python -m pip install --upgrade setuptools

cd newIDE\app
npm install --no-audit --no-fund

# Windows: run the GDNG-specific test; the complete IDE suite runs on Ubuntu CI.
& .\node_modules\.bin\react-app-rewired.cmd test --env=node --watchAll=false --runInBand src/Utils/LocalFeaturePolicy.spec.js

$flow = '.\node_modules\.bin\flow.cmd'
& $flow start --max-workers 4 --wait --no-auto-restart
if ($LASTEXITCODE -ne 0) { throw 'Flow failed to start' }
& $flow status --timeout 600000
if ($LASTEXITCODE -ne 0) { throw 'Flow reported errors' }
& $flow stop

cd ..\electron-app
npm install --no-audit --no-fund

$env:GD_PORTABLE_BUILD = 'true'
node scripts/build.js --win zip --publish never
```

The Electron package's install script installs its nested editor and GDJS dependencies and imports resources. `electron-builder-config.js` points `electronDist` to the already-installed Electron distribution, avoiding a second download during packaging. Modern npm versions block Git dependencies by default, so `newIDE/app/.npmrc` uses `allow-git=root`: only Git dependencies explicitly declared by the IDE's own `package.json` are allowed. The workflow rewrites the public upstream GitHub SSH dependency URL to HTTPS so CI does not need a personal SSH key. The Electron postinstall script is explicitly allowlisted in `newIDE/electron-app/package.json` for the pinned Electron version, and GDJS explicitly allowlists its pinned `esbuild` postinstall in `GDJS/package.json`. The build-policy check verifies these narrow allowlists. Do not globally disable npm's Git-dependency or install-script protections. If you change C++ Core or native extensions, consult `GDevelop.js/README.md` and rebuild the WebAssembly bindings with the documented Emscripten version.

## Manual upstream update

Prefer the automated release PR. For a deliberate manual update:

```powershell
cd C:\Users\Airat\WebstormProjects\GDNG

git switch custom
git pull --ff-only origin custom
git fetch upstream --tags

# Replace with the exact published upstream tag:
git merge --no-ff vX.Y.Z

node scripts/verify-gdng-local-policy.cjs
node scripts/verify-gdng-ci.cjs
git diff --check

# Run tests, Flow and the portable build before pushing:
git push origin custom
```

Do not force-push `custom`. If the merge fails, inspect and resolve the conflict; do not reset local changes to the upstream tag.

## License and attribution

Keep upstream license files and copyright notices intact. The Core, game engine, IDE and extensions are distributed under the licenses stated in their respective directories. The name GDevelop and its logo remain the property identified in the upstream repository's trademark notice. GDNG's own name does not imply ownership of GDevelop trademarks.

## CI and platform builds

The primary multi-platform pipeline remains the upstream CircleCI configuration at .circleci/config.yml. It retains the upstream jobs for WebAssembly, native Core sanitizers, IDE/GDJS checks and desktop packaging:

- macOS builds the engine and editor on a macOS runner.
- Linux and Windows consume the exact libGD.js/libGD.wasm build from build-gdevelop_js-wasm-only through a CircleCI workspace.
- Linux produces the configured AppImage, DEB and portable ZIP targets.
- Windows produces an unsigned NSIS installer and portable ZIP.
- CLI HTML5 export and packaged-editor visual tests use the Linux ZIP produced in the same CircleCI workflow.

The fork-specific changes are intentionally limited: the upstream AWS S3 deployment steps and AWS CLI orb are removed; the current WebAssembly build is passed between jobs by CircleCI workspace instead. The eSigner certificate bootstrap, code-signing commands, Microsoft Store AppX build and obsolete AppVeyor trigger are removed. No upstream AWS credentials, signing secrets or Microsoft Store publisher identity are required. Unsigned packages are uploaded as CircleCI artifacts.

CircleCI branch filters use custom as the fork primary branch. The scheduled end-to-end workflow builds a fresh Linux package before running CLI export and packaged-editor tests; it does not attempt to download an upstream master/latest artifact. Branch-scoped visual checks retain the upstream Storybook suite. The packaged-editor suite runs only when a local GDNG Linux package is available.

.semaphore/semaphore.yml remains the fast validation pipeline (Flow, TypeScript, formatting, lint and tests). It intentionally does not build the C++/WebAssembly engine, so its results are preliminary; the CircleCI build is the authoritative full-engine and packaging validation. .travis.yml retains the upstream full-test configuration on the custom branch. appveyor.yml is retained only as the deprecated upstream reference; CircleCI owns the Windows build.

The GitHub Actions workflow .github/workflows/build-portable-windows.yml is a manually dispatched Windows fallback used by upstream-release automation. It is not the primary release matrix. The multi-platform artifact set is produced and published by CircleCI.

### GitHub Release publishing

A tag matching `gdng-v<version>` triggers the dedicated `gdng-release` CircleCI workflow. It builds Windows x64 (NSIS installer and portable ZIP), Linux x64/arm64 (AppImage, DEB and portable ZIP) and a universal macOS build (DMG and ZIP). The release is not published until native Core checks, WebAssembly checks, the Linux CLI HTML5 export smoke test and the packaged-editor visual test have all passed.

Platform jobs persist their output into the CircleCI workspace. The final `publish-gdng-release` job checks that every expected artifact exists, writes `gdng-release-metadata.json` and `SHA256SUMS.txt`, uploads the files to a GitHub draft release, and publishes it only after all uploads succeed. A failed upload leaves the release as a draft so it cannot be mistaken for a complete build. A published release is never overwritten.

Before tagging, enable the `AiratGaliev/GDNG` project in CircleCI and add `GDNG_GITHUB_TOKEN` under **Project Settings → Environment Variables**. Use a fine-grained GitHub token restricted to this repository with **Contents: Read and write**. GitHub documents this permission for creating releases and managing release assets; if the tagged commit changes workflow files relative to the repository's default branch, the token also needs **Workflows: Read and write**. See [GitHub's release API permission requirements](https://docs.github.com/en/rest/releases/releases#fine-grained-access-tokens-for-create-a-release). Never put the token in the repository or CircleCI config.

For the current package version, after the CircleCI project and token are configured, create and push the matching tag from `custom`:

```powershell
git switch custom
git pull --ff-only origin custom
git tag gdng-v5.6.287
git push origin gdng-v5.6.287
```

The tag must match `newIDE/electron-app/app/package.json`. The publisher rejects a mismatched tag, missing platform artifacts, duplicate asset names, and attempts to overwrite an already published release. Regular branch builds continue to store artifacts in CircleCI; they do not create or publish GitHub Releases.

**Signing status:** the CI artifacts are unsigned. Windows SmartScreen and macOS Gatekeeper may display warnings. Signing/notarization can be added later with GDNG-owned certificates and secrets; upstream credentials must never be reused.

### Upstream CI preservation

`scripts/verify-gdng-ci.cjs` checks the fork-owned CircleCI job graph, WebAssembly workspace hand-off, GDNG Linux archive naming, unsigned Windows targets, release target matrix and manual-only Windows fallback. Upstream release synchronization runs this verifier after the Git merge and before it pushes an update branch. This is a fail-closed guard: if upstream changes CI without producing a textual conflict but breaks a required GDNG build path, the sync stops before creating a pull request. A direct conflict in `.circleci/config.yml` also stops the merge before any branch is published.
