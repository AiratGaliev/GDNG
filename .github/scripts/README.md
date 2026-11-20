# Crowdin translation sync

This directory contains the reusable Crowdin API integration used by the translation workflows.

## Data flow

The workflows separate the one-time upstream seed from all subsequent translation operations:

1. **Automatic one-time GDevelop → GDNG seed.** Both standard translation workflows call `.github/workflows/sync-upstream-translations.yml` before doing any work on `main`. The reusable workflow imports only missing translations by exact gettext identity. A successful, verified run creates the Git tag `gdng-crowdin-seed-v1-complete`. The tag is the durable completion marker: later runs skip the seed and proceed directly to the normal pipeline. Job-level concurrency ensures that the Extract and Update workflows cannot run two seed imports at the same time. If the import fails, the marker is not written and the dependent standard workflow does not proceed; the next main-branch run retries the idempotent reconciliation.
2. **GDNG Crowdin → repository (Export API).** `download-crowdin-translations.mjs` exports the complete PO catalogs from GDNG project `948159` for each target language and installs them using the same `locale_with_underscore` paths declared in the unchanged `crowdin.yml`. `update-translations.yml` keeps the GDevelop order: extract source catalogs, download translations, compile with Lingui, verify the English catalog and open the translation PR. File-based Export API downloads avoid depending on a whole-project build permission.
3. **Source catalogs → GDNG Crowdin.** `extract-translations.yml` keeps the GDevelop trigger model: extraction runs on every branch and source upload runs only on `main`. On `main`, source upload is gated behind the successful one-time seed and still uses `crowdin upload sources` with the existing `crowdin.yml`.
4. **Crowdin parity audit.** `audit-crowdin-parity.mjs` compares upstream and GDNG project identities, language coverage, source phrase counts, translations and approvals. The audit itself uses GET requests only. Its mapped-language metrics exclude locales without a GDNG counterpart, avoiding misleading approval totals.

GDNG Crowdin is the source of truth for subsequent translation edits. Upstream reconciliation is additive: existing GDNG translations are not included in the import delta, regardless of whether they are approved or unapproved. Imported translations remain unapproved.

## Scripts

- `lib/crowdin-api.mjs` — shared authenticated API client, bounded timeouts/retries, safe handling of write retries, storage upload, import-report helpers and a bounded worker pool.
- `lib/crowdin-projects.mjs` — pinned GDevelop (`79367`, read-only) and GDNG (`948159`, write destination) identities plus fail-closed project guards.
- `audit-crowdin-parity.mjs` — read-only upstream/GDNG parity audit, pure language/catalog/progress comparison helpers, and the `--assert-upload-target` preflight used before the Crowdin CLI source upload.
- `lib/po-catalog.mjs` — strict gettext PO parser and phrase-level delta builder. Identity is the exact tuple of context, singular source text and plural source text. Duplicate identities or malformed PO syntax fail closed.
- `migrate-gdevelop-translations.mjs` — idempotent additive reconciler (source project `79367`, target project `948159`). It imports only missing translations for matching destination source entries and verifies each imported pair afterward.
- `download-crowdin-translations.mjs` — exports complete PO catalogs from GDNG project `948159` to the repository locale tree; it rejects a wrong project ID and missing per-file progress before installing any files.
- `tests/crowdin-api.test.mjs`, `tests/crowdin-isolation.test.mjs`, `tests/crowdin-migration.test.mjs` and `tests/crowdin-po-verification.test.mjs` — dependency-free Node.js tests for PO parsing/deltas, exact post-import form verification, progress completeness, dry-run defaults, bounded concurrency/retries, project isolation, locale aliases, phrase totals and approval metrics.

## Automatic one-time upstream seed

The seed workflow is reusable and is not an independently scheduled/manual operation. It is a mandatory prerequisite of both standard workflows on `main`:

- `extract-translations.yml` waits for the seed before uploading source catalogs to GDNG.
- `update-translations.yml` waits for the seed before exporting GDNG translations and creating the translation PR.
- Both callers share the concurrency group `gdng-upstream-crowdin-seed-v1`. The first obtains the lock, checks the completion tag and performs the import when the tag is absent. The other waits, then sees the tag and skips the import.
- The durable Git tag `gdng-crowdin-seed-v1-complete` is created only after the importer has checked both real Crowdin project identities, reconciled every supported file/language pair and verified the post-import destination exports. The tag is the one-time state; a GitHub Actions cache or expiring artifact is deliberately not used.
- If the job fails before creating the tag, the dependent workflow is blocked. A subsequent push or manual run on `main` retries the migration. Since the importer calculates a fresh delta and excludes every existing destination translation, a retry does not overwrite existing GDNG translations or approvals.
- The PR validation workflow runs the same importer with `DRY_RUN=true`, in addition to validating the Crowdin CLI configuration, dry-running source upload, downloading GDNG translations and compiling the catalogs. Pull-request validation never imports data into either project.

