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
5. Stops without pushing if Git reports merge conflicts.
6. Opens a pull request targeting `custom`.
7. Dispatches a candidate Windows build for that pull-request branch.

Upstream updates are **not auto-merged**. Review the PR diff and wait for the candidate build before merging. If a merge conflict occurs, resolve it on a dedicated branch, keep the local feature policy intact, run the checks below, and then open/update the PR.

The automation uses the repository-scoped `GITHUB_TOKEN`; no personal access token or manually stored secret is required. The repository Actions setting permits write tokens and PR creation; each workflow/job still declares only the required `contents`, `pull-requests`, and `actions` scopes. The workflow explicitly dispatches the candidate build because GitHub does not automatically start a new workflow for most events created with `GITHUB_TOKEN`; `workflow_dispatch` is an exception.

## Build and artifacts

`.github/workflows/build-portable-windows.yml` runs for pushes to `custom` and can be manually dispatched against a branch, tag or commit.

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

The GitHub Actions workflow .github/workflows/build-portable-windows.yml is a manually dispatched Windows fallback used by upstream-release automation. It is not the primary release matrix. The multi-platform artifact set is produced by CircleCI.

**Signing status:** the CI artifacts are unsigned. Windows SmartScreen and macOS Gatekeeper may display warnings. Signing/notarization can be added later with GDNG-owned certificates and secrets; upstream credentials must never be reused.
