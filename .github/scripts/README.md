# Crowdin translation sync

This directory contains the reusable Crowdin API integration used by the translation workflows.

## Data flow

The workflows deliberately separate the upstream seed import from the normal GDNG translation sync:

1. **GDevelop → GDNG Crowdin (Imports API).** `migrate-gdevelop-translations.mjs` is a manual seed/resume operation for reconciling translated source entries from upstream GDevelop with GDNG. It downloads the upstream translated PO and the complete destination PO, matches entries by the gettext source identity (`msgctxt`, `msgid`, and `msgid_plural`), and uploads only entries that exist in the destination catalog and still have no translation there.
2. **GDNG Crowdin → repository (Export API).** `download-crowdin-translations.mjs` exports the complete PO catalogs from GDNG project `948159` for each target language and installs them using the same `locale_with_underscore` paths declared in the unchanged `crowdin.yml`. `update-translations.yml` keeps the GDevelop order: extract source catalogs, download translations, compile with Lingui, verify the English catalog and open the translation PR. File-based Export API downloads avoid depending on a whole-project build permission.
3. **Source catalogs → GDNG Crowdin.** `extract-translations.yml` keeps the GDevelop trigger model: extraction runs on every branch and source upload runs only on `main`. The upload still uses `crowdin upload sources` and the existing `crowdin.yml`; a preflight verifies that the pinned destination is GDNG before upload.
4. **Crowdin parity audit.** `audit-crowdin-parity.mjs` compares upstream and GDNG project identities, language coverage, source phrase counts, translations and approvals. The audit itself uses GET requests only. Its mapped-language metrics exclude locales without a GDNG counterpart, avoiding misleading approval totals.

GDNG Crowdin is the source of truth for subsequent translation edits. Upstream reconciliation is additive: existing GDNG translations are not included in the import delta, regardless of whether they are approved or unapproved. Imported translations remain unapproved.

## Scripts

- `lib/crowdin-api.mjs` — shared authenticated API client, safe retries for GET and explicit 429 write rejections, storage upload, import-report helpers and a bounded worker pool.
- `lib/crowdin-projects.mjs` — pinned GDevelop (`79367`, read-only) and GDNG (`948159`, write destination) identities plus fail-closed project guards.
- `audit-crowdin-parity.mjs` — read-only upstream/GDNG parity audit, pure language/catalog/progress comparison helpers, and the `--assert-upload-target` preflight used before the Crowdin CLI source upload.
- `lib/po-catalog.mjs` — strict gettext PO parser and phrase-level delta builder. Identity is the exact tuple of context, singular source text and plural source text. Duplicate identities or malformed PO syntax fail closed.
- `migrate-gdevelop-translations.mjs` — manual upstream reconciler (source project `79367`, target project `948159`). It imports only missing translations for matching destination source entries.
- `download-crowdin-translations.mjs` — exports complete PO catalogs from GDNG project `948159` to the repository locale tree; it rejects a wrong project ID and missing per-file progress before installing any files.
- `tests/crowdin-api.test.mjs` and `tests/crowdin-isolation.test.mjs` — dependency-free Node.js tests for PO parsing, delta generation, bounded concurrency/retries, project isolation, locale aliases, phrase totals and approval metrics.

## Manual upstream reconciliation

The **Sync upstream GDevelop translations** workflow runs in two modes. Every push to the dedicated `ops/import-gdevelop-translations-once-20261119` branch automatically performs a read-only preview (`DRY_RUN=true`); it exports both catalogs and calculates the exact phrase-level delta for every source-non-empty file/language pair without creating storage objects or importing translations. Manual `workflow_dispatch` defaults to `dry_run=true`; set it to false only when intentionally running the additive import. The workflow pins the target to GDNG rather than taking a write destination from a repository secret.

For each file/language pair, the importer:

1. Exports translated upstream PO entries and the full GDNG PO catalog (including untranslated source entries).
2. Matches source entries by gettext identity: `msgctxt` + `msgid` + `msgid_plural`. The projects have different Crowdin string IDs, so project-local numeric IDs are not used across projects.
3. Skips any upstream entry that has no exact source identity in GDNG. It does not create or mutate GDNG source strings.
4. Preserves every existing GDNG translation, including unapproved translations and approvals. Only destination entries with empty `msgstr` values enter the delta. Partially populated plural entries are reported separately and left untouched because a file-level re-import could affect their existing forms.
5. Uploads the delta with `autoApproveImported=false`, waits for the asynchronous Import API operation, validates its report, then re-exports GDNG and verifies that no matched upstream translations remain missing.

Source-equal translations are excluded because Crowdin skips them by default. Unmatched source identities are logged and not imported; they require source-catalog reconciliation rather than unsafe fuzzy matching. Duplicate PO identities, malformed catalogs, zero source-key overlap, failed imports and post-import gaps stop the workflow.

Import concurrency defaults to four and is capped at six. Only explicit 429 rejections are retried for write operations to avoid duplicate operations after ambiguous failures.

## Project isolation and credentials

- `CROWDIN_PERSONAL_TOKEN` is required and must be stored in GitHub Actions Secrets.
- Project IDs are fixed in `lib/crowdin-projects.mjs`: upstream GDevelop is `79367` and is read-only; GDNG is `948159` and is the only permitted destination for source uploads and translation imports.
- Any supplied `SOURCE_PROJECT_ID`, `TARGET_PROJECT_ID` or `CROWDIN_PROJECT_ID` override is validated against the fixed identity. A value of `79367` is rejected by every GDNG write/download entry point.
- `extract-translations.yml` and `update-translations.yml` pin `CROWDIN_PROJECT_ID=948159` at job scope and never consume a project-ID secret. Extraction verifies the actual GDNG identity before `crowdin upload sources`; the regular downloader validates GDNG before requesting Export API jobs.
- `crowdin-integration-validation.yml` checks the unchanged CLI configuration, runs `crowdin upload sources --dryrun`, downloads the complete GDNG locale set and compiles it with Lingui on relevant same-repository PRs. It performs no Crowdin content writes and creates no PR.
- The parity audit uses GET requests only. Phrase reconciliation creates temporary Crowdin Export API jobs to read source/destination PO files; these jobs do not update project content. Storage uploads, Imports API writes, approvals, source uploads, file updates and project setting mutations are directed only at GDNG, never at upstream GDevelop.
- `CROWDIN_BASE_URL` can override the default public Crowdin API base URL for compatible environments.

No PO export files or API credentials are committed by these scripts.
