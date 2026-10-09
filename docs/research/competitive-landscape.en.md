# Campus task collaboration: competitive landscape and open-source supply

> **Historical scope: this report preserves the research and project status from 2026-10-08, before implementation. See the [README](../../README.md) for current features and [LICENSE](../../LICENSE) for the current license. Statements below about work not yet implemented describe that earlier state.**

[中文](competitive-landscape.zh-CN.md) · [Product plan](../../PLAN.en.md) · [Market research](market-research.en.md) · [International adoption](international-adoption.en.md)

**Research cutoff: 2026-10-08 (Asia/Taipei).**

**Decision: continue toward a campus activity closeout product that starts with a required deliverable. The accepted direction is “choose the output template → bring in the existing roster → collect and correct each participant's materials → produce a roster, attachments and checklist corresponding to the accepted versions.” This is a planned specialized experience, not a demonstrated efficiency improvement or a capability that competitors categorically cannot provide.**

The project currently has local development and testing only, with no confirmed use by a teacher, department or laboratory. Its existing foundation includes staff-published tasks with multiple participants, direct claiming or applications, text/image evidence, staff acceptance or return, and organization/account administration. Template-driven closeout, existing-roster import, packages tied to accepted versions and complete organizational handover are goals; they must not be presented as already implemented.

## 1. Scope and evidence rules

This review used Chinese and English public searches, including GitHub/Gitee and WeChat mini-program leads, followed by accessible core code, official documentation, releases, concrete user issues, and institutions' own activity notices and policies. Eight representatives were selected for decision value. Similar names, README claims, stars and issues opened by a repository author are not evidence of adoption or market size.

Evidence labels:

- **Code**: implementation was inspected in the identified file and revision. This does not establish runtime correctness, reliable deployment or actual use.
- **Documentation**: a vendor's documentation, pricing or deployment material describes a capability. This does not mean it was exercised successfully in this review.
- **Institutional use**: an institution describes an actual process or reports activity data. This is not an independent audit or a statement about the whole sector.
- **Unknown**: the inspected evidence does not establish the answer. This does not mean a feature is absent.
- **Inference**: a conclusion drawn from the evidence, rather than a directly verified fact.

After the anonymous GitHub API was rate-limited, repeated API retries and login were not used. Some page contents were obtained through search indexing. Competitors were not deployed, operating costs were not measured, and commercial quotations were not obtained. Versions and pricing can change. The search did not exhaust every language, Gitee repository, institution-built platform or unpublished implementation; it cannot establish that no equivalent exists.

## 2. Three distinct layers of competition

1. **Nearby open-source campus task implementations** already cover publishing, claiming, progress and confirmation. The two codebases inspected most closely center on individual campus orders with one assignee. A method named `confirm` does not establish equivalence to a staff-led activity with separately reviewed submissions from many participants.
2. **Configurable self-hosted alternatives** such as NocoBase and Budibase can assemble collection, review, notification and export workflows. Configuration, operations and maintenance effort matter. Self-hosting and free unlimited users are not unique to this project.
3. **Products institutions already use**—WeChat Baoming Gongju, DaoMeng Space, Yiban/Yimiaomiao and Zhiyuanhui—occupy existing entry points, identities, communication habits or official recognition processes. They remain direct substitutes even when their source code is unavailable.

**The evidence does not support “nobody has built these functions.” A more defensible opportunity hypothesis is that this sample contains fewer ready-to-use, easy-to-operate, self-hosted open-source products dedicated to the final preparation of a specific institutional deliverable.** Limited coverage in a sample must not be promoted to an empty-market claim.

## 3. Eight representatives: product, licensing and deployment

| Representative | Audience and position | Verified licensing and openness | Deployment and price evidence |
| --- | --- | --- | --- |
| campus-errand | Campus order publishers and assignees; individual orders | The LICENSE at the pinned revision contains GNU GPL v2, while the README says MIT. This inconsistency prevents classification from the README alone.[License][CE-LICENSE] | Code is available for self-deployment. Actual minimum resources and ongoing operating cost are unknown. The v1.0 release says Redis/RabbitMQ were not installed in the described environment and notifications were unavailable.[Release][CE-RELEASE] |
| CampusGo | Campus order publishers and a single assignee | MIT at the pinned revision, with explicit copyright and license text.[License][CG-LICENSE] | Code is available for self-deployment. This review did not establish minimum resources, reliable notifications or maintenance cost through deployment. |
| NocoBase | Organizations and implementers building internal applications | The current LICENSE incorporates Apache-2.0 but gives supplementary terms precedence, including restrictions on interface branding and publicly offering low-code/AI SaaS/PaaS. It must not be labeled simply Apache-2.0, or classified using its former AGPL terms.[License][NC-LICENSE] | Community is free, with some capabilities in commercial plugins. Minimum 1 core/2 GB is for proof-of-concept use; 2 cores/4 GB is recommended. Data modeling, configuration and operation remain necessary.[Requirements][NC-REQ] |
| Budibase | Internal application builders, IT teams and implementers | The repository describes GPLv3 overall, MPL 2.0 for packages included in generated applications, and BSL for paid features in `packages/pro`. Package-specific terms matter; the entire feature set is not under one open-source license.[Licensing][BB-LICENSE] | Official Free self-hosting lists unlimited apps/users/actions/automations and one workspace; advanced capabilities are separate. Docker documentation recommends 2 cores/6 GB for most use. This is neither a quotation nor a performance guarantee.[Pricing][BB-PRICE] [Deployment][BB-DOCKER] |
| WeChat Baoming Gongju | Activity organizers and participants using WeChat | No source license enabling self-hosting was verified. It is compared as a commercial online product, not described as open source. | Official pages distinguish free features from VIP entitlements. No monetary estimate is inferred. Users do not operate the vendor's servers, but product rules and notification/export/retention limits apply.[Entitlements][BM-VIP] |
| DaoMeng Space (到梦空间) | Institutions, departments, student groups and students; co-curricular administration | Public source licensing and a self-hosted edition were not verified. | Institutional use is established. Contract pricing, institutional deployment arrangements and integration cost are unknown. A downloadable student app does not establish free institutional use. |
| Yiban / Yimiaomiao (易班/易瞄瞄) | Institutions, departments, classes and students; activities and participation records | Public source licensing and a self-hosted edition were not verified. | The official mobile introduction describes free use. Institutional pricing, procurement and operation arrangements remain unknown.[Introduction][YB-PRODUCT] |
| Zhiyuanhui (志愿汇) | Volunteer organizations, institutions and volunteers; enrollment, attendance and service records | Public source licensing and a self-hosted edition were not verified. | Institutional use is established. Institutional pricing, self-hosting and integration cost remain unknown. Student-side use does not establish that everything is free. |

## 4. Eight representatives: workflow and portability

| Representative | Organization / multiple participants | Individual materials, review and corrections | Notifications | Data export and limits of the evidence |
| --- | --- | --- | --- | --- |
| campus-errand | **Code**: several applicants may exist, but one `receiverId` is selected; this is not one task independently completed by multiple participants | **Code**: the assignee can post progress with an image, location and note; the publisher completes the order. The inspected path lacks an equivalent required-evidence review/return/resubmit state model | **Documentation**: dependencies were missing in the release environment; successful delivery cannot be assumed | Institutional result templates and individual closeout packages were not verified |
| CampusGo | **Code**: one `workerId` takes the order; institutional hierarchy and separate deliverables from multiple participants were not verified | **Code**: assignee completion enters `CONFIRMED`, then publisher confirmation enters `COMPLETED`; this path does not require an evidence payload | Not verified | Institutional result templates and per-participant attachment packages were not verified |
| NocoBase | **Documentation**: organizations and relations can be modeled; a Manual node has one assignee per invocation, which does not restrict the entire application to one participant | **Documentation**: manual forms, record creation/update, approve/reject and workflow branches; the required relations and states still need design. The commercial Approval plugin is distinct | Channel setup, authorization and delivery depend on configuration/plugins; no end-to-end validation was performed | Community includes basic Excel export. Organizing exported attachments by record is a commercial Standard+ plugin.[Manual node][NC-MANUAL] [Tables][NC-EXPORT] [Attachments][NC-ATTACH] |
| Budibase | **Documentation**: applications can use users, roles and records; campus capacity and per-participant relationships need modeling | **Documentation**: official expense/change examples include attachments, approval/rejection, reasons and status records; they are not an out-of-the-box campus closeout product | **Documentation**: examples include email notification; actual delivery depends on configuration | **Documentation**: record export to CSV/JSON; a consistent institutional roster-and-attachments package needs implementation.[Expenses][BB-EXPENSE] [Changes][BB-CHANGE] [Export][BB-EXPORT] |
| WeChat Baoming Gongju | **Documentation**: events, multiple registrations, capacity and administrators with permissions; this does not prove a full institution hierarchy | **Documentation**: required images/files, individual/bulk review, edits and resubmission after rejection, modification/review timestamps. An immutable per-attachment version chain was not verified | **Documentation**: subscription and broadcast notices; WeChat subscriptions require participant authorization. A complete item-specific correction notification flow was not established | **Documentation**: XLS, images embedded in a spreadsheet and ZIP files; one folder per submission, with nickname-based naming. The file-field guide states a maximum three-month attachment retention, so archival must follow current rules.[Attachments][BM-IMAGES] [Review][BM-REVIEW] [Editing][BM-EDIT] [Subscriptions][BM-NOTIFY] [Broadcasts][BM-BROADCAST] |
| DaoMeng Space | **Documentation / institutional use**: institution/department/group roles, capacity, direct registration, lottery or review-based selection | **Institutional use**: post-activity outcomes, attachments and organizer review. Reviewing an event's publication is not equivalent to per-participant correction/version handling | Native reminder coverage was not fully verified. Some institutions also use group chats; that does not establish absence of platform notifications | **Documentation / institutional use**: registration, attendance or achievement exports. Exact institutional attachment packages and version correspondence remain unknown.[Operations][DM-OPS] [Post-event evidence][DM-PROOF] [Results export][DM-EXPORT] |
| Yiban / Yimiaomiao | **Documentation**: institution/department/class structure; **institutional use**: activities with multiple participants over time | **Institutional use**: before/after labor photos, text, daily checking and feedback on invalid records. This establishes a performed process, not necessarily a native return/resubmit state machine | A complete notification loop was not verified | **Institutional use**: valid records are counted at completion. Standardized full attachment export and specific institutional result templates were not verified.[Example][YB-USE] |
| Zhiyuanhui | **Documentation / institutional use**: organization activities, participants, attendance and service records | Corrections largely concern service records. The inspected student guide says a rejected missed-sign-out correction cannot be reapplied for. Photos in social posts are not automatically task-delivery evidence | The per-person missing-item correction notifications required here were not verified | **Documentation**: organization exports have volume/field rules; institutions use exports for recognition. This does not establish staff acceptance packages tied to final evidence versions.[Student guide][ZY-STUDENT] [Organization guide][ZY-ORG] [Institutional use][ZY-USE] |

“Not verified” is a boundary of this review, not a list of product defects. Free/paid boundaries must be checked against the applicable version's official terms.

## 5. Deeper checks of the closest capabilities

### 5.1 campus-errand: image progress and publisher confirmation, centered on one assignee

Pinned revision: `bd8796f36d62b83bb07b23688dbe97b26c76402b`.

- `TaskServiceImpl.confirmTheRecipient` (approximately lines 824–880) lets the publisher select one applicant, sets one `receiverId`, and marks the other applicants as unselected.
- `TaskUpdatesServiceImpl` (approximately lines 186–239) lets the accepted assignee submit contact/pickup/delivery progress with an image, location and note.
- `TaskServiceImpl.updateToCompleted` (approximately lines 987–1038) lets the publisher complete and rate an accepted order. The inspected path does not separately accept evidence versions for every participant in a staff-led activity.

Evidence: [order service][CE-TASK] and [progress service][CE-UPDATES]. This refutes “campus tasks and confirmation have never been open sourced,” but does not make the products equivalent.

### 5.2 CampusGo: assignee completion followed by publisher confirmation

Pinned revision: `328746c26f75b5159a3e93cd3ba6ba73e0ea3673`.

In `TaskServiceImpl`, `acceptTask` assigns one worker, `completeTask` allows the worker to enter `CONFIRMED`, and `confirmTask` allows the publisher to enter `COMPLETED`. This establishes a two-sided confirmation sequence; the name `CONFIRMED` alone must not be read as final approval. The inspected methods do not require a materials payload or establish separate corrections for multiple participants. Evidence: [source code][CG-TASK].

### 5.3 Baoming Gongju and DaoMeng Space already cover substantial parts of the work

Baoming Gongju already covers collecting materials, reviewing, editing, exporting and folders per submission. DaoMeng Space also supports post-activity materials and review in actual institutional processes: Changchun Institute of Technology requires outcome submissions, organizer review and a further institutional review; Qingdao Huanghai University requires later uploads of book-review photos and borrowing screenshots. There is no basis for claiming this project first separates registration from outcome review.[Baoming Gongju][BM-IMAGES] [Changchun policy][CCIT-RULES] [Reading activity][DM-PROOF]

