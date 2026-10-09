# International adoption research and English product requirements

**Research cutoff: 8 October 2026 (Asia/Taipei). Status: research and implementation requirements; the English application is not yet implemented or deployment-validated.**

Chinese counterpart: [海外高校采用研究](international-adoption.zh-CN.md). See [PLAN.en.md](../../PLAN.en.md) and [PLAN.md](../../PLAN.md) for the implementation plan.

## 1. Recommended direction and evidence limits

Build a **community engagement completion workspace** for small university programs: a coordinator selects the required output, participants submit against a checklist, the coordinator resolves missing items and corrections, and the system produces a reviewable completion register and evidence pack. Keep the deployment boundary to one institution with a small organization operating it. This is not a paid-work marketplace, a university-wide academic-credit system, or an issuer of official transcripts.

This review checked first-party public material from six universities in four countries: the University of Toronto in Canada; King's College London, the University of Warwick, and the University of Chester in the United Kingdom; Sacred Heart University in the United States; and Adelaide University in Australia. It also checked GivePulse and Better Impact documentation and official material from W3C, IANA, the U.S. Department of Education, and the European Commission. There are 16 included sources.

The evidence establishes real workflows involving participation, records, human verification, reflection, and outputs. It does not establish purchase intent, prove that this project saves time, or support a global market-size estimate. The sample favors English-speaking environments and does not represent every university outside China. University instructions evidence institutional processes; vendor documentation evidences documented product capabilities. Neither is evidence that this project has been adopted or is effective.

**This is an established competitive market.** GivePulse and Better Impact already cover records, approval, and exports. The investment hypothesis is narrower: for one concrete completion workflow, make missing requirements, requested changes, accepted versions, and a reconciled final package work together with fewer administrative steps.

## 2. Observed workflows at six universities

Every source below was checked on **8 October 2026**. “Undated” means no explicit publication or revision date was identified; a search-engine crawl date is not substituted. Facts apply only to the linked material and the program it describes.

