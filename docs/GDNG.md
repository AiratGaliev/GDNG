# GDNG — GDevelop Next Generation

GDNG is an independently maintained downstream fork of [GDevelop](https://github.com/4ian/GDevelop). It keeps the upstream editor, Core, GDJS runtime and built-in extensions while maintaining a small set of local-editor changes.

GDNG is not an official GDevelop product and is not affiliated with the GDevelop project.

## Repository topology

| Remote | URL | Purpose |
|---|---|---|
| `origin` | `https://github.com/AiratGaliev/GDNG.git` | This downstream fork |
| `upstream` | `https://github.com/4ian/GDevelop.git` | Official source repository |

The default branch is `main`, renamed from `custom` on 19 November 2026. It was initialized from upstream release `v5.6.287` (4 November 2026). GDNG uses `dev` for engineering integration, `test` for integrated candidate validation and `main` as the release baseline. The normal route is `topic branch → dev → test → main`. The `master` branch is a frozen, read-only snapshot of upstream GDevelop history. It is not synchronized automatically and must never be used as a GDNG development base. See [Development workflow](development-workflow.md) for branch, PR, CI, promotion and release rules.

For existing local clones created before the rename, update the local branch and tracking reference once:

```powershell
git fetch origin --prune
git branch -m custom main
git branch --set-upstream-to=origin/main main
git remote set-head origin -a
```

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
3. Skips a tag already contained in `main`.
4. Merges the release into a temporary `automation/upstream-<tag>` branch.
5. Stops without pushing if Git reports merge conflicts. In particular, a conflict in `.circleci/config.yml` is never resolved by blindly choosing either side.
6. Runs `scripts/verify-gdng-ci.cjs` after a successful merge and before publishing the candidate branch.
7. Opens a pull request targeting `main`.
8. Dispatches a candidate Windows build for that pull-request branch.

Upstream updates are **not auto-merged**. Review the PR diff and wait for the candidate build before merging. A conflicting CircleCI file blocks the automation instead of overwriting the GDNG pipeline; reconcile upstream CI improvements with the GDNG platform/artifact requirements explicitly, then rerun `scripts/verify-gdng-ci.cjs`. Never resolve that conflict by taking the complete `ours` or `theirs` version without reviewing the resulting jobs and workflows.

The automation uses the repository-scoped `GITHUB_TOKEN`; no personal access token or manually stored secret is required. The repository Actions setting permits write tokens and PR creation; each workflow/job still declares only the required `contents`, `pull-requests`, and `actions` scopes. The workflow explicitly dispatches the candidate build because GitHub does not automatically start a new workflow for most events created with `GITHUB_TOKEN`; `workflow_dispatch` is an exception.

## Build and artifacts

`.github/workflows/build-portable-windows.yml` is manual-only and can be dispatched against a branch, tag or commit. The upstream-sync workflow dispatches it against each candidate update branch. It remains a validation/build workflow, not a release publisher.

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

The IDE lockfile pins `caniuse-lite` to `1.0.30001826` so Browserslist uses current browser-support data during editor and Storybook builds; refresh this lockfile entry when updating the browser data rather than suppressing the stale-data warning or mutating dependencies ad hoc during CI. The Electron package's install script installs its nested Electron dependencies and imports resources. Do not pin `electronDist` to the host-installed `node_modules/electron/dist`: that directory is architecture-specific and breaks Linux ARM64 and macOS universal packaging. Let electron-builder resolve the matching Electron distribution for each target architecture. Modern npm versions block Git dependencies by default, so `newIDE/app/.npmrc` uses `allow-git=root`: only Git dependencies explicitly declared by the IDE's own `package.json` are allowed. The workflow rewrites the public upstream GitHub SSH dependency URL to HTTPS so CI does not need a personal SSH key. The Electron postinstall script is explicitly allowlisted in `newIDE/electron-app/package.json` for the pinned Electron version, and GDJS explicitly allowlists its pinned `esbuild` postinstall in `GDJS/package.json`. The build-policy check verifies these narrow allowlists. Do not globally disable npm's Git-dependency or install-script protections. If you change C++ Core or native extensions, consult `GDevelop.js/README.md` and rebuild the WebAssembly bindings with the documented Emscripten version.

## Manual upstream update

Prefer the automated release PR. If a manual upstream integration is necessary, it must still go through a reviewable PR into `main`; direct pushes to protected branches are not part of the workflow.

```powershell
cd C:\\Users\\Airat\\WebstormProjects\\GDNG

git fetch origin --prune
git fetch upstream --tags
git switch main
git pull --ff-only origin main

# Replace with the exact published upstream tag:
git switch -c automation/upstream-vX.Y.Z
git merge --no-ff vX.Y.Z

node scripts/verify-gdng-local-policy.cjs
node scripts/verify-gdng-ci.cjs
git diff --check

git push --set-upstream origin automation/upstream-vX.Y.Z
gh pr create --base main --head automation/upstream-vX.Y.Z
```

Review the complete PR diff and wait for the applicable candidate validation before merging. If the merge fails, inspect and resolve the conflict; do not reset local changes to the upstream tag. Never push the integration commit directly to `main`.

## License and attribution

Keep upstream license files and copyright notices intact. The Core, game engine, IDE and extensions are distributed under the licenses stated in their respective directories. The name GDevelop and its logo remain the property identified in the upstream repository's trademark notice. GDNG's own name does not imply ownership of GDevelop trademarks.

## CI and platform builds

GitHub Actions is the active CI enforcement layer for GDNG. `.github/workflows/fast-ci.yml` implements Fast CI for PRs targeting `dev`, `test` and `main`, including the required aggregate `fast-checks` status. `.github/workflows/release-multiplatform.yml` runs the full exact-commit matrix on pushes to `test` and `main`; ordinary branch pushes are validation-only. `.github/workflows/daily-e2e.yml` exercises the latest successful `main` package without rebuilding it. A release is published only through a `gdng-vX.Y.Z` tag or a qualifying merged upstream-release PR.

`.circleci/config.yml` preserves the upstream-derived CircleCI graph for future activation. The repository is **not yet connected to a CircleCI project**, so this configuration is not executing as a live CircleCI pipeline. GitHub Actions validates it with the official CircleCI CLI. Its graph follows upstream: `build-gdevelop_js-wasm-only` creates the exact current-commit Core/WebAssembly artifact; `build-app-for-desktop` consumes that workspace, imports the exact bindings and builds the web editor once; Linux and Windows package the same persisted editor output with `--skip-app-build`; macOS retains its independent native build path. The graph includes Core/WASM sanitizers, package validation, daily E2E and change-based visual jobs. It has no S3 deployment or release publisher and cannot race with the authoritative GitHub Release workflow.

GDNG uses `dev` for ordinary engineering integration, `test` for integrated candidate validation and `main` as the release baseline. The normal promotion route is `topic branch → dev → test → main`; `master` is a frozen read-only upstream snapshot, not a live mirror. See [Development workflow](development-workflow.md) for the authoritative branch and PR policy. The PR checks observed for this migration were GitHub Actions checks; no live CircleCI status is claimed, and Semaphore/Travis configuration files alone must not be treated as evidence that those providers are connected.

### Development validation model

**Pull requests targeting `dev`, `test` or `main`.** `.github/workflows/fast-ci.yml` builds `GDevelop.js`/WASM for the exact PR commit, runs GDevelop.js tests, native GDCore ASan/UBSan, IDE lint/format/Flow/script-type/unit tests, and GDJS type/doc/format/build/ChromeHeadless checks. Storybook visual coverage is change-based and compares against the actual PR target branch (`github.base_ref`). The workflow intentionally does not package Windows, Linux or macOS installers. Its `fast-checks` aggregate job waits for all five validation jobs and fails unless each succeeds; this is the stable required status used by the `dev`, `test` and `main` Rulesets.

**After a candidate reaches `test` or `main`.** `.github/workflows/release-multiplatform.yml` runs the full cross-platform validation matrix against the exact pushed commit. It validates package formats and architectures, sanitizers, IDE/runtime checks, CLI export and the full Storybook/packaged-editor visual suites. Ordinary branch pushes use the validation-only path: no tag, draft Release or external publication is created. Full validation and functional/browser/manual acceptance are separate gates; acceptance is recorded against the exact candidate SHA on `test` before promotion to `main`.

**Daily E2E.** `.github/workflows/daily-e2e.yml` runs at 16:00 UTC and can be started manually. It locates the latest successful `main` run of the full validation workflow, downloads that run's `gdng-release-linux` artifact and executes CLI HTML5 export plus real-editor visual tests against the same package. The Linux artifact is retained for seven days. This catches regressions in a packaged build without paying the cost of rebuilding the platform matrix every day.

**Windows fallback.** `.github/workflows/build-portable-windows.yml` is a manual-only fallback for upstream candidate branches and troubleshooting. It no longer starts an extra Windows build on every `main` push because the authoritative full matrix already builds and verifies Windows.

### Authoritative multi-platform GitHub Release workflow

`.github/workflows/release-multiplatform.yml` is the only workflow that publishes GDNG versioned releases. It supports two independent entry points: (1) push a matching `gdng-vX.Y.Z` tag for a deliberately selected commit, or (2) merge an upstream sync PR from `automation/upstream-vX.Y.Z` into `main`. The second path is accepted only after the PR is merged; unrelated PR closures are filtered out before starting the expensive build matrix.

The release graph performs these steps:

1. Builds `GDevelop.js` and `libGD.wasm` once from the exact selected source commit (manual tag commit or merged upstream PR commit) using Emscripten 3.1.21. The exact artifact feeds one shared web-editor build, which is consumed by Linux, Windows and macOS packaging. No prebuilt upstream or S3 binary is used.
2. Builds the architecture-neutral web editor once on Linux for all platform packaging. The artifact contains the compiled web bundle, generated GDJS runtime resources and exact Core/WASM files. Linux, Windows and macOS stage it with `app-build.js --skip-app-build` and invoke electron-builder with `--skip-app-build`, avoiding duplicate frontend/resource builds. macOS still performs native Electron packaging on the supported `macos-15-intel` runner; the shared web bundle does not alter Universal packaging or its x64/arm64 architecture checks. The retired `macos-14` label is not used.
3. Packages Windows x64 (unsigned NSIS installer and portable ZIP), Linux x64/arm64 (AppImage, DEB and portable ZIP), and macOS universal (DMG and ZIP). The electron-builder config must not pin one host-installed `electronDist`: electron-builder resolves Electron separately for each target architecture. CI verifies x64/arm64 ELF machine types inside Linux AppImages and portable ZIPs, DEB architecture metadata, and both Mach-O slices in the macOS app executable and Electron Framework.
4. Runs the IDE unit suite, Flow, GDJS TypeScript checks, GDevelop.js tests, native GDCore ASan/UBSan tests, and debug-sanitizers/clang-tidy GDevelop.js checks in parallel with platform packaging. Platform jobs no longer wait for the IDE verification job; this changes scheduling only, not release acceptance.
5. Runs Linux CLI HTML5 export against the just-built Linux ZIP, the complete Storybook visual suite, and the packaged-editor visual suite against that same Linux ZIP.
6. Uploads the platform outputs as workflow artifacts. Only after every required build and test job succeeds does `publish-release` download all three platform artifacts and invoke `scripts/publish-gdng-release.cjs`.

The workflow caches npm downloads for dependency-installing jobs, the Emscripten 3.1.21 SDK across WASM jobs, and separate compiler caches for normal WASM, debug-sanitizer WASM and GDCore sanitizer builds. Compiler caches use unique per-run keys with stable restore prefixes so new compilation results are saved without attempting to mutate immutable GitHub Actions cache entries. Cache misses remain safe: every job still has a complete install and compile path.

The publisher rejects missing architectures, empty or duplicate assets, and mismatched tags. Before upload, it resolves the GitHub tag (including annotated tags) and verifies that it still points to the exact commit used for the build. It generates `gdng-release-metadata.json` and `SHA256SUMS.txt`, creates a GitHub draft Release, uploads all binaries, and publishes the draft only after every upload succeeds. It never overwrites an already published release or deletes assets from a draft that it does not own.

A merged `automation/upstream-vX.Y.Z` PR follows the same platform matrix. The workflow checks that the version in `newIDE/electron-app/app/package.json` matches the upstream PR tag, then creates the immutable `gdng-vX.Y.Z` tag on the exact merge commit in `main` and publishes the release. The tag is created only after all required build and test jobs succeed. Re-runs accept that tag only when it already points to the same commit; an existing tag on another commit is never moved. The tag-triggered path remains available for manually selected commits and uses the same build matrix and publisher.

A manual `workflow_dispatch` run builds and tests the same platform matrix, then runs the publisher in `--validate-only` mode. When `release_tag` is left empty, validation derives the expected tag from the current `newIDE/electron-app/app/package.json` version. It **does not** create or publish a release. The workflow runs the full validation-only matrix on pushes to `test` and `main`. It does not use a temporary CI-migration branch trigger.

GitHub Actions uses its repository-scoped `GITHUB_TOKEN` with `contents: write`; no CircleCI project activation, PAT or manually stored release secret is required. The release binaries are unsigned. Windows SmartScreen and macOS Gatekeeper warnings may appear; signing and notarization can be added later with GDNG-owned certificates.

For a deliberately selected manual release of the current package version `5.6.287`, the matching tag remains `gdng-v5.6.287`. After merging the release workflow into `main` and validating the full manual matrix, publish it with:

```powershell
git switch main
git pull --ff-only origin main
git tag gdng-v5.6.287
git push origin gdng-v5.6.287
```

GitHub Actions will then build from that exact tag and publish the Release automatically. For routine upstream updates, do not create this tag manually: merging the reviewed `automation/upstream-vX.Y.Z` PR into `main` starts the same release pipeline and creates the GDNG tag after the matrix passes.

### Upstream merge protection

`.github/workflows/sync-upstream-release.yml` continues to prepare PRs only; it never auto-merges upstream into `main`. On a Git conflict it aborts before pushing a candidate branch. After a conflict-free merge it runs `scripts/verify-gdng-ci.cjs` before publishing the candidate branch.

The verifier protects both CI systems: it checks the CircleCI reusable dependency/Emscripten commands, current-commit WASM hand-off, shared editor build workspace and downstream platform dependencies, and it checks the GitHub release workflow's platform jobs, exact-commit WASM hand-off, tests, publisher dependencies and validation-only dispatch. This is intended to stop an upstream update that would silently remove GDNG's release matrix or its safety gates.

`.github/workflows/build-portable-windows.yml` remains a manual Windows build fallback for troubleshooting and upstream candidate validation. It is not a release workflow and does not publish GitHub Releases.