Conversely, China Agricultural University's Yantai institute requires completion and credit lists alongside team materials, and has a separate prescribed Excel template for a home-region practice program, with staff subsequently entering information into DaoMeng Space. This supports the existence of work after collection to prepare a particular deliverable; it does not prove that the incumbent platforms lack configurable solutions.[Institutional notice][CAU-CLOSEOUT]

## 6. Maintenance and adoption: what the signals establish

| Representative | Observed evidence | What it does not establish |
| --- | --- | --- |
| campus-errand | A 2026-08-14 v1.0 release describes MVP status, notification dependencies and future work; the inspected issue 1 was opened by the author | A release or author-created issue does not establish institutional adoption, an active external contributor base or sustained maintenance |
| CampusGo | Inspectable code and MIT text | No verified institutional adoption or sustained external maintenance evidence was obtained; this is not a claim that nobody uses it |
| NocoBase | Ongoing releases were observed, including v2.2.21 on 2026-10-06 | Active platform development does not validate a particular campus template or measure campus users |
| Budibase | v3.48.0 was observed on 2026-10-05; an external user's issue 18299 describes their self-hosted configuration and failure | This is a concrete external-use signal, not a count of institutional deployments, retention or commercial scale |
| WeChat Baoming Gongju | Shandong University's graduate volunteer-service rules require the relevant activities to use it | One explicit institutional policy cannot establish national share or complete automation |
| DaoMeng Space | Multiple institutional policies and activities; Jiangxi Tourism and Commerce Vocational College reports 99% activation, 6,353 events and 1.89 million participant-event occurrences in its annual summary | These are institution-reported figures; participations are not unique people, and event volume does not measure staff time saved |
| Yiban / Yimiaomiao | A 2026 Sichuan Agricultural University Food Science college activity reports 115 registrants and 705 valid records, with staff checking and counting records | This demonstrates activity-specific work, not automatic validity decisions or institution-wide retention |
| Zhiyuanhui | An institutional awards notice relies on exported records; Bengbu University reports 1,925 applications, 1,657 valid activities, 52,719 participations and about 128,000 hours for the preceding year | This establishes institutional use, not unique active users or paying customers |

Sources: [campus-errand release][CE-RELEASE], [NocoBase releases][NC-RELEASES], [Budibase releases][BB-RELEASES], [external user issue][BB-ISSUE], [Shandong University][BM-USE], [DaoMeng institutional report][DM-REPORT], [Yimiaomiao activity][YB-USE], [Zhiyuanhui institutional use][ZY-USE], and [Bengbu University][ZY-REPORT].

## 7. Adversarial assessment of A / B / C

| Candidate | Strongest objection | Decision |
| --- | --- | --- |
| A: staff closeout workspace | Required fields, pending review, returns, exports and per-person folders already exist. Renaming them is insufficient. If the incumbent already produces the required deliverable directly, another system adds work | **Primary direction, conditional**: start from the template, accept the existing roster, target corrections, and keep final output consistent with accepted versions |
| B: submit materials once and reuse them for different recognition processes | File reuse does not mean multiple authorities accept one approval. Different purposes may allow reuse or prohibit double counting. “Approved once, valid everywhere” is unsupported | **Later scope**: reference existing materials, but submit, review and recognize separately; retain source, intended use and version |
| C: organizational records that survive handover | Multiple administrators and history lists are common. Records can still become inaccessible if departing students leave nobody responsible for servers, domains or backups | **Part of the finished product**: transfer outstanding work, records, templates, permissions and operational responsibility; support complete export and restoration |

For B, Changchun Institute of Technology prohibits duplicate recognition for the same student's same project. This is an example of a specific rule, not a claim that all reuse is impermissible.[Recognition policy][CCIT-RULES] For C, Baoming Gongju already supports permission-based administrators and inviting past administrators. The opportunity concerns complete handover and recoverability.[Administrator guide][BM-ADMIN]

## 8. Recommended experience, validation and rejection criteria

Recommended positioning: **an activity closeout assistant for department, program or student-organization coordinators: establish the required deliverable, collect and correct each participant's materials, accept them, and hand over the finished package.**