| ID, institution, source, and date | Type and observed facts | Transferable design lesson | What cannot be inferred |
|---|---|---|---|
| U01 · University of Toronto, Canada · [Co-Curricular Record](https://www.studentlife.utoronto.ca/service/co-curricular-record/) · Undated | Official service guidance. Folio supports the CCR; program organizers or student leadership confirm participation. Students can view and print records, and the CCR office verifies validated experiences. | Separate participant submission from organizational confirmation; identify the issuer of an output. | A file generated here is not a Toronto CCR. An open integration endpoint cannot be assumed. |
| U02 · University of Toronto, Canada · [Orientation Starter Pack validation](https://blogs.studentlife.utoronto.ca/lifeatuoft/2025/06/23/your-first-co-curricular-record-validation-starts-now-heres-how/) · Published and updated 23 June 2025 | Official Student Life process explanation. This program combines specified activities with a short reflection in Folio. | Requirements can include participation and reflection, rather than compulsory photo uploads. | This program's requirements are not a universal reflection policy across the institution. |
| U03 · King's College London, United Kingdom · [Record your volunteering](https://www.kcl.ac.uk/volunteering/record) · Undated | Official instructions. Students and staff participate; approval comes from the volunteer organization, an applicable line manager, or King's Volunteering. The workflow includes login, Log Hours, and submission. | Use participant, coordinator, and reviewer roles; a verifier need not be an instructor. | The same workflow cannot be assumed for every university unit; students' union activities have separate recording arrangements. |
| U04 · University of Warwick, United Kingdom · [Rewards and Recognition](https://warwick.ac.uk/about/volunteers/resources/accreditation/) · Last revised 27 August 2025 | Official program rules. Hours are checked with a project leader or contact. Only the current academic year counts, with volunteering itself making up at least 75% of total hours. Eligible participants can download a certificate; Warwick Award has a separate reflection step. | Make counting rules and verification responsibility explicit; recognition and activity status differ. | The ratio, academic-year boundary, and award thresholds are not general international rules. |
| U05 · University of Chester, United Kingdom · [How to record volunteering hours](https://volunteering.chester.ac.uk/lookingtovolunteer/loghours/) · Undated | Official instructions. Participants create a volunteer role, then add dated entries with a description and hours/minutes. Guidance includes travel time and excludes certain paid or credit-bearing activities. | Ongoing service needs repeated records, which differ from event registration; add them only when the scenario needs them. | Travel inclusion is not universal, and credit-bearing service learning should not automatically be excluded elsewhere. |
| U06 · Sacred Heart University, United States · [Adding an unlisted Impact in GivePulse](https://www.sacredheart.edu/media/shu-media/community-engagement/GivePulse_Adding_Personal_Impacts_Instructions_ADA.pdf) · Document undated | University-issued PDF instructions. An unlisted service activity can be entered as an Impact with a verifier's name and email; the form includes hours and sharing choices. | External verification requires a separate identity and authorization decision; evidence should not be shared with all members by default. | A historical instruction sheet does not establish current institution-wide configuration, user counts, or contract status. |
| U07 · Adelaide University, Australia · [Volunteer](https://adelaide.edu.au/partners-and-community/volunteer/) · Undated | Current university program description. It describes approximately 70 groups, each coordinated by a designated staff member across colleges, portfolios, or initiatives, and links to a live volunteer portal. | Program structure need not be faculty–year–class; coordination must be transferable. | The page does not establish every group's use of back-office features or quantify savings. |
| U08 · Adelaide University, Australia · [MyImpactPage public portal](https://app.betterimpact.com/PublicEnterprise/ebe1d2a7-935a-42b7-ad32-c561f7aa108d) · Undated | Actual Better Impact portal linked directly by U07. It lists student volunteering programs and explains separate applications, questions, and deadlines for different programs. | A scenario template can define application requirements and deadlines. | A public portal confirms the platform relationship and public application process, not use of every vendor reporting or hours feature. |

Exclusions: the old University of Adelaide `volunteercoordinatorshandbook2025.pdf` URL redirected to the current volunteering page during this review. Its search snippet was not treated as a fully inspected handbook. Toronto's current page uses Folio; older CLNx instructions were not treated as the current product workflow.

## 3. What existing platforms mean for this project

All sources below were checked on **8 October 2026**. These are vendor-documented capabilities, not a claim that any particular university has licensed or enabled all of them.

| ID, platform, source, and date | Type and facts | Transferable lesson | What cannot be inferred |
|---|---|---|---|
| P01 · GivePulse · [How to Export Data — Admin](https://support.givepulse.com/hc/en-us/articles/206172898-How-to-Export-Data-Admin) · Updated 27 April 2025 | Official help documentation. Administrators can export events, registrations, service records, and membership data, with column selection and filters, generally as CSV. U06 separately documents university verification instructions. | Basic export and verification are competitive baselines. Demonstrate fewer preparation steps for a particular completion package. | Plan restrictions, performance, APIs, attachment bundling, and this project's end-to-end advantage were not tested. |
| P02 · Better Impact · [Comprehensive Guide to Hours](https://support.betterimpact.com/en/articles/13160139-comprehensive-guide-to-hours) · Shows “Updated this week”; no absolute date supplied | Official help documentation. Hours relate to a person, activity, date, and duration. Scheduling and logged hours are separate; logged hours do not automatically prove attendance. Administrators can approve entries. | Distinguish planned duration, claimed minutes, approved minutes, and attendance evidence. | Recording, approvals, timeclocks, and exception handling cannot be presented as unique to this project. |
| P03 · Better Impact · [Comprehensive Guide to Reporting](https://support.betterimpact.com/en/articles/12082690-comprehensive-guide-to-reporting) · Absolute revision date not established | Official help documentation. It describes hours reports and exports, exclusion of unapproved hours from the described reports, and reconciliation issues caused by different aggregation rules. | Preview the selected population and provide totals that can be checked against detail. | Not every report, field, or license is necessarily identical; its usability was not tested. |

The strongest counterargument is that an organization already using an established platform may solve the problem by configuring its existing forms or reports. Another self-hosted application can add accounts, duplicate entry, and maintenance. Target organizations that have an independent completion workflow, an identified operator, and an existing toolset that cannot complete it simply. Open source, English support, or AI does not by itself overcome switching costs.

## 4. Current code and internationalization dependencies

This is static inspection of the current working tree, not production or end-to-end validation. Paths are relative to the repository root; line references reflect inspection on 8 October 2026. Old prototypes, old documentation, and modules not connected to the active entry point are not counted as delivered capabilities.

| Requirement | Observable current implementation | Required work and limit |
|---|---|---|
| General roles and optional identity fields | `shared/contracts.ts:1–22` uses student/teacher/admin and fixed department/class/grade fields. `RegisterPage.vue:53–60` requires institutional fields; SQL `001_initial.sql:58–73` also constrains them. | Change server authorization, contracts, migrations, and UI together. Renaming labels is insufficient. Separate login identity from external ID. |
| Complete English and Chinese | `src/main.ts` starts the mobile application. `src/mobile/utils/date.ts:10–17` returns Chinese date text; registration and server validation also include Chinese strings. | Internationalize the active mobile entry point. An i18n directory elsewhere does not establish support in the active application. |
| Time zones and DST | `server/config.ts:58` already defines SCHOOL_TIMEZONE. `server/db/models.ts:77–89` uses Temporal and zoned conversion; conversion calls do not specify an explicit ambiguity policy. | Reuse that foundation and add explicit handling for missing/ambiguous local times and bilingual display. Time-zone support is not entirely absent. |
| Per-person submission state | `tasks.service.ts:642–747` already handles personal text/image submissions and approval or requested changes. | Extend member workflows with template requirements, missing-item views, and corrections tied to specific requirements. |
| History and traceable completion | `tasks.service.ts:686–707` updates the existing submission on resubmission, clears feedback, and makes old attachments temporary. | Add retained versions, review events, and a final snapshot. Cleanup must respect version references; a history screen alone is insufficient. |
| Verified service time | The duration field in SQL `001_initial.sql:114` is text; scheduled times and member startedAt do not constitute approved service hours. | A service-hours template needs integer minutes, a basis, verifier, and verification time. A materials-only template can omit hours. |
| External communication | Notifications are currently in-app; `src/mobile/api/bootstrap.ts:54–56` refreshes on window focus. `NotificationsPage.vue` marks a notification read when clicked. | Add links to the specific task/correction. Support institution-configured email for operational use and copyable links. Do not assume delivery succeeded. |
| Completion package | The administrator JSON export in `server/modules/files-settings.ts` is not a participant evidence, verified-hours, and completion-register package. | Implement an authorized export for a fixed template; a backup JSON file is not a usable institutional workflow export. |
| Handover and operation | `tasks.service.ts:417–418` restricts actions to the task publisher, currently a teacher. Backup and restore scripts exist. | Add an auditable coordinator handover and revoke previous access. Deployment acceptance must still exercise backup and restore. |

## 5. English product and i18n requirements

These are proposed implementation requirements, not descriptions of current functionality. The first release provides functional parity in `en` and `zh-CN`. Product decision updated 2026-10-08: each institution selects one edition during installation and manages it through the admin console. This supersedes the research's earlier suggestion of individual locale preferences. Supporting these editions does not imply other languages, bidirectional layouts, or universal regional policy support.

| Area | Concrete requirement and acceptance focus |
|---|---|
| Product language | Describe the value as “Coordinate community activities, resolve missing submissions, and prepare a reviewable completion pack.” Do not translate the product into a paid-gig proposition or imply that volunteering automatically earns academic credit. |
| Roles | Use Coordinator, Participant, and Administrator. Reviewer is an authorized responsibility that a coordinator can perform. The first release need not contain a complex permissions engine, but staff and community volunteers must not register as “students.” |
| Organization | One deployment represents one institution, with optional units/programs/groups. Support organizations without faculties, entry years, or administrative classes. Do not build arbitrary-depth organization modeling in the first release. |
| Identity | Separate internal user ID, login credentials, and optional external ID. Store external IDs as text, preserving leading zeros, hyphens, and original case. Allow absence and define uniqueness scope. Administrator invitations or an authorized roster are initial entry options; email verification establishes mailbox control, not student status. |
| Names | Support a Unicode display name without requiring first/last-name splitting, Chinese characters, or at least two characters. Test long names, mononyms, spaces, hyphens, and diacritics. Explain the name source used in formal outputs. |
| Language and time zone | Store the institution edition separately from its IANA timezone. Administrator changes to the edition must not change deadline instants. Keep an explicit task timezone and show event-local time and zone. English must not imply America/New_York. |
| Dates and DST | Store instants in UTC and preserve event timezone. Keep date-only values as YYYY-MM-DD instead of converting UTC midnight across dates. Localize display. Reject nonexistent DST times with a useful message; require an explicit offset choice for repeated times. The first release may explicitly reject overnight events, but must not silently truncate them. |
| Minutes and counting rules | Store integer minutes to avoid floating-point accumulation. Separate planned duration, claimed time, and approved time. Templates define preparation, travel, and breaks. Unverified time remains pending; it does not silently become zero or completed time. |
| System messages | Localize pages, actions, empty states, validation, upload limits, email, notifications, export headings, administrator guidance, and accessible names. Switch third-party component date and upload messages too. |
| Error codes | APIs return stable machine codes and parameters; clients render them by locale. Do not branch on Chinese error strings. Unknown errors need bilingual fallback text and a support correlation ID, without raw stack traces. |
| User content | Preserve authored activity titles, reflections, feedback, and attachment names. Do not automatically translate accepted evidence or require transmission to an AI service. Generate system notifications in the institution's language while identifying original authored content where appropriate. |
| Notifications | Complete the workflow in a browser without WeChat accounts, SDKs, or mini-programs. Links preserve their destination through login. Email contains the action, deadline/timezone, and link rather than sensitive evidence. Show delivery failures and allow controlled retries. A copy-link-only demonstration must clearly disclose that email is not connected. |
| Exports | Use the institution edition and versioned fixed templates. Keep field identifiers stable while localizing headings. Include timezone, generation time, template version, confirmation status, and generator. Preserve text IDs, protect CSV/XLSX from formula injection, and handle duplicate or unusual attachment names deterministically. |
| Functional parity | English and Chinese support authentication/authorization, activity creation, joining, submission, corrections, review, finalization, export, and handover. Preserve drafts on language changes. An English landing page or participant screen alone is insufficient. |

Use IANA timezone data as the basis for time handling. Rules change, so operations must update the runtime's relevant data. [R02: IANA Time Zones](https://www.iana.org/time-zones)

## 6. Accessibility and adoption assessment

WCAG 2.2 AA is an engineering target, not an existing certification. Acceptance covers the complete core process with keyboard operation, visible focus, form labels and error location, announced status changes, adequate contrast, reflow, and status indicators that do not rely on color. Upload and review must not require dragging, a camera, or a mouse. Combine automated checks with manual keyboard and screen-reader checks; completing a checklist does not establish site-wide conformance. [R01](https://www.w3.org/TR/WCAG22/)

The following legal sources identify adoption questions; they are not legal advice or a compliance guarantee. Institutions must assess their activities, records, location, and relationships. The United States, United Kingdom, Canada, Australia, and Europe are not a single legal jurisdiction.

- **FERPA assessment:** For U.S. education records, determine record status, access/amendment procedures, and the basis for disclosure. If relying on an outsourced school-official exception, assess institutional control, use/redisclosure limits, and institutional criteria. Self-hosting alone does not satisfy those conditions. [R03](https://studentprivacy.ed.gov/faq/what-ferpa), [R04](https://studentprivacy.ed.gov/faq/who-school-official-under-ferpa)
- **GDPR assessment:** Where applicable, identify purpose and lawful basis, necessary fields, retention/deletion arrangements, access, processors, and cross-border services. Engineering defaults should minimize collection, restrict attachment access, and record exports. Do not promise that using the project establishes compliance. [R05](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en)
- **Evidence boundary:** The first template does not require identity documents, health information, or photographs of service recipients. Reflection can be text only. A photograph is evidence material, not guaranteed attendance. Deployment documentation identifies storage, backups, email services, and deletion coverage; the core workflow does not connect to external AI.

Official reference register; each was checked on **8 October 2026**:

| ID, source, and date | Type, fact, and adoption use | What cannot be inferred |
|---|---|---|
| R01 · [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) · Inspected version: 12 December 2024 | Official standard with testable accessibility criteria; used to define the target. | Existing components or this application are not thereby AA-conformant. |
| R02 · [IANA Time Zones](https://www.iana.org/time-zones) · Page has no overall revision date; listed release 2026e, 29 September 2026, when checked | Official timezone database description; rules change with regional policy. | The installed Node/browser runtime cannot be assumed to contain the same data version. |
| R03 · [U.S. Department of Education: What is FERPA?](https://studentprivacy.ed.gov/faq/what-ferpa) · Undated | Official explanation of education-record access, amendment, and disclosure rights; identifies assessment issues. | It does not classify every volunteer record as an applicable education record. |
| R04 · [U.S. Department of Education: school official](https://studentprivacy.ed.gov/faq/who-school-official-under-ferpa) · Undated | Official explanation of conditions for outsourced services under that exception. | A coordinator role label cannot replace legal analysis or contractual arrangements. |
| R05 · [European Commission: Principles of the GDPR](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en) · Undated | Official guidance on purpose, minimization, retention, and accountability; informs adoption review. | It does not automatically govern every deployment in the four sampled countries and is not a product certification. |

## 7. English example and acceptance criteria

**Example: Campus Community Garden Volunteer Session.** This is a synthetic demonstration, not an activity or official form from a researched university. The organization is a Community Garden Program within a Sustainability Office. A program staff member coordinates; participants may include students and staff. The deployment defaults to English, one participant uses Chinese, and the event timezone is `Europe/London`.

Fixed template `community-service-session/v1` requires a completion description, a short reflection, claimed service minutes, and coordinator confirmation. Photographs are optional by default. The demonstration counts actual service time and excludes travel; that is a sample rule, not a universal policy. Before claiming compatibility with an institution's form, obtain the form, version, and required fields and check a populated output.

Proposed demonstration:

1. The coordinator selects the template, publishes a two-hour activity, and invites eight fictional participants. External IDs may be empty; names include a mononym, diacritics, and Chinese characters.
2. Six submit. The coordinator approves five at 90 minutes each. The sixth needs a fuller reflection and receives a correction request for that requirement only. Two others show missing submission.
3. The sixth participant sees the specific reason, revises the reflection, and receives approval for 75 minutes. Preserve the initial submission, correction reason, resubmission, and review versions.
4. The coordinator closes the collection round. Finalizing the activity does not force the two missing participants into completed status. Distinguish activity finalization from individual completion.
5. After preflight, export six completion rows, their accepted evidence, an eight-person reconciliation list, and template/snapshot metadata. The approved total is **525 minutes**, not a multiplication of the planned two-hour duration by either six or eight people.

The proposed package contains `completion-register.xlsx`, `reconciliation.csv`, `evidence/participant-id/`, and `manifest.json`. The register uses approved data. The reconciliation list retains missing participants without awarding completion. Stable participant IDs organize attachments, with display names as supplementary labels. Versions and file digests help check package integrity; they do not prove attendance or truthful evidence.

| Acceptance ID | Required observation |
|---|---|
| INT-01 · Language parity | Run the same complete dataset in English and Chinese. Participation states, approved minutes, selected versions, and exported row counts match. |
| INT-02 · Inclusive identity | A staff participant with no class, an empty external ID, `00017-A`, a mononym, accented names, and Chinese names retain correct data. |
| INT-03 · Explicit time | Changing locale does not change the deadline instant. The event displays consistently in its institution timezone. Additional DST gap/overlap cases cannot silently select the wrong instant. |
| INT-04 · Targeted correction | The sixth participant sees only their own requirements and feedback. Revising reflection preserves other evidence. Original versions and the reviewer remain traceable. |
| INT-05 · Reconciled completion | Export six completion records, eight reconciliation records, and 525 minutes. Missing participants are not counted as completed. Outputs reconcile to the selected snapshot. |
| INT-06 · Access and handover | Participants cannot read others' attachments or export the full group. Coordinator handover revokes old access, enables the successor to continue review, and leaves a record. |
| INT-07 · Communication and privacy | Correction links target the right evidence; email failure is visible. No WeChat or AI transmission is required, and email excludes attachments and sensitive reflection text. |
| INT-08 · Operability | Keyboard and screen-reader use supports joining, submission, corrections, and review. Status is not color-only; long English text does not hide essential actions. |
| INT-09 · Efficiency validation | Compare the same synthetic task against a form-plus-spreadsheet workflow. Record follow-ups, manually copied fields, active handling time, and mismatches. Do not claim a savings percentage before measurement. |

These are future acceptance requirements; this research did not execute them. Earlier project test results apply only to the code actually tested and do not establish that English, templates, retained history, or verified hours have been implemented.

## 8. Investment order, alternatives, and stopping conditions

| Direction | Value | Cost and limitation | Decision |
|---|---|---|---|
| Public source and English developer documentation | Enables inspection, contribution, and adaptation at relatively low initial cost. | Coordinators still need technical help; published code is not a usable product by itself. | A release foundation, not a substitute for the complete experience. |
| A self-hosted product for a small organization within one institution | Offers control of data and deployment with a short workflow around one fixed completion template. | Requires an operator, backups, account support, and an upgrade path. Actual savings remain unmeasured. | **Recommended product direction.** |
| A complete university-wide platform | Could cover centralized identity, official recognition, institutional structures, and reporting. | Integration, procurement, security review, long-term support, and policy complexity increase substantially, with mature competitors. | Do not invest in this scope now. |

**Worth building now:** general roles and simpler identity, complete bilingual support in the active application, dependable time handling, one template's missing-item/correction/version/package workflow, controlled handover, basic email communication, and accessibility acceptance. If verified service time is the first international template, implement structured minutes in the same iteration. A materials-only template does not first need a full timesheet system.

**Scenario-dependent:** repeated service logs, external organization verifiers, automatic institutional roster synchronization, SSO, institution-specific forms, course associations, and additional restricted file types. Basic file-based roster import is already included in master-plan task T09; automatic synchronization here means integration with institutional identity systems. Merely entering an external email does not verify the person. Start from the institution's existing process before deciding on integration.

**Defer:** automatic academic-credit awards, official CCR/HEAR write-back, payroll or grants, automatic scheduling, general form/rule engines, multi-tenancy, native apps, social networking, AI acceptance decisions, and facial/location-based truth claims.

Continue when the implementation demonstrably removes work: a template produces a useful output without retyping essential fields elsewhere; missing items identify both the person and requirement; accepted versions are reproducible; and a successor coordinator can continue the process. Public evidence supports this bounded product direction. The unresolved question is how much time it saves a particular organization relative to operational cost.

Narrow or stop an extension when its first useful output depends on university-wide SSO or official recognition; the result package still requires retyping core fields; an existing platform configuration completes the same workflow; no organization will maintain the deployment; or the required sensitive evidence exceeds the project's governance capacity. If a template does not reduce mechanical coordination work, revise or abandon it rather than adding AI, more languages, or more features.

**This phase delivers research and planning documents only. It does not change the application, publish to GitHub, deploy a service, or process real participant data.**
