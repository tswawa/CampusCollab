# CampusCollab

**Publish campus tasks. Let students join. Review the work.**

[简体中文](README.zh-CN.md) · [Run locally](#run-locally) · [Documentation](docs/README.md)

[![CI](https://github.com/tswawa/CampusCollab/actions/workflows/ci.yml/badge.svg)](https://github.com/tswawa/CampusCollab/actions/workflows/ci.yml)

CampusCollab connects teachers who organize campus work with students who take part. Teachers publish tasks and set participation and submission requirements. Students find tasks, join, and submit their results. Teachers review the work, confirm participation time, and export the final records.

Each institution hosts its own instance and chooses English or Chinese during setup.

| Role | Workspace | Main actions |
| --- | --- | --- |
| Teacher / coordinator | Coordinator workspace | Publish tasks, manage participants, review submissions, export results |
| Student / participant | Participant home and task hall | Find tasks, sign up, track progress, submit work |
| Administrator | Admin console | Approve accounts, manage organizations and settings, transfer task ownership |

## 1. Sign in and open your workspace

Sign in with your account. CampusCollab opens the workspace assigned to your role.

<img src="docs/screenshots/showcase-en-login.png" width="420" alt="CampusCollab sign-in form" />

Teachers land on a workspace with a **Publish task** entry, task counts, and pending reviews. Students see their participation progress and links to available tasks.

<table>
<tr><th>Teacher / coordinator</th><th>Student / participant</th></tr>
<tr>
<td><img src="docs/screenshots/showcase-en-teacher.png" width="420" alt="Coordinator home with the publish task entry and current tasks" /></td>
<td><img src="docs/screenshots/showcase-en-student-home.png" width="420" alt="Participant home with personal progress and available tasks" /></td>
</tr>
</table>

## 2. Publish a task

Enter the task name, work description, location, and checklist. Choose an individual task or a group activity, then set the dates, places available, participation method, and required materials.

The four-step form takes the coordinator through task details, scheduling and evidence, contact details, and a final preview.

![Coordinator filling in a new campus task](docs/screenshots/showcase-en-create.png)

<details>
<summary>Participation settings and the final publishing preview</summary>

![Task dates, capacity, participation method, and required materials](docs/screenshots/showcase-en-create-rules.png)

![Final task preview before publishing](docs/screenshots/showcase-en-create-preview.png)

</details>

## 3. Students find a task and join

The task hall lets students browse, search, and filter available work. Opening a task shows the schedule, location, requirements, and available places.

![Student task hall with available campus tasks](docs/screenshots/showcase-en-hall.png)

<img src="docs/screenshots/showcase-en-detail.png" width="520" alt="Published task details with the action to join" />

A task can accept participants directly or collect applications for the coordinator to approve. Joined tasks appear in the student's own task list.

## 4. Submit the work

Students enter what they completed, record their time, and attach images where required. Here is the submission page for the task published above.

<img src="docs/screenshots/showcase-en-submit.png" width="420" alt="Student submitting the work for the task published in this walkthrough" />

## 5. Review participants and follow up

The coordinator's roster shows who has submitted, who needs a correction, and whose work is approved. Filter by status or search by name and ID. Existing CSV rosters can also be previewed and imported.

![Coordinator roster with submissions, corrections, and confirmed participation](docs/screenshots/showcase-en-roster.png)

A review can ask for a specific missing detail, such as the actual departure time. Each resubmission retains the earlier version and feedback. The coordinator approves a version and records the confirmed time; ready submissions can be reviewed in batches.

<details>
<summary>Submission versions and correction feedback</summary>

![Revision comparison, feedback, and confirmed participation time](docs/screenshots/showcase-en-review.png)

</details>

<details>
<summary>Shared materials for a group activity</summary>

For group activities, the coordinator adds a shared activity record and confirms each person's result and time. Personal submissions can be required alongside the shared record.

![Shared activity record and individual confirmation](docs/screenshots/showcase-en-group.png)

</details>

## 6. Close out and export

Download a CSV, an Excel workbook, or a ZIP containing the roster and approved materials. The roster preserves completed, withdrawn, and incomplete outcomes. Later corrections create a new completion version and retain the earlier record.

![Completion record with participant results and ZIP, XLSX, and CSV downloads](docs/screenshots/showcase-en-export.png)

## Administration

Administrators approve accounts, manage organizations and institution settings, transfer task ownership, and handle notifications and data retention.

<details>
<summary>Open the administrator overview</summary>

![Administrator overview with pending accounts, submissions, and recent tasks](docs/screenshots/showcase-en-admin.png)

</details>

The screenshots use fictional activity data and Harvard University as an example institution name.

## Run locally

Requires Node.js `>=24.13.1 <25` and npm.

```sh
git clone https://github.com/tswawa/CampusCollab.git
cd CampusCollab
npm ci
```

Copy `.env.example` to `.env`, then start the app:

```sh
npm run dev
```

Open [localhost:5173](http://localhost:5173). The API runs on port `3000`; database migrations run at startup.

On the first visit, choose the institution language, enter its details and time zone, and create the administrator account. Use the setup code from `SETUP_TOKEN` in `.env`, or read the generated `data/campus.sqlite.setup-token` file on the host when that setting is empty.

## Deploy

Configure `.env` with `NODE_ENV=production`, the public HTTPS `APP_ORIGIN`, and persistent database, upload, and backup paths. Then run:

```sh
npm run build
npm start
```

The server listens on `127.0.0.1:3000` by default. Use a reverse proxy for HTTPS. The [operations guide](docs/operations.en.md) covers configuration, backup, upgrades, and recovery.

## Development

Vue 3, Pinia, and Vant on the frontend; Fastify and Node's built-in SQLite on the backend.

```sh
npm run type-check
npm run test:api
npm run test:client
npx playwright install chromium
npm run test:e2e
```

- [Architecture and scope](docs/ARCHITECTURE.md#english-summary)
- [Contributing](CONTRIBUTING.md)
- [Product plan and research](PLAN.en.md)
- [Test coverage](docs/verification.md#english)
- [Security reporting](SECURITY.md)

## License

[AGPL-3.0-only](LICENSE). CampusCollab is derived from the ZVMS4 frontend and retains its [MIT copyright and permission notice](LICENSES/ZVMS-MIT.txt). See [NOTICE](NOTICE). Production builds include the corresponding source archive at `/source.zip`.