The first release should support one or two templates with explicit sources, purposes and versions. Internationalization should allow changes to language, fields, dates and organizational terminology. A Chinese institutional template must not be treated as a universal requirement for universities elsewhere; see [international adoption research](international-adoption.en.md).

The smallest complete experience:

1. Choose the final purpose and output template. Show its applicability, required materials, fields and file-naming requirements.
2. Import the existing roster and associate materials using stable participant identifiers. Surface duplicates, missing identifiers and unlisted people explicitly; do not guess from nicknames.
3. Make missing items, corrections and pending reviews visible. Attach correction requests to the relevant items, so participants address what actually needs changing.
4. Accept a specific version. Changes made while an export is being prepared must not silently enter an already accepted package.
5. Generate the roster, corresponding attachments and a reconciliation checklist, with consistent people, statuses and versions. Clearly exclude or separately list incomplete participants.
6. Include outstanding work, archives, templates, access revocation, operational ownership and recoverable backups in organizational handover.
7. If a delivery channel is not connected or authorized, show the limitation and alternative entry point. A generated notification is not evidence that the participant received it.

Synthetic data can validate the mechanics now: start with 60 participants, 49 complete, seven missing materials and four awaiting corrections. Once the four corrected submissions are accepted, output a package for 53 people and a separate list of seven incomplete participants. Add duplicate names, repeated submissions, renamed files, unlisted people and rejected old versions; check whether manual rematching or renaming is still required. This is a proposed acceptance scenario, not a test performed in this review.

The [main plan](../../PLAN.en.md) uses eight people for the smallest bilingual demonstration; the 60-person dataset above can provide additional validation. A generic template is sufficient for development and preview. Label an institutional template as supported only after checking the recipient's actual fields, materials and naming requirements and validating the corresponding output. A generic demonstration alone establishes neither institutional acceptance nor an advantage from specialization.

To compare efficiency, have the same operator complete the same target deliverable from the same data using the incumbent workflow and the new workflow. Record manual matching/renaming operations, errors, steps and elapsed time. This can generate reproducible local evidence. Do not claim an unmeasured percentage of time saved, or substitute “find a teacher to try it later” for validation possible now.

**Conditions for rejecting or narrowing the scope:**

- The target institution's existing tool already produces the exact deliverable and the new product removes no extra steps.
- All participants must register, enroll or upload identical materials again, offsetting preparation savings.
- No explicit final template or recipient requirement can be identified, leaving only another generic form builder.
- Exports still need manual identity matching, renaming or decisions about which version is final.
- Most value comes from renaming and compressing files; a local utility may be a better solution than a complete multi-role platform.
- Every additional template requires core code changes, so reusable rules and template contributions cannot contain maintenance cost.
- Automated checks drift into authenticity, credit eligibility or payroll decisions without authorized rules and clear human responsibility.
- Installation, upgrades, backup/restoration and handover have no sustainable owner; self-hosting merely transfers work to the next student cohort.

## 9. The product value of AGPL open source

AGPL is a collaboration mechanism, not proof of demand or a technical moat. A new adopter should choose the project because it completes a defined closeout job, runs in their environment, lets them take their data away, supports editable templates and survives handover—not because of its frontend or backend framework.

Reusable open-source assets can include:

- Closeout templates with provenance and versions, field mappings and materials rules; contributors can add templates for their organizations.
- Anonymous or synthetic examples, expected outputs and consistency checks to verify each template.
- Stable evidence-version and export conventions, with a clear data migration path.
- Chinese and English operating/deployment documentation, upgrade/restoration exercises and maintainer handover instructions.
- Bounded extension interfaces so new notification channels or templates do not require duplicating the project.

Possible adoption failures include an adequate existing WeChat entry point, no installation/maintenance owner, excessive institution-specific customization, mandatory recognition in another platform, participant reluctance to submit twice, and discontinuous maintenance. These are inferences from the competitive structure; this project has no adoption data establishing their relative importance.

AGPL section 13 sets a Corresponding Source obligation for modified versions supporting remote network interaction. It does not prohibit commercial use or automatically require publication of students' uploaded data. Wording should follow the [official GNU AGPL text][GNU-AGPL], without expanding it into a claim that every related system must become open source.

**Licensing release gates:**

