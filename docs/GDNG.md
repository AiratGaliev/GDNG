# GDNG â€” GDevelop Next Generation

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

The Electron package's install script installs its nested Electron dependencies and imports resources. Do not pin `electronDist` to the host-installed `node_modules/electron/dist`: that directory is architecture-specific and breaks Linux ARM64 and macOS universal packaging. Let electron-builder resolve the matching Electron distribution for each target architecture. Modern npm versions block Git dependencies by default, so `newIDE/app/.npmrc` uses `allow-git=root`: only Git dependencies explicitly declared by the IDE's own `package.json` are allowed. The workflow rewrites the public upstream GitHub SSH dependency URL to HTTPS so CI does not need a personal SSH key. The Electron postinstall script is explicitly allowlisted in `newIDE/electron-app/package.json` for the pinned Electron version, and GDJS explicitly allowlists its pinned `esbuild` postinstall in `GDJS/package.json`. The build-policy check verifies these narrow allowlists. Do not globally disable npm's Git-dependency or install-script protections. If you change C++ Core or native extensions, consult `GDevelop.js/README.md` and rebuild the WebAssembly bindings with the documented Emscripten version.

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

CircleCI remains the upstream-derived branch validation pipeline at `.circleci/config.yml`. Its build graph follows upstream: `build-gdevelop_js-wasm-only` creates the exact current-commit Core/WebAssembly artifact; `build-app-for-desktop` consumes that workspace, imports the exact bindings and builds the web editor once; Linux and Windows then package the same persisted editor output with `--skip-app-build`. macOS retains its independent native build path, as in upstream. The graph also retains the Core sanitizer, GDJS/WASM, IDE, CLI-export and visual-test jobs. The `custom` branch is the downstream primary branch. CircleCI is **not** configured as a GitHub Release publisher, so it cannot race with the release workflow or overwrite release assets. The GitHub Actions verification job also runs the official CircleCI CLI `config validate` against this file, so configuration errors are caught even when the repository is not yet connected to a CircleCI project. Superseded branch-validation runs are cancelled when a newer commit is pushed to the same validation branch; tag-release and manual validation runs are not cancelled by this policy.

### Authoritative multi-platform GitHub Release workflow

`.github/workflows/release-multiplatform.yml` is the only workflow that publishes GDNG versioned releases. It is triggered by pushing a tag matching `gdng-v*`, and then verifies that the tag exactly matches `newIDE/electron-app/app/package.json`.

The release graph performs these steps:

1. Builds `GDevelop.js` and `libGD.wasm` once from the tagged commit using Emscripten 3.1.21. The exact artifact is passed to all three desktop build jobs; no prebuilt upstream or S3 binary is used.
2. Builds Windows x64 (unsigned NSIS installer and portable ZIP), Linux x64/arm64 (AppImage, DEB and portable ZIP), and macOS universal (DMG and ZIP). The macOS job uses the supported `macos-15-intel` GitHub-hosted runner; the retired `macos-14` label is not used. The electron-builder config must not pin one host-installed `electronDist`: electron-builder resolves Electron separately for each target architecture. CI verifies x64/arm64 ELF machine types inside Linux AppImages and portable ZIPs, DEB architecture metadata, and both Mach-O slices in the macOS app executable and Electron Framework.
3. Runs the IDE unit suite, Flow, GDJS TypeScript checks, GDevelop.js tests, native GDCore ASan/UBSan tests, and the debug-sanitizers/clang-tidy GDevelop.js checks.
4. Runs Linux CLI HTML5 export against the just-built Linux ZIP, the complete Storybook visual suite, and the packaged-editor visual suite against that same Linux ZIP.
5. Uploads the platform outputs as workflow artifacts. Only after every required job succeeds does `publish-release` download all three platform artifacts and invoke `scripts/publish-gdng-release.cjs`.

The publisher rejects missing architectures, empty or duplicate assets, and mismatched tags. It generates `gdng-release-metadata.json` and `SHA256SUMS.txt`, creates a GitHub draft Release, uploads all binaries, and publishes the draft only after every upload succeeds. It never overwrites an already published release or deletes assets from a draft that it does not own.

A manual `workflow_dispatch` run builds and tests the same platform matrix, then runs the publisher in `--validate-only` mode. It **does not** create or publish a release. The workflow also runs this validation automatically when commits are pushed to `ci/full-multiplatform-builds`; use that run to validate the complete matrix before merging and creating the real version tag.

GitHub Actions uses its repository-scoped `GITHUB_TOKEN` with `contents: write`; no CircleCI project activation, PAT or manually stored release secret is required. The release binaries are unsigned. Windows SmartScreen and macOS Gatekeeper warnings may appear; signing and notarization can be added later with GDNG-owned certificates.

For the current upstream release `v5.6.287`, the editor package version is `5.6.287`. After merging the release workflow into `custom` and validating the full manual matrix, publish the matching GDNG tag:

```powershell
git switch custom
git pull --ff-only origin custom
git tag gdng-v5.6.287
git push origin gdng-v5.6.287
```

GitHub Actions will then build from that exact tag and publish the Release automatically. Do not tag before the PR has merged and the manual validation run has passed.

### Upstream merge protection

`.github/workflows/sync-upstream-release.yml` continues to prepare PRs only; it never auto-merges upstream into `custom`. On a Git conflict it aborts before pushing a candidate branch. After a conflict-free merge it runs `scripts/verify-gdng-ci.cjs` before publishing the candidate branch.

The verifier protects both CI systems: it checks the CircleCI reusable dependency/Emscripten commands, current-commit WASM hand-off, shared editor build workspace and downstream platform dependencies, and it checks the GitHub release workflow's platform jobs, exact-commit WASM hand-off, tests, publisher dependencies and validation-only dispatch. This is intended to stop an upstream update that would silently remove GDNG's release matrix or its safety gates.

`.github/workflows/build-portable-windows.yml` remains a manual Windows fallback for troubleshooting. It is not a release workflow and does not publish GitHub Releases.