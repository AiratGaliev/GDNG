# Crowdin translation sync

This directory contains the reusable Crowdin API integration used by the translation workflows.

## Data flow

The workflows deliberately separate the upstream seed import from the normal GDNG translation sync:

1. **GDevelop → GDNG Crowdin (Imports API).** `migrate-gdevelop-translations.mjs` is a manual, resumable seed operation for bringing existing upstream GDevelop translations into the GDNG Crowdin project. It skips any destination file/language pair that already has translations, skips pairs with no upstream translations, and never approves imported translations. It is not the regular update mechanism and must not be scheduled as a recurring overwrite.
2. **GDNG Crowdin → repository (Export API).** `download-crowdin-translations.mjs` exports the complete PO catalogs from the GDNG Crowdin project for each target language. `update-translations.yml` runs this script, compiles the downloaded catalogs with Lingui and opens the translation pull request. It uses file-based exports rather than project builds, which avoids the Manager/Developer role requirement of the project-build download flow.
3. **Source catalogs → GDNG Crowdin.** `extract-translations.yml` remains responsible for extracting POT source catalogs and uploading them from the main branch.

GDNG Crowdin is the source of truth for subsequent translation edits. Upstream changes should be reconciled intentionally; do not blindly re-run the seed importer over populated destination catalogs.

## Scripts

- `lib/crowdin-api.mjs` — shared authenticated API client, bounded retries for transient failures, storage upload, PO helpers and bounded worker pool.
- `migrate-gdevelop-translations.mjs` — one-time/resume-only upstream importer (source project `79367`, target project `948159`).
- `download-crowdin-translations.mjs` — exports complete PO catalogs from GDNG project `948159` to the repository locale tree.
- `tests/crowdin-api.test.mjs` — dependency-free Node.js tests for PO parsing, bounded concurrency and retry behaviour.

## Manual upstream seed/import

The **Sync upstream GDevelop translations** workflow is manually dispatched. Set `dry_run=true` to list the missing file/language pairs without changing Crowdin. Run without dry-run only when intentionally seeding missing pairs.

Import concurrency defaults to four and is capped at six in the script. Each worker waits for its Import API operation to finish before starting another pair, keeping the number of active Crowdin imports below the project limit. Translations remain unapproved and existing destination pairs are preserved.

## Credentials

- `CROWDIN_PERSONAL_TOKEN` is required and must be stored in GitHub Actions Secrets.
- The project IDs are public identifiers and are configured in the workflow/script, not stored as secrets.
- `CROWDIN_BASE_URL` can override the default public Crowdin API base URL for compatible environments.

No PO export files or API credentials are committed by these scripts.
