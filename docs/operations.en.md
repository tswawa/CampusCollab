# Deployment, use and recovery

[简体中文](operations.md) · [Home](../README.en.md)

2026-10-08. Run one application instance against one SQLite database. Maintenance acquires an exclusive database lease; stop the application before running maintenance commands.

The lease holds a SQLite kernel lock on `<database path>.lock/lease.sqlite` for the lifetime of the application or maintenance command. The operating system releases it after a crash. The directory and file remain in place; never delete, move or replace them to force a second instance to start. Use a local disk or a single-host local data volume. Network filesystem locking is outside the current validation scope.

## Deploy

Install Node.js 24.13.1 or a newer 24.x release, dependencies and build as described on the home page. Keep `.env` local to the operator, outside source archives and Git. Use `npm run dev` for development and run the compiled single-instance application directly with Node.

The minimum version fixes Windows `rmSync` handling of non-ASCII paths; see the [official release record](https://nodejs.org/en/blog/release/v24.13.1). Application and maintenance entry points reject unsupported runtimes before opening the database. Upgrade the runtime instead of relaxing this check.

1. After building, set `NODE_ENV=production`, the actual HTTPS `APP_ORIGIN` and institutional `SCHOOL_TIMEZONE` in `.env`. Enable `TRUST_PROXY` only behind a controlled reverse proxy: set it to that proxy's address (for example `127.0.0.1`, a CIDR range, or `loopback`); `true` means a proxy on the same host. Hop counts are not accepted.
2. Set independent persistent `DATABASE_PATH`, `UPLOAD_DIR` and `BACKUP_DIR`, keeping `API_HOST=127.0.0.1`. Do not store data under the build output directory `dist`.
3. Configure a deployment-owner `SETUP_TOKEN`. If omitted, the application creates `<database path>.setup-token` beside an empty database. Obtain it on the host and keep it private; the status endpoint, public pages and logs never expose it.
4. Run `npm start`. It loads `.env`, migrates the database and serves the compiled frontend. The default listener is `127.0.0.1:3000`; terminate HTTPS at the reverse proxy.
5. Check `/api/health`. The first browser visit opens `/setup`: choose the edition, institution, time zone and first administrator, then enter the setup code. Success signs the administrator in and permanently closes installation. Existing deployments cannot be claimed again. Chinese setup requires department, year and class by default; English setup makes these optional. Administrators may adjust registration requirements.

Alternatively, before first startup run `npm run admin:init` for trusted-host interactive setup. Web and CLI setup share the same one-time state. Administrators manage the institution edition in settings; all members use it after refreshing, as do notifications, email and exports. Authored content is not automatically translated.

Data persists in the configured paths. Use an operating-system account with only the required directory access. `ALLOW_INSECURE_COOKIE=true` is for isolated local production-build tests only. Never copy a real student database into a demo. Container files remain an optional path; Docker builds and tests were excluded at the owner's request, and native Windows results do not establish container validation.

## Use

**Coordinator:** Choose a template and confirm registration/submission deadlines in the institutional zone. Keep roster identifiers as text. Preview mappings, conflicts and duplicates before importing. Equal names are not merged and imports do not create accounts; existing-account binding is explicit.

The evidence workspace shows each person's state. Review a specific revision, request precise corrections and retain history. Confirm actual minutes independently from planned duration. Shared evidence supports individual confirmations; registration alone does not establish attendance.

Resolve every participant to a final outcome before closeout. XLSX preserves text identifiers; CSV is a text interchange format, but spreadsheet software can still guess cell types incorrectly. ZIP contains the roster, confirmed evidence and checksums. Reopen for corrections, then create a new snapshot; existing packages are not silently replaced.

**Participant:** Use the institution's selected edition. Submit the required evidence and review correction requests. Access is limited to personal evidence and authorized shared evidence.

**Administrator:** Approve coordinators and controlled external participants, configure institution policies and transfer task ownership. Former coordinators lose management access. Server, domain, backup and upgrade responsibility must also be handed over.

## Optional email

Use System settings → Notifications for channel status and sending records, and System settings → Data management for retention and closed tasks. The deployment owner configures the email connection. Routine lists omit internal identifiers; permanent cleanup requires the specific task ID during confirmation.

`MAIL_ENABLED=false` is the default; in-app notifications remain usable. To enable email, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `MAIL_FROM`, and matching `SMTP_USER`/`SMTP_PASSWORD` when authentication is required. Non-implicit TLS requires STARTTLS; certificate verification cannot be disabled through configuration.

Sending rechecks the current recipient, approval and task access. Administrators see pending, sending, SMTP-accepted and failed states. SMTP acceptance does not mean receipt or read status. An interrupted unknown result requires manual review before retry. `npm run mail:send` processes queued mail while the application is stopped. Do not publish raw SMTP errors or credentials.

## Back up, upgrade and recover

1. Stop the old application process. For a foreground process, use Ctrl+C and verify its port is no longer listening.
2. Use the **old compiled application** to run `npm run db:backup`. Backup does not apply migrations; it includes the database, attachments and migration list. Copy it to independent storage, separately preserving configuration and the old source/build artifacts.
3. Install the new version's dependencies, build and run `npm start`. Startup applies migrations. Check identities, tasks, evidence, packages and health.
4. To roll back, stop the application, restore the complete database and attachments using `npm run db:restore -- <backup-directory>`, and use the matching old build. Do not open a successfully upgraded database with old application code.

Source deployments follow the same stopped-backup/build/migrate/check sequence. Restore validates integrity, keeps a safety copy and invalidates old sessions. Backup sources and target data directories must not contain one another. `npm run files:cleanup` removes only expired temporary files with no evidence references.

Keep `BACKUP_DIR` and `UPLOAD_DIR` separate, with the database outside both. Before creating directories or opening the database, backup and restore reject equal or nested paths, including symbolic links and path aliases. Never put backups inside the upload tree. A restore source may be one backup inside `BACKUP_DIR`, but must not contain the safety-copy directory or overlap the target database or uploads.

When upgrading from the old PID lease, a graceful shutdown removes its JSON `<database path>.lock` file. If a crash leaves that file behind, the new version refuses startup rather than guessing from a PID in its current namespace. The deployment owner must stop and verify all applications and maintenance processes using the database, then back up and archive that old JSON file before starting the new version. The new `.lock` is a directory, not the old JSON file. Rolling back to a PID-only version likewise requires stopping every process before archiving the new lock directory as part of the rollback. Never move a lock while any instance is running.

## Retention and deletion

Administrators configure days after closeout, default 365. Closed tasks can be previewed; manual deletion requires expiry and no blockers. There is no automatic deletion. Deletion requires its exact task ID and a current preview. Open or recent tasks, evidence still referenced by another task, in-flight mail and unassigned historical notifications block deletion.

For reused evidence, purge an expired referencing task first. This removes that task's records and owned files while retaining the source task's revisions and images. Purge the source only after all references have been removed and its own retention period has expired. For chains of references, work from the last referencing task back toward the source; each preview rechecks the remaining references.

Purging removes that task's roster, evidence, snapshots, notices and related records while keeping accounts and minimal deletion audit. Failed file removal remains retryable. Historical backups and downloaded packages are outside this button's scope. Operators must enforce backup expiry and reapply approved deletion decisions after recovery.

## Limits and troubleshooting

A generic package is limited to 5,000 participants and 50MB of evidence; oversized exports fail explicitly. Images support JPEG/PNG/WebP up to 10MB each. Arbitrary attachments and automatic authenticity checking are not implemented. Referenced historical or reused files are protected from temporary cleanup.

On a conflict, retain your input, refresh and review the current version. Do not repeatedly approve. If startup fails, inspect configuration and database lease ownership rather than deleting locks to force concurrent access. Collect the error code, application version and an anonymized reproduction. Before public release, review branding provenance, CI, source download and actual institutional template acceptance.