- The user has selected AGPL as the intended direction but has not chosen `AGPL-3.0-only` versus `AGPL-3.0-or-later`. The exact choice and consistent notices must be settled before release. This research does not decide that option for the user.
- On 2026-10-08, the local [LICENSE](../../LICENSE) still contains MIT with `Copyright (c) 2023 zvms`; the old README links to the [ZVMS frontend source][ZVMS-UPSTREAM]. Preserve applicable copyright and permission notices for reused MIT code and document provenance. Neither the old README nor LICENSE was changed in this task.
- The [official MIT text][MIT-OFFICIAL] requires preservation of its copyright and permission notice. Adopting AGPL at project level cannot erase provenance or establish that every file and dependency has been cleared.
- Before release, review the actual distributed files, dependencies and origins, and provide a source entry point corresponding to the release. A competitor's license description in this research is not a blanket authorization to copy its code.
- Payroll/payments, a general credit or service-hours recognition engine, replacement of institution-wide SSO, cross-institution universal approval and AI authenticity decisions do not become first-release commitments simply because the plan is comprehensive. Controlled material reuse under B is later scope; handover under C is a requirement of the finished product.

## 10. Source register

These are the principal original sources inspected. Pinned revisions allow code findings to be checked; product documentation, pricing and main-branch licenses may change. Institutional figures are the publishing institutions' reports. Repeated citations are not independent evidence.

### Open-source projects and configurable alternatives

- [campus-errand order service, pinned revision][CE-TASK]
- [campus-errand progress service, pinned revision][CE-UPDATES]
- [campus-errand LICENSE, pinned revision][CE-LICENSE]
- [campus-errand v1.0 release][CE-RELEASE]
- [CampusGo order service, pinned revision][CG-TASK]
- [CampusGo MIT LICENSE, pinned revision][CG-LICENSE]
- [NocoBase current license][NC-LICENSE]
- [NocoBase Manual node][NC-MANUAL]
- [NocoBase basic export][NC-EXPORT]
- [NocoBase attachment export plugin][NC-ATTACH]
- [NocoBase system requirements][NC-REQ]
- [NocoBase releases][NC-RELEASES]
- [Budibase package licensing guidelines][BB-LICENSE]
- [Budibase pricing and self-hosted entitlements][BB-PRICE]
- [Budibase Docker deployment][BB-DOCKER]
- [Budibase expense approval example][BB-EXPENSE]
- [Budibase change request example][BB-CHANGE]
- [Budibase data actions and export][BB-EXPORT]
- [Budibase releases][BB-RELEASES]
- [Budibase external self-hosting issue 18299][BB-ISSUE]

### Substitutes already used by institutions

- [Baoming Gongju image collection and folders per submission][BM-IMAGES]
- [Baoming Gongju review][BM-REVIEW]
- [Baoming Gongju editing and timestamps][BM-EDIT]
- [Baoming Gongju administrator permissions][BM-ADMIN]
- [Baoming Gongju subscription notifications][BM-NOTIFY]
- [Baoming Gongju broadcast notifications][BM-BROADCAST]
- [Baoming Gongju entitlements][BM-VIP]
- [Shandong University graduate volunteer-service rules][BM-USE]
- [Sichuan University of Science & Engineering DaoMeng operations material][DM-OPS]
- [Qingdao Huanghai University reading activity with later materials][DM-PROOF]
- [Huangshan University co-curricular results export and checking][DM-EXPORT]
- [Jiangxi Tourism and Commerce Vocational College annual summary][DM-REPORT]
- [Changchun Institute of Technology social-practice credit policy][CCIT-RULES]
- [China Agricultural University Yantai institute practice/template notice][CAU-CLOSEOUT]
- [Yiban mobile product introduction][YB-PRODUCT]
- [Sichuan Agricultural University Food Science college Yimiaomiao activity][YB-USE]
- [Zhejiang University Zhiyuanhui student guide][ZY-STUDENT]
- [China University of Petroleum-Beijing at Karamay Zhiyuanhui organization guide][ZY-ORG]
- [Anhui University of Technology volunteer recognition notice][ZY-USE]
- [Bengbu University volunteer work report][ZY-REPORT]

### This project's licensing and provenance

- [Official GNU AGPL v3 text][GNU-AGPL]
- [OSI MIT license text][MIT-OFFICIAL]
- [ZVMS frontend repository linked by the old README][ZVMS-UPSTREAM]
- [Existing local LICENSE](../../LICENSE)

