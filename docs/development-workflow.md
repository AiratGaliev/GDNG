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

## Upstream updates

The upstream sync workflow opens a PR from `automation/upstream-<tag>` into `main`. These PRs are not merged automatically. Review the diff, check that GDNG-specific behavior and release workflows are preserved, and wait for the required checks before merging.

Resolve conflicts deliberately. Do not accept either side of a conflict wholesale, especially for CI or release configuration.

## Branch and merge hygiene

- Protected branches accept changes through PRs; do not force-push or bypass required checks.
- Keep the PR history reviewable. Squash is suitable for a single logical change; promotion PRs should preserve clear candidate movement.
- Delete a topic branch after its PR is merged unless it is needed for active follow-up work.
- Start unrelated work from a fresh branch based on the latest `dev`.
