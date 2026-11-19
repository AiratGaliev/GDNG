# GDNG development workflow

This document defines the Git, Pull Request, CI and promotion workflow for the downstream GDNG repository. It adapts the trunk-based contribution process documented by [GDevelop](https://github.com/4ian/GDevelop) to GDNG's three integration branches, upstream mirror and independent release pipeline.

## 1. Branch model

| Branch | Role | What belongs here |
|---|---|---|
| `main` | Protected release baseline | Accepted release candidates, upstream release integrations and verified GDNG release commits |
| `dev` | Default engineering integration branch | Completed feature, fix, maintenance and documentation PRs |
| `test` | Integration / release-candidate branch | A coherent promotion from `dev`, ready for full validation and functional acceptance |
| `master` | Upstream mirror | The corresponding source history from `4ian/GDevelop`; never use it as a GDNG development base |
| `automation/upstream-<tag>` | Generated upstream candidate | A temporary branch created by the scheduled upstream-release workflow; its PR targets `main` |

The normal promotion path is:

```text
topic branch  ->  dev  ->  test  ->  main
                     |       |       |
                  Fast CI  Full CI  Release CI
                          + QA      + publish path
```

The `dev` and `test` branches were initialized from `main` at commit `44eabead8a4f` on 19 November 2026. They are independent refs from that point forward; they are not aliases and do not update automatically when another branch moves.

The repository default branch remains `main`. The upstream mirror `master` is intentionally separate. Never rename it, merge ordinary GDNG work into it, or use it as the base for GDNG feature branches.

## 2. Starting and naming work

Start every normal change from the latest `dev`, not from `main`, `test`, another topic branch or the upstream mirror.

PowerShell:

```powershell
git fetch origin --prune
git switch dev
git pull --ff-only origin dev
git switch -c feat/<short-description>
```

Use a short, descriptive topic branch name. Recommended prefixes are:

- `feat/<name>` — user-facing feature;
- `fix/<name>` — defect correction;
- `chore/<name>` — maintenance, tooling or dependency work;
- `docs/<name>` — documentation-only work;
- `refactor/<name>` — behavior-preserving code restructuring.

Keep topic branches short-lived and scoped to one logical change. A topic branch is not a long-term integration branch. Do not stack unrelated work on an earlier topic branch.

Before opening a PR, update the topic branch from the latest `dev` by merge or rebase, resolve conflicts there and rerun the applicable checks. Do not rewrite the history of protected branches.

## 3. Pull Request routing

### Topic branch to `dev`

All ordinary feature, fix, refactor, maintenance and documentation changes follow:

```text
feat/* | fix/* | refactor/* | chore/* | docs/*  ->  dev
```

A PR should:

1. Explain the behavior or engineering change and its scope.
2. Link relevant issue/context where applicable.
3. Update focused tests and documentation when contracts or behavior change.
4. Include the actual Fast CI result and mention checks that were not run.
5. Contain one coherent change; split unrelated work into separate PRs.

Do not create ordinary feature PRs directly against `test` or `main`. Do not commit directly to `dev`, `test` or `main`.

### Promotion from `dev` to `test`

A `dev → test` PR is a promotion of an integrated candidate, not a place to continue incomplete feature work.

Open it only when the intended candidate is coherent. Once merged, the push to `test` starts the full release-multiplatform validation workflow. That workflow validates the exact pushed commit and produces Linux, Windows and macOS artifacts without publishing a release.

Functional/browser/manual acceptance belongs to the integrated candidate on `test`, using one exact `test` SHA. Record the tested commit, environment, scenarios, results, artifacts and known limitations. Do not treat a successful build as proof of product acceptance.

If acceptance or full validation finds a defect, create a fix branch from the current `dev`, merge the fix into `dev`, and promote the corrected candidate again. Do not patch `test` or `main` directly.

### Promotion from `test` to `main`

A `test → main` PR promotes an accepted candidate to the release baseline. It must identify the exact candidate SHA and summarize full CI and acceptance evidence.

The push to `main` runs the full cross-platform validation workflow. A normal branch push is validation-only; it does not publish a GitHub Release. Publication remains restricted to the explicit GDNG release-tag path and the verified automatic upstream-release path described below.

Do not skip `dev` or `test` for ordinary feature work. Upstream release automation is a deliberate exception: the generated `automation/upstream-<tag>` PR targets `main` because it integrates a published upstream release and has its own conflict checks and candidate build.

## 4. CI responsibilities

CI is split by feedback speed and purpose; the full platform matrix is not a required job for every small topic change.

| Trigger / stage | Validation |
|---|---|
| PR into `dev`, `test` or `main` | Fast CI: exact-commit GDevelop.js/WASM build and tests, GDCore ASan/UBSan, IDE and GDJS checks, and Storybook visual tests affected by the PR |
| Push to `test` | Full GDNG cross-platform validation: WASM, native sanitizers, IDE/runtime, complete Storybook visual suite, Linux packaged-editor visual tests, CLI export, Linux x64/arm64, Windows x64 and universal macOS artifacts |
| Push to `main` | The same full validation matrix; branch pushes validate artifacts but do not publish |
| Daily scheduled workflow | Reuses a successful Linux artifact from `main` for CLI export and packaged-editor E2E checks; it does not rebuild the platform matrix |
| `gdng-v*` release tag | Builds the exact tagged commit and publishes only after all required validation and artifact checks pass |
| Merged `automation/upstream-<tag>` PR | Builds the exact merge commit, creates the corresponding immutable `gdng-v*` tag and publishes after the full matrix passes |

Fast CI is intended to expose a single aggregate `fast-checks` status in addition to its detailed jobs. Use the detailed job results when diagnosing a failure; do not bypass a failed required check by changing the target branch or weakening the workflow.

The full release workflow shares one exact-commit web-editor build across the platform packagers. It also reuses dependency, compiler, Emscripten and Babel caches where applicable. Do not reintroduce per-platform editor rebuilds or move full platform packaging into every topic PR.

### Current status-check enforcement

GitHub Rulesets protect all three long-lived branches:

- `main` requires a PR, prevents deletion and force-push, and requires all five currently active Fast CI job checks.
- `dev` and `test` require a PR and prevent deletion and force-push. Their Fast CI triggers are introduced with this workflow bootstrap; make the aggregate `fast-checks` status mandatory in those two Rulesets after the first PR checks have been observed on each target branch. Do not configure a required status context that has never been emitted for that branch.

The repository is maintained by a small set of contributors, so the Rulesets require PRs but do not impose a non-zero approving-review count. Review the diff and CI evidence before merging even when GitHub does not require a second reviewer.

## 5. Upstream synchronization and local GDNG policy

The scheduled `.github/workflows/sync-upstream-release.yml` watches published GDevelop releases and creates `automation/upstream-<tag>` candidate branches.

The workflow:

1. Resolves an upstream release tag and fetches that exact tag.
2. Merges it into a temporary branch based on `main`.
3. Stops without pushing when Git reports a conflict.
4. Runs GDNG CI and local-policy invariants before publishing the candidate branch.
5. Opens a PR into `main` and dispatches the candidate Windows build.

Upstream candidates are not auto-merged. Review the upstream diff, verify preservation of GDNG behavior and wait for the candidate build before merging. In particular:

- Preserve `LOCAL_FULL_FEATURES_ENABLED` and the focused local-policy tests.
- Do not restore upstream-only local editor limitations that GDNG deliberately removed for Free users.
- Keep cloud/server-side entitlements and API-provided limits unchanged; local editor policy must not impersonate server entitlements.
- Preserve the GDNG executable identity, updater/repository metadata, exact-commit build hand-off and cross-platform release artifact checks.
- Reconcile upstream CI changes with the GDNG-specific matrix; never resolve a CI conflict by blindly taking all of `ours` or `theirs`.

The branch protection and this workflow do not authorize direct pushes to the upstream repository. All GDNG-specific changes remain on `dev`, `test` or `main` according to the promotion path.

## 6. Merge and history policy

- Protected branches accept changes through Pull Requests only.
- Branch deletion and non-fast-forward updates are disabled by repository Rulesets.
- Topic PRs should use a clean, reviewable history; squash is appropriate for a single logical change.
- Promotion PRs should make the movement of an integrated candidate explicit. Preserve enough history and PR evidence to identify which candidate was promoted.
- Do not force-push a protected branch, disable a required check, or merge around a failed check.
- Delete a topic branch after its PR is merged, unless it is intentionally retained for an active follow-up.
- After merging a topic PR, return to `dev` and fast-forward it. Start the next unrelated task from a fresh topic branch.

## 7. Local clone setup and recovery

For an existing clone:

```powershell
git fetch origin --prune
git switch dev
git pull --ff-only origin dev
```

To create a new topic branch:

```powershell
git switch -c docs/<short-description>
```

To update a topic branch from the latest integration branch:

```powershell
git fetch origin
git switch dev
git pull --ff-only origin dev
git switch <topic-branch>
git rebase dev
```

Resolve conflicts on the topic branch. If a rebase becomes unsafe, use `git rebase --abort` and retry from a clean branch; do not repair the history of a protected branch.

For every PR and promotion, report the source branch, target branch, exact head SHA, completed CI checks, checks not run, and any remaining acceptance evidence. A green build, a merged PR and a tested product are distinct facts and must be reported separately.
