# CampusTask Product and Implementation Plan

[简体中文](PLAN.md) · [Documentation](docs/README.md) · [Market research](docs/research/market-research.en.md) · [Competitive landscape](docs/research/competitive-landscape.en.md) · [International adoption](docs/research/international-adoption.en.md)

Version 1.7. Updated 2026-10-09. **Bilingual tasks, rosters, submission review, completion exports and institution administration are implemented, and the source is published on GitHub.** See [verification](docs/verification.md) for the test scope and [Actions](https://github.com/tswawa/CampusTask/actions) for each commit's CI results. Institutional use, live email delivery, current institutional template acceptance and manual screen-reader checks remain unverified. Responsibilities and exclusions are documented in [architecture](docs/ARCHITECTURE.md).

The objective is to develop the existing multi-participant task system into a self-hosted open-source product. Starting with task publication or an imported roster, it should support participation, evidence collection, corrections, review, closeout and handover, producing a roster, evidence and confirmation records that match. Initial users are departments, campus service teams and community engagement programs with recurring work, together with campus developers who can operate and adapt the product.

The project uses AGPL, with the same feature scope in Chinese and English. All core recommendations appear in the stages below; sequencing describes dependencies. There is no recorded institutional adoption. Public research informs the direction, but this project's adoption and time savings have not been measured.

## Product scope and release goals

The project is named 校园任务通 in Chinese and CampusTask in English. Its repository is [tswawa/CampusTask](https://github.com/tswawa/CampusTask), and its npm package name is `campustask`. Each institution deploys independently under its own domain.

| Release level | Required outcome | Current status |
| --- | --- | --- |
| Planning delivery | Bilingual master plan, demand and competitor evidence, international research and acceptance criteria | D00 complete |
| Core preview | One complete Chinese and English task-to-closeout workflow, generic template, roster import, correction history and matching completion package | Implemented; verification recorded separately |
| Usable bilingual 1.0 | Core preview plus group confirmation, recorded hours, exception outcomes, notifications, handover, retention, deployment recovery and publication preparation | Locally implemented; formal release gates remain |
| Subsequent adaptations | Evidence reuse by reference, validated institutional template packs, identity and data adapters supported by concrete interface requirements | Reuse and historical template preview implemented; current institutional acceptance and SSO require concrete requirements |

The adopting institution defines whether work occurred, which hours are eligible and who can award formal recognition. Evidence completeness, task approval, coordinator-confirmed hours and institutional recognition are separate facts. They must not share a single completion flag.

Payments, payroll, financial-aid eligibility, a general credit conversion engine, an institution-wide data platform, a cross-campus marketplace, facial or AI verification and native apps are outside this 1.0. Adding these areas later requires a separate scope, data responsibility model and acceptance criteria.

## Evidence and product decisions

| Evidence and limitation | Product decision | Tasks |
| --- | --- | --- |
| [Guangzhou College of Technology and Business's complaints and response](https://www.gzgs.edu.cn/yzs/info/1006/2343.htm) identify incomplete materials, verification and cross-department review delays; software is not the only cause | Define evidence requirements early, expose missing items, request specific corrections and show progress | T03, T11, T12, T19 |
| [Nanjing University's submission requirements](https://sfs.nju.edu.cn/dqjs/tw/20260420/i382529.html) require organizers to assemble several types of materials | Support shared and individual evidence and a complete handover package | T14, T16, T17 |
| [Shandong University's rules](https://ygb.sdu.edu.cn/info/1223/19702.htm) use a registration tool followed by a fixed import template; the original spreadsheet has not been obtained in this review | Accept existing rosters; verify institutional mappings individually; generic exports must not be called institution-compatible | T03, T09, T17 |
| [Dalian Vocational Technical College's rollout report](https://www.dlvtc.edu.cn/web/guest/detail?articleId=39503007-27C3-24BD-E7ED-19FDEEB34550) documents a similar task model, without measured time savings | Retain task publication, participation and per-person review, and improve result handling | T10 through T18 |
| [Baominggongju](https://baominggongju.com/articles/form-image-collect/) already collects images and packages files by submission | Differentiate through consistent rosters, requirements, corrections and approved versions across the whole workflow | T09, T12, T16, T17 |
| [NUIST's procurement rationale](https://bulletin.nuist.edu.cn/info/1004/42236.htm) emphasizes existing identities, habits and integrations | Support small organizations and return results to existing processes; keep adapters bounded | T04, T09, T30 |
| International institutional and platform sources appear in the [international review](docs/research/international-adoption.en.md) | English must have feature parity; roles, organization, time and communication must be adaptable | T04 through T08, T19, T24, T30 |

## Pre-development baseline (historical)

The maintained application uses Vue 3, Pinia and Vant with Fastify, TypeScript and SQLite, principally in `src/mobile`, `server` and `shared`. Current responsibilities are described in [architecture](docs/ARCHITECTURE.md), and runtime checks in [verification](docs/verification.md). The table below preserves the pre-development capabilities and gaps that informed the task list.

| Existing capability | Gap and implementation area |
| --- | --- |
| Three roles, accounts, organization catalogs and coordinator approval | The [user schema](server/db/migrations/001_initial.sql) requires students to have a class and year; international configuration needs a migration, not just hidden fields |
| Direct participation or application, capacity checks, multiple participants and individual review | [Shared contracts](shared/contracts.ts) and the [task service](server/modules/tasks.service.ts) need rejection, withdrawal, incomplete outcomes and distinct closeout semantics |
| Text and image submissions, revision requests and optimistic version checks | [Submission handling](server/modules/tasks.service.ts) replaces the existing content and attachment links; it does not preserve full history |
| Image access controls and temporary-file cleanup | New versions and shared evidence must be designed together with cleanup, authorization and backup; arbitrary document attachments are not currently supported |
| In-app notifications | The [notification page](src/mobile/pages/shared/NotificationsPage.vue) lacks task navigation; [bootstrap](src/mobile/api/bootstrap.ts) includes fixed Chinese messages |
| Administrative business JSON export | The [export implementation](server/modules/files-settings.ts) lacks complete participant and evidence records; it is neither a completion package nor a disaster-recovery backup |
| Migration and backup/restore scripts | [Migration loading](server/db/database.ts) requires source SQL at runtime; operational scripts in [package.json](package.json) depend on the development dependency tsx |
| An institutional time-zone field, UTC fields and a Temporal dependency | A foundation already exists; daylight-saving transitions, regional formats and identical deadlines for different-language users still need verification |

The table describes historical gaps, not the current capability list. See [verification](docs/verification.md) for subsequent implementation checks. Node requires `>=24.13.1 <25`; runtime delivery includes compiled maintenance programs and every SQL migration. The original `001_initial.sql` is unchanged.

## Core product workflow

1. A coordinator selects a template, defines deliverables, enrollment and submission deadlines, and a review mode. Copying a task must not copy participants or private evidence.
2. Participants enroll in the system, or the coordinator imports an existing roster. Importing a row must not automatically create a login or grant a role.
3. Participants submit individual evidence where required. For group activities, a coordinator uploads shared evidence and confirms participation; individual supplements depend on the template.
4. A roster-based workspace distinguishes not submitted, missing items, awaiting review, changes requested, confirmed and exception outcomes. Completeness does not automatically imply approval.
5. Correction requests identify a field or attachment. A new submission creates a new version. Review targets a specific version; resubmission during review must cause a conflict or invalidate the obsolete review attempt.
6. The coordinator confirms the closeout scope. A snapshot includes outcomes for every participant, including incomplete and withdrawn records.
7. Exports include results, approved evidence versions, a reconciliation checklist and necessary confirmation details. Later corrections create a new version with an explicit supersession relationship.
8. Organization handover transfers outstanding work and responsibilities, preserves history and revokes former members' access. An exported file does not automatically constitute institutional certification.

## Data and architecture constraints

- Retain a single-institution, single-instance SQLite deployment. Add numbered migrations rather than rewriting an already-applied `001_initial.sql`. Verify migrations against copies, never by experimenting on the user's active `data` directory.
- Model participation separately from login identity. Current `task_members.user_id` is required; importing unregistered people needs a participation identity and an auditable account-binding process. External identifiers are text with an explicit source and uniqueness scope. Do not merge by name or nickname.
- Fixed templates include an ID, version, source, purpose, evidence items, field mappings, naming rules and expected output. Tasks retain their selected template version; template updates must not silently change existing requirements.
- Preserve submission versions, review events, correction items and attachment references. Migrate old records as the latest visible pre-migration version; do not invent missing history or review timestamps.
- Retain attachments according to all valid references. Cleanup must not delete files referenced by historical submissions, shared evidence or closeout snapshots. Shared evidence remains subject to authorization.
- Separate closeout from individual completion. Define state transitions, seat effects, notifications and export meanings for cancellation, application rejection, withdrawal, incomplete outcomes and approval.
- Store actual duration as integer minutes with confirmation evidence, separate from planned times and participant-reported duration. Corrections retain old values, actor, time and reason. Do not automatically award credit or calculate pay.
- Batch review retains per-record version checks and reports each outcome. Partial success must not appear as complete success.
- Generate exports from a consistent closeout snapshot, including template and result versions, generation time, counts and file associations. File-integrity checks prove correspondence, not that an activity really occurred.
- Start with constrained template configuration and a few import mappings. Do not accept executable template code or build a general workflow engine first.

## Chinese English and international adaptation

Both editions share one implementation and data model. The first release supports `zh-CN` and `en`, chosen by the administrator during installation and subsequently managed in institution settings. Keep user-authored task and evidence content in its original language; do not automatically send it to a translation service.

The institution edition governs component libraries, page titles, HTML `lang`, API errors, notifications, email and exports. Members have no personal language switch; browser storage, request headers and legacy user preferences cannot override the institution. Export template versions remain explicit, and translated headers must not alter fixed institutional fields. Verify both editions with the same business fixtures.

### Admin-console requirements

1. Add one-time installation state and a protected setup endpoint. Create the institution and first administrator atomically; test old databases, repeated/concurrent setup, rollback and rejected setup codes.
2. Implement a three-step setup wizard and institution-wide editions. Remove page-level language switches; administrators choose between two edition cards in settings.
3. Provide a desktop sidebar, mobile navigation drawer and compact toolbar. Console metrics and links use real account, task and pending-work data.
4. Put participant counts, filtering, the roster and review actions first in the coordinator workspace; organize requirements, imports and results by task order.
5. Check both editions at 1440, 768 and 390 pixels, including keyboard interaction and real review actions. Verify browser setup and edition propagation, using fictional demonstration data.
6. Record implementation, tests and release limitations in both languages. Before an upgrade, preserve the matching application version, database and attachments.

Each institution runs its own application and database. This iteration does not add shared tenancy, tenant selection or subscription billing. Setup requires a deployment-owner code, closes permanently after success, and cannot claim existing institutional records.

| Area | Requirement | Acceptance focus |
| --- | --- | --- |
| Roles | Use Participant, Coordinator and Administrator; preserve migration compatibility and existing permission semantics | Non-faculty staff can coordinate without gaining additional privileges |
| Organization | Configurable institution, unit and grouping; class and year optional; external participation controlled by the institution | No fabricated class or Chinese-style student number required |
| Identity | External IDs are text; names support Unicode, spaces, hyphens and single names; email is not a universal identity key | Leading zeros, duplicate names, absent student numbers and account-binding conflicts |
| Text | Localize pages, forms, validation, empty states, accessibility labels, dates, email, notifications and exports | Key parity and no unexplained fixed Chinese in English workflows |
| Server | Stable error codes and parameters; localized display messages; notifications contain event type, parameters and target with legacy support | Language changes preserve meaning; historical notifications remain readable |
| Time | Store definite instants and an institutional IANA time zone; language must not change time zone; show the zone during creation | Reject or explicitly disambiguate nonexistent or repeated local times; deadlines remain consistent |
| Formatting | Use regional date and number formats; make export units and time zones explicit; preserve external IDs as text cells | Ambiguous dates such as `03/04`, leading zeros and long multilingual names |
| Communication | In-app notifications and copyable links are the common baseline; optional institution-configured email; no WeChat or QQ dependency | Core work remains usable without email or after delivery failure |
| Accessibility | WCAG 2.2 AA is an engineering target covering keyboard, focus, labels, errors, contrast and zoom | Automated checks plus manual keyboard and screen-reader critical paths; no claim of certification |
| Data governance | Configurable retention and documented access, export and deletion processes with operator responsibilities | No real student data in demos or logs; the institution assesses applicable privacy rules |

Terminology: use Join task or Sign up for participation, Apply for an application, Submit evidence, Changes requested, Confirmed, Close out task and Completion package. Use Coordinator-confirmed hours by default. Verified service hours requires the applicable institution's rules and authorized confirmation.

Reference: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/). Institutional privacy and governance differences are discussed in the [international review](docs/research/international-adoption.en.md). These documents do not assert FERPA, GDPR or other regulatory compliance.

## Work packages and dependencies

The table preserves task contracts and dependencies; actual status appears in the progress section and [verification](docs/verification.md). S means localized work, M a feature spanning layers, and L a migration or work across several business modules. These are relative sizes, not delivery-date estimates. Written code does not imply that every release gate has passed.

| ID | Work package | Dependencies | Size | Completion criteria |
| --- | --- | --- | --- | --- |
| D00 | Save bilingual plans and all three research reports | None | M | Complete documents, checked citations/local links and equivalent language scope |
| T01 | Preserve the implementation baseline and use a safe development branch | D00 | S | Inventory existing edits; use a `codex/` branch or suitable isolated worktree without losing untracked implementation |
| T02 | Prepare AGPL and provenance inventory | T01 | M | Review upstream, dependencies and assets; choose the exact SPDX option; prepare license, attribution and source-link changes |
| T03 | Define fixed templates and acceptance fixtures | D00 | M | Generic template plus a field contract for at least one real institutional template; inaccessible originals remain unverified |
| T04 | Design participation identity, organization and migrations | T01, T03 | L | Separate accounts and roster records, optional organization levels, state model, migration and recovery fixtures |
| T05 | Establish language resources and terminology | T01 | M | Chinese/English resources, selection and fallback, key-parity checks; no new fixed business messages |
| T06 | Internationalize API errors and notifications | T04, T05 | M | Code/parameter contracts, event notifications and historical-message compatibility |
| T07 | Verify time zones and regional formats | T04, T05 | M | Institutional zones, daylight-saving transitions, cross-date tasks and bilingual display tests |
| T08 | Adapt registration, organization settings and controlled enrollment | T04, T05 | M | Chinese and international configurations work; role and binding permissions are verified |
| T09 | Import and preview rosters | T04, T08 | L | Column mapping, invalid rows, duplicate IDs/names, leading zeros, idempotence and visible conflict resolution |
| T10 | Create and copy template-based tasks | T03, T04, T05 | M | Fixed evidence rules and versions; copies exclude private records; existing enrollment remains usable |
| T11 | Preserve submission versions and attachments | T04, T10 | L | Traceable versions, safe cleanup, consistent permissions, quotas and backup references |
| T12 | Request targeted corrections and compare changes | T06, T11 | M | Specific missing-item feedback, limited edits, visible differences and previous comments |
| T13 | Build roster workspace and batch review | T09, T11, T12 | L | Locate missing/review/revision/confirmed records; per-record conflicts; usable Chinese/English desktop and mobile views |
| T14 | Support group confirmation and shared evidence | T10, T11, T13 | M | Shared evidence links authorized participants; individual supplements optional; absent members are not auto-approved |
| T15 | Record and confirm individual actual duration | T04, T13 | M | Planned, self-reported and confirmed duration separated; corrections traceable; export units explicit |
| T16 | Close exception outcomes and create closeout snapshots | T11, T13, T14, T15 | L | Rejected/withdrawn/incomplete records terminate clearly; counts reconcile; corrections create new snapshots |
| T17 | Generate spreadsheet and evidence packages | T03, T16 | L | CSV/XLSX, ZIP and checklist share a snapshot; stable generic format and validated mappings |
| T18 | Deliver the complete eight-person bilingual demo | Applicable dependencies T05 through T17 | M | Six complete and two incomplete records reconcile; each result row matches the approved evidence |
| T19 | Add notification navigation, change alerts and email | T06, T12, T16 | M | Authorized deep links, time/place alerts, copyable announcements and visible optional-email failures |
| T20 | Transfer responsibility and revoke access | T04, T11, T16 | M | Administrator-controlled handover, original attribution retained, former access revoked and outstanding work preserved |
| T21 | Implement retention and controlled deletion | T11, T16, T20 | L | Verifiable retention periods, deletion scope, backup expiration and audit-metadata rules |
| T22 | Deliver production deployment and upgrades | T01, T04, T11 | L | Single-instance native Node path, migration resources, persistent data directories, operational commands and recovery |
| T23 | Write bilingual usage and operations documentation | T18, T19, T20, T22 | M | Installation, participant/coordinator workflows, templates, backup, upgrades and troubleshooting |
| T24 | Verify accessibility and browser behavior | T18, T19, T20 | M | Bilingual keyboard/screen-reader critical paths, mobile and desktop layouts |
| T25 | Complete authorization, export and migration acceptance | T17, T20, T21, T22 | L | Evidence of access isolation, matching exports, legacy migration, restoration and capacity limits |
| T26 | Prepare GitHub release and contribution entry points | T02, T23, T24, T25 | M | Current README, demo, attribution, issue/PR templates, CI and source-availability instructions |
| T27 | Complete bilingual 1.0 delivery checks | T18 through T26 | M | All release checks pass, limitations documented and binaries/releases match source |
| T28 | Reuse evidence by reference | T11, T20, T21, T27 | M | Explicit selection, authorization, pinned versions and independent review for each purpose; no inherited approval |
| T29 | Enable institutional template contributions | T03, T17, T23, T27 | M | Version, source, anonymous fixtures, expected output, maintainer and compatibility notes |
| T30 | Add identity and external-result adapters | T04, T17, T27 | L | Implement only documented official interfaces or template contracts; reconcile conflicts, retries and recognition sources |

Execution order: D00 → T01/T03/T05 → T04 and T06 through T08 → T09 through T18 → T19 through T27 → T28 through T30. T02, T22, documentation drafts and accessibility design may run in parallel earlier. One integration owner coordinates migrations, shared contracts and reference models to avoid incompatible definitions on separate branches.

The core preview must not be presented as completion of 1.0. Both languages are part of each feature's definition of done, not a final translation of the home page.

T03 has two gates. A generic template contract and fictional fixtures are sufficient to start foundational work such as T04 and T10. Institutional adaptation requires the actual recipient's field, evidence and naming requirements, checked against the original template and expected output. Until that second gate passes, the institutional part of T03 remains pending and the preview is labeled generic. It does not validate the proposed specialized advantage or establish that the institution will accept the output directly.

## Acceptance matrix

| ID | Scenario | Required observations |
| --- | --- | --- |
| A01 | Eight fictional people: five ready, one needing a correction, two not submitted | After review, six complete; the roster still has eight; two appear in the incomplete list; fixtures are visibly fictional |
| A02 | An administrator changes the institution edition for the same task | Permissions, seats, states, evidence and instants stay unchanged; refreshed member interfaces, messages and exports use the institution language |
| A03 | US/UK formatting and an institutional zone with daylight-saving changes | The deadline is consistent; nonexistent or repeated local times are not silently interpreted |
| A04 | Duplicate names, leading-zero IDs, missing IDs and repeated imports | No mistaken merges, lost zeros or duplicate participation; conflicts are resolved explicitly |
| A05 | Resubmission during review and one changed record in a batch | Obsolete versions are not approved; each conflict and successful outcome is reported |
| A06 | Cleanup after corrections followed by export and restore | Evidence referenced by history or snapshots remains available; expired unreferenced files follow policy |
| A07 | One shared item for a group activity | No forced duplicate uploads; participant scope and responsibility are traceable; unrelated users cannot read it |
| A08 | Rejection, withdrawal, absence, missing submissions and cancellation | States, capacity and exports remain correct; closeout does not mean everyone completed |
| A09 | Correct results after an export | Old packages retain version identity; new ones record supersession; obsolete evidence is not mixed in |
| A10 | Coordinator departure or account disablement | An authorized administrator can transfer work; former access is revoked and attribution retained |
| A11 | Email absent or delivery fails | In-app work remains complete; a send request is not reported as receipt by the recipient |
| A12 | Upgrade a legacy database and recover from a failed upgrade | People, tasks, evidence and permissions survive; the restored database, files and matching application work |
| A13 | Export safety and different roles | Export scope respects permissions; CSV/XLSX inputs do not execute formulas; file names cannot escape export paths |
| A14 | Keyboard, screen reader, zoom and mobile use | Enrollment, submission, correction, review and download work with understandable errors and stable focus |
| A15 | Reference evidence for another purpose | The new purpose receives independent review; revocation/deletion policies work; old approval does not transfer |

Run risk-appropriate type checks, API tests, client tests, builds and Playwright end-to-end tests using the existing npm scripts. Performance evaluation uses a fixed fictional dataset and records concurrency, participant counts, attachment sizes, hardware and timings. Do not promise large-scale concurrency or a fixed percentage of saved time before measuring it.

Compare the old workflow and the new one using identical fixtures. Record duplicated fields, page changes, per-person downloads/renaming, mismatches and active operator time. Measure human judgment about authenticity separately. Public research supports the problem choice; this comparison tests whether the implementation actually removes mechanical work.

The international review provides a synthetic [Campus Community Garden Volunteer Session](docs/research/international-adoption.en.md) fixture and INT-01 through INT-09: six of eight people complete, two have no submission, and confirmed duration totals 525 minutes. T18 also uses this fixture to verify that confirmed duration is not calculated by multiplying the scheduled two hours by the participant count.

## Deployment and open-source delivery

The delivery path is one native Node `>=24.13.1 <25` instance with persistent SQLite and attachment directories. A controlled reverse proxy provides HTTPS. Builds, browser workflows and process recovery were locally verified on Windows; these results do not establish validation on Linux or other deployment environments. See [deployment and use](docs/operations.en.md) for development and compiled execution.

Include runtime SQL migration files. Operational commands must run inside the final distribution without relying on tsx removed by `--omit=dev`. Document backup consistency and whether the service must stop, as well as the database, attachment and configuration scope. Credentials do not belong in public examples or research documents.

The project uses `AGPL-3.0-only`, with aligned LICENSE, package metadata and NOTICE. ZVMS's original MIT notice is preserved in `LICENSES/ZVMS-MIT.txt`. Builds provide the corresponding `/source.zip` and license links. Default icons are project-created assets; see [asset notes](public/ASSETS.md) and the [dependency review](docs/dependency-review.md). Institution names in screenshots are examples and do not imply use or endorsement.

The GitHub repository includes bilingual README files, fictional demo data, feature boundaries, screenshots, installation and upgrades, a template contribution example, issue entry points, security reporting instructions and CI. [The source is public](https://github.com/tswawa/CampusTask), and private vulnerability reporting is enabled; see [SECURITY](SECURITY.md). CI runs on pushes and pull requests, with results recorded per commit. Source publication does not establish production deployment or institutional adoption.

## Risks and recovery

| Risk | Prevention and recovery |
| --- | --- |
| Many existing uncommitted and untracked implementation files | Inventory and preserve them first. An isolated worktree does not automatically copy them; do not develop against a legacy baseline missing `server` or `src/mobile` |
| Lost historical submissions cannot be reconstructed | Migrate only the latest visible version with source metadata; retain a consistent pre-migration backup rather than fabricate history |
| Templates become unlimited customization work | Begin with a generic template and a small number of verified institutional templates; incomplete mappings are not labeled compatible |
| Additional accounts and repeated uploads offset the benefit | Accept existing rosters, coordinator-entered records and shared evidence; measure duplicate entry |
| Restored files and database versions do not match | Back up consistently; restore the full package and matching application; do not depend on blind downgrade scripts |
| Retention requirements conflict with immutable history | Retain necessary event metadata while deleting or redacting content under an explicit policy; include backup lifecycles |
| Notification providers or template rules change | Version events and templates, maintain historical compatibility, and show actual delivery/adaptation status |
| Existing institutional tools already complete the workflow | Compare a concrete process; if the only benefit is file renaming, reduce scope to a preparation tool rather than expand a platform |

## Completed work and remaining validation

- [x] D00 and T01: Bilingual plans and research are available, with the development baseline and pre-change backups preserved.
- [x] T02: AGPL licensing, upstream MIT attribution, default asset provenance and the build's source archive are documented.
- [x] T04 through T16: Participant identities are separate from accounts. Institution settings, shared language editions, time zones, roster imports, templates, submission history, corrections, batch review, group evidence, individual time confirmation and closeout snapshots are implemented.
- [x] T17 and T18: Generic CSV/XLSX/ZIP exports and evidence correspondence are verified. Both eight-person language fixtures preserve the complete roster and individual outcomes.
- [x] T19 through T23: In-app notices, optional email, coordinator handover, controlled retention cleanup, native Node deployment and recovery, and bilingual operations documentation are implemented. Email state and failure handling are tested; live SMTP delivery remains a separate check.
- [x] T25 local verification: Type checks, builds, backend, client and browser tests passed in the environment described in [verification](docs/verification.md). Coverage includes permissions, admission and corrections, historical evidence references, image ownership, exports, migration and recovery, and session expiry.
- [x] T28 and T29: Evidence reuse selects a specific source version and requires separate review for each purpose. Template contributions include sources, versions, anonymous examples and expected outputs.
- [x] Administration interface: One-time setup, institution-wide language, desktop sidebar and mobile drawer, roster workspace, actual statistics, separate notification and data settings, and paginated closed-task records are implemented.
- [ ] T03: Generic templates and historical institutional previews are implemented. Current original forms and the target institution's field, evidence, naming and acceptance requirements still need confirmation.
- [ ] T24: Manual screen-reader checks remain necessary for critical paths on the target browser and assistive-technology combinations.
- [x] T26: Source, bilingual documentation, screenshots, contribution channels and private vulnerability reporting are available. GitHub Actions is configured; check [Actions](https://github.com/tswawa/CampusTask/actions) for each commit's results.
- [ ] T27: Check the release commit, build and corresponding source, and resolve the remaining acceptance items before release.
- [ ] T30: Official identity and external-result adapters need concrete interfaces or template contracts. Official SSO is not implemented.
- [ ] Real-world validation: Institutional use, live SMTP delivery, current template acceptance, large-scale performance and time savings have not been measured.

Future interface acceptance checks whether users can find pending work, identify missing items and complete processing. Keep input constraints, recovery guidance and consequential confirmations at the relevant action. Complete remote CI and manual accessibility checks, then validate deployment, email and template acceptance against a specific institution's process. The HFUT 2018 workbook is a historical mapping example with a documented calculation ambiguity, not a statement of the institution's current requirements.

For each completed item, record its date, commit or file scope, verification commands and results, recovery point and remaining limitations, updating this plan and the Chinese version together. Implementation details do not require repeating all research. Changes to target users, formal recognition or core data responsibility require an updated product decision and corresponding acceptance criteria.
