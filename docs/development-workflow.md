# Development workflow

This document describes the everyday contribution and promotion process for GDNG.

## Branches

| Branch | Purpose |
|---|---|
| `dev` | Integration branch for regular development |
| `test` | Integrated candidate for full validation and acceptance |
| `main` | Accepted release baseline |
| `master` | Frozen upstream snapshot; not a GDNG development branch |
| `automation/upstream-<tag>` | Temporary branch for an automated upstream update PR |

The normal path is:

`topic branch → dev → test → main`

Do not use `master` as a base for GDNG work. Upstream update PRs are the deliberate exception to the normal path: they target `main`.

## Start a change

Start from the latest `dev`:

```sh
git fetch origin --prune
git switch dev
git pull --ff-only origin dev
git switch -c feat/<short-description>
```

Use a short branch name that describes the change. Recommended prefixes:

- `feat/` — a feature;
- `fix/` — a bug fix;
- `refactor/` — a behavior-preserving code change;
- `chore/` — maintenance or tooling;
- `docs/` — documentation.

Keep each branch focused on one logical change. Before opening a PR, update it from the latest `dev` (merge or rebase) and rerun the relevant checks. Resolve conflicts on the topic branch, never by rewriting a protected branch.

## Pull requests

Regular feature, fix, refactor, maintenance and documentation branches target `dev`. Do not push directly to `dev`, `test` or `main`, and do not open ordinary feature PRs directly into `test` or `main`.

A PR should explain what changed and why, link the relevant issue when there is one, include or update relevant tests and documentation, and report the checks that passed or were not run. Keep unrelated changes in separate PRs.

## Validation and promotion

1. PRs targeting `dev`, `test` or `main` must pass the required `fast-checks` status. It provides the required PR checks; it is not the full cross-platform release validation.
2. Promote an integrated candidate from `dev` to `test` when the intended changes are ready for validation.
3. The push to `test` runs the full cross-platform validation. Perform functional, browser and manual acceptance against that exact `test` commit.
4. Promote the accepted candidate from `test` to `main`.

A successful build is not the same as functional acceptance. Record the tested commit and any known limitations so the accepted candidate is clear.

If validation or acceptance finds a defect, fix it on a new branch from the latest `dev`, merge the fix into `dev`, then promote the corrected candidate again. Do not patch `test` or `main` directly.

A normal push to `main` validates the candidate; it does not publish a release. See [GDNG project notes](GDNG.md) for the manual release-tag format and the automated upstream-release path.

## Localization

Crowdin is the source of truth for GDNG editor translations. Do not edit translated PO files, compiled locale catalogs, or translation metadata manually in the repository.

- Changes to translatable source code merged into `dev` trigger source extraction and upload to the GDNG Crowdin project. Topic branches do not upload strings.
- The localization sync runs daily (and can be dispatched manually). It exports the GDNG Crowdin catalogs, validates and compiles them, mirrors the compiled extension catalogs from the upstream `GDevelop-extensions` repository, and commits only `newIDE/app/src/locales/**` directly to `dev`.
- Localization synchronization does not create pull requests. The generated commit is promoted through the usual `dev → test → main` path.
- The direct commit uses a dedicated GitHub App. Store its Client ID in the repository variable `GDNG_LOCALIZATION_APP_CLIENT_ID` and its private key in the repository secret `GDNG_LOCALIZATION_APP_PRIVATE_KEY`. Install the App on this repository only, grant it `Contents: read/write`, and add this App as an `Always allow` bypass actor in the `protect-dev` ruleset. Do not add a bypass to `protect-test` or `protect-main`.

The bypass is required because `dev` enforces pull requests. It applies to the App identity at the ruleset level, not to a particular file path; therefore the workflow stages and commits only generated locale files, refuses any out-of-scope path, never force-pushes, and rebases against the latest `dev` before pushing. The workflow creates a short-lived installation token only after Crowdin export, PO/ICU validation, Lingui compilation and the English-catalog check have completed. The token is restricted to the GDNG repository and `Contents: write`.

## Upstream updates

The upstream sync workflow opens a PR from `automation/upstream-<tag>` into `main` and starts a Windows candidate build for that branch. These PRs are not merged automatically. Review the diff, check that GDNG-specific behavior and release workflows are preserved, and wait for the PR checks and candidate build to succeed before merging.

Resolve conflicts deliberately. Do not accept either side of a conflict wholesale, especially for CI or release configuration.

## Branch and merge hygiene

- Protected branches accept normal development changes through PRs. The dedicated localization token is the only exception on `dev`; it must not be configured as a bypass on `test` or `main`.
- Keep the PR history reviewable. Squash is suitable for a single logical change; promotion PRs should preserve clear candidate movement.
- Delete a topic branch after its PR is merged unless it is needed for active follow-up work.
- Start unrelated work from a fresh branch based on the latest `dev`.
