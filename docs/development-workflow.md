# Development workflow

This document describes how to contribute changes to GDNG.

## Branches

| Branch | Purpose |
|---|---|
| `dev` | Integration branch for regular development |
| `test` | Validation and acceptance of an integrated candidate |
| `main` | Accepted release baseline |

The `master` branch is a historical upstream snapshot. Do not use it as a base for GDNG work.

## Everyday changes

Start from the latest `dev`:

```sh
git fetch origin --prune
git switch dev
git pull --ff-only origin dev
git switch -c feat/<short-description>
```

Use a short branch name that describes the change, for example `feat/`, `fix/`, `chore/` or `docs/`.

Open a pull request from the topic branch into `dev`. Keep each pull request focused and include relevant tests and documentation. Do not push directly to `dev`, `test` or `main`.

## Validation and promotion

1. Pull requests targeting `dev`, `test` or `main` must pass the required `fast-checks` status.
2. Promote an integrated candidate from `dev` to `test`. The full cross-platform validation runs on the resulting `test` commit.
3. Perform functional and manual acceptance against that exact `test` commit.
4. Promote the accepted candidate from `test` to `main`.

A push to `main` runs validation; it does not publish a release. Releases are published by pushing a `gdng-vX.Y.Z` tag or by merging an approved upstream-update pull request.

If validation finds a defect, fix it on a new branch from the latest `dev`, then promote the corrected candidate again. Do not patch `test` or `main` directly.

## Upstream updates

Upstream GDevelop updates are prepared automatically as pull requests into `main`. They are not merged automatically. Review the changes, check that GDNG-specific behavior is preserved and wait for the required build and validation checks before merging.

For GDNG-specific behavior and local checks, see [GDNG project notes](GDNG.md).