For each file/language pair, the importer:

1. Exports translated upstream PO entries and the full GDNG PO catalog (including untranslated source entries).
2. Matches source entries by gettext identity: `msgctxt` + `msgid` + `msgid_plural`. The projects have different Crowdin string IDs, so project-local numeric IDs are not used across projects.
3. Skips any upstream entry that has no exact source identity in GDNG. It does not create or mutate GDNG source strings.
4. Preserves every meaningful existing GDNG translation, including unapproved translations and approvals; entries whose non-empty text differs from upstream are counted as conflicts and left unchanged. Destination entries with empty `msgstr` values or values equal to their source text are treated as untranslated and may enter the delta. Any partially populated source or destination plural entry fails the pair closed; the workflow cannot write its completion tag until that case is explicitly reconciled.
5. Uploads the delta with `autoApproveImported=false`, waits for the asynchronous Import API operation, validates its report, then re-exports GDNG and verifies every imported non-source-equal singular/plural form matches the expected upstream text verbatim.

Source-equal translations are excluded because Crowdin skips them by default. Unmatched source identities are logged and not imported; they require source-catalog reconciliation rather than unsafe fuzzy matching. Duplicate PO identities, malformed catalogs, missing/duplicate progress rows, invalid progress metrics, zero source-key overlap, partially translated plural entries, failed imports and post-import text mismatches stop the workflow. The importer defaults to a read-only dry-run; writes require the trusted workflow to pass `DRY_RUN=false` explicitly.

Import concurrency defaults to four and is capped at six. Only explicit 429 rejections are retried for write operations to avoid duplicate operations after ambiguous failures.

### Explicit migration boundaries

The seed is a translation-data reconciliation, not a clone of the upstream Crowdin project. It transfers translated PO message forms only when the exact source identity already exists in GDNG. It does not create source strings, merge source catalog differences, copy original reviewers/approval records, or replicate project members, teams, webhooks, workflow configuration, parser settings or project-level policies. Upstream project APIs for members, webhooks, file-format settings and system placeholders return 403 for the current integration credentials, so those resources cannot be safely inventoried or mirrored. Upstream project configuration does not expose assigned glossary or translation-memory resources; the GDNG-owned glossary and TM are separate empty resources (0 terms and 0 segments). Imported translations deliberately remain unapproved because project-local approval records and reviewer identity cannot be safely recreated in GDNG. Existing GDNG translations and approvals are preserved.

A missing or duplicate Crowdin progress row is a hard error, never interpreted as zero translated strings. The seed also fails closed on partially translated plural entries and verifies that each imported non-source-equal form matches the expected upstream text before it can create the completion tag. The importer defaults to dry-run unless `DRY_RUN=false` is explicitly supplied by the trusted main-branch workflow.

## Project isolation and credentials

- `CROWDIN_PERSONAL_TOKEN` is required and must be stored in GitHub Actions Secrets.
- Project IDs are fixed in `lib/crowdin-projects.mjs`: upstream GDevelop is `79367` and is read-only; GDNG is `948159` and is the only permitted destination for source uploads and translation imports.
- Any supplied `SOURCE_PROJECT_ID`, `TARGET_PROJECT_ID` or `CROWDIN_PROJECT_ID` override is validated against the fixed identity. A value of `79367` is rejected by every GDNG write/download entry point.
- `extract-translations.yml` and `update-translations.yml` pin `CROWDIN_PROJECT_ID=948159` and never consume a project-ID secret. Extraction verifies the actual GDNG identity before `crowdin upload sources`; the regular downloader validates GDNG before requesting Export API jobs.
- The reusable seed workflow receives `contents: write` only to publish its completion tag. The Crowdin personal token is exposed only to the import step; upstream GDevelop remains read-only.
- The parity audit uses GET requests only. Phrase reconciliation creates temporary Crowdin Export API jobs to read source/destination PO files; these jobs do not update project content. Storage uploads, Imports API writes and source uploads are directed only at GDNG, never at upstream GDevelop.
- `CROWDIN_BASE_URL` can override the default public Crowdin API base URL for compatible environments.

No PO export files or API credentials are committed by these scripts.