[CE-TASK]: https://github.com/liulasty/campus-errand/blob/bd8796f36d62b83bb07b23688dbe97b26c76402b/src/main/java/com/lz/service/impl/TaskServiceImpl.java
[CE-UPDATES]: https://github.com/liulasty/campus-errand/blob/bd8796f36d62b83bb07b23688dbe97b26c76402b/src/main/java/com/lz/service/impl/TaskUpdatesServiceImpl.java
[CE-LICENSE]: https://github.com/liulasty/campus-errand/blob/bd8796f36d62b83bb07b23688dbe97b26c76402b/LICENSE
[CE-RELEASE]: https://github.com/liulasty/campus-errand/releases/tag/v1.0
[CG-TASK]: https://github.com/huangcancan-xbc/CampusGo/blob/328746c26f75b5159a3e93cd3ba6ba73e0ea3673/backend/src/main/java/com/campus/errand/service/impl/TaskServiceImpl.java
[CG-LICENSE]: https://github.com/huangcancan-xbc/CampusGo/blob/328746c26f75b5159a3e93cd3ba6ba73e0ea3673/LICENSE
[NC-LICENSE]: https://github.com/nocobase/nocobase/blob/main/LICENSE.txt
[NC-MANUAL]: https://docs.nocobase.com/workflow/nodes/manual
[NC-EXPORT]: https://docs.nocobase.com/interface-builder/actions/types/export
[NC-ATTACH]: https://docs.nocobase.com/interface-builder/actions/types/export-attachments
[NC-REQ]: https://docs.nocobase.com/get-started/system-requirements
[NC-RELEASES]: https://github.com/nocobase/nocobase/releases
[BB-LICENSE]: https://github.com/Budibase/budibase/blob/master/LICENSE
[BB-PRICE]: https://budibase.com/pricing
[BB-DOCKER]: https://docs.budibase.com/docs/docker
[BB-EXPENSE]: https://docs.budibase.com/docs/expense-approval
[BB-CHANGE]: https://docs.budibase.com/docs/change-requests
[BB-EXPORT]: https://docs.budibase.com/docs/data-actions
[BB-RELEASES]: https://github.com/Budibase/budibase/releases
[BB-ISSUE]: https://github.com/Budibase/budibase/issues/18299
[BM-IMAGES]: https://baominggongju.com/articles/form-image-collect/
[BM-REVIEW]: https://baominggongju.com/articles/batch-review/
[BM-EDIT]: https://baominggongju.com/articles/transfer-cancel-edit/
[BM-ADMIN]: https://baominggongju.com/articles/add-admin/
[BM-NOTIFY]: https://baominggongju.com/articles/subscribe-notifications/
[BM-BROADCAST]: https://baominggongju.com/articles/mass-notification/
[BM-VIP]: https://p.baominggongju.com/auth
[BM-USE]: https://ygb.sdu.edu.cn/info/1223/19702.htm
[DM-OPS]: https://webadm.suse.edu.cn/_s17/2021/1125/c351a42764/page.psp
[DM-PROOF]: https://www.qdhhc.edu.cn/tushuguan/p_detail.aspx?id=40738
[DM-EXPORT]: https://www.hsu.edu.cn/37/a0/c3718a210848/page.htm
[DM-REPORT]: https://www.jxlsxy.edu.cn/lsyw/8a386a2f336a499a9a0b9c1816a80597.htm
[CCIT-RULES]: https://tuanwei.ccit.edu.cn/info/1008/12622.htm
[CAU-CLOSEOUT]: https://yt.cau.edu.cn/art/2025/6/16/art_43337_1072713.html
[YB-PRODUCT]: https://www.y.yiban.cn/mobile/index.html
[YB-USE]: https://spxy.sicau.edu.cn/info/1471/116211.htm
[ZY-STUDENT]: https://yunfeng.zju.edu.cn/_upload/article/files/07/e7/0b2c07a246d4b7c5beda46e29587/ed4da282-031e-42fa-9697-43b85008e7f0.pdf
[ZY-ORG]: https://www.cupk.edu.cn/gqt/upload/resources/file/2023/10/09/79460.pdf
[ZY-USE]: https://tw.ahut.edu.cn/info/1023/2371.htm
[ZY-REPORT]: https://www.bbc.edu.cn/_t554/2026/0306/c20a125203/page.psp
[GNU-AGPL]: https://www.gnu.org/licenses/agpl-3.0.en.html
[MIT-OFFICIAL]: https://opensource.org/license/mit
[ZVMS-UPSTREAM]: https://github.com/zvms/zvms4-frontend
