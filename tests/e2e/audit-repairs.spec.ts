import { expect, request, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { Temporal } from '@js-temporal/polyfill'
import sharp from 'sharp'
import type { CampusTask, CampusUser, CreateTaskPayload, PageData, SchoolProfile, SessionData, UploadData } from '../../shared/contracts.js'
import type { ConfigureWorkflowInput, RosterImportPreview, TaskWorkflow, WorkflowParticipant } from '../../shared/workflow-contracts.js'

// Every setup request uses the real compiled service and ordinary authenticated endpoints.
// Separate API sessions avoid repeatedly consuming the production login rate allowance.
type Actor = { http: APIRequestContext; session: SessionData; origin: string }
const actors: Actor[] = []
const password = 'E2E@Browser123'
let admin: Actor
let teacher: Actor
let student: Actor

async function login(baseURL: string, account: string, value = password): Promise<Actor> {
  const http = await request.newContext({ baseURL })
  const anonymous = await http.get('/api/auth/session')
  const session = (await anonymous.json()).data as SessionData
  const response = await http.post('/api/auth/login', { headers: { Origin: baseURL, 'X-CSRF-Token': session.csrfToken }, data: { account, password: value } })
  expect(response.status(), await response.text()).toBe(200)
  const actor = { http, session: (await response.json()).data as SessionData, origin: baseURL }
  actors.push(actor)
  return actor
}
async function api<T>(actor: Actor, path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await actor.http.fetch(`/api${path}`, { method, headers: { Origin: actor.origin, 'X-CSRF-Token': actor.session.csrfToken }, ...(method === 'GET' ? {} : { data: body ?? {} }) })
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBeLessThan(400)
  const result = await response.json()
  expect(result.ok).toBe(true)
  return result.data as T
}
async function showAs(page: Page, actor: Actor, path: string) {
  await page.context().addCookies((await actor.http.storageState()).cookies)
  await page.goto(path)
}
async function school(patch: Partial<SchoolProfile>) {
  const { logo: _logo, ...current } = await api<SchoolProfile>(admin, '/school')
  return api<SchoolProfile>(admin, '/admin/school', 'PUT', { ...current, ...patch })
}
function payload(title: string, capacity = 2): CreateTaskPayload {
  const date = Temporal.Now.zonedDateTimeISO('Asia/Shanghai').toPlainDate().add({ days: 4 }).toString()
  return { title: `${title} ${Date.now()}`, categoryId: 'category-device', campusId: 'campus-main', description: 'Fictional activity for browser regression checks.', checklist: [], date, startTime: '14:00', endTime: '16:00', signupDeadline: `${date} 12:00`, place: 'Fictional activity room', duration: '120 minutes', capacity, audienceScope: 'school', requirements: [], proofTypes: ['text'], claimMode: 'direct', contacts: [] }
}
const flowPath = (id: string) => `/tasks/${id}/workflow`
const flow = (id: string, actor = teacher) => api<TaskWorkflow>(actor, flowPath(id))
function configInput(current: TaskWorkflow, patch: Partial<ConfigureWorkflowInput>): ConfigureWorkflowInput {
  const { status: _status, ...config } = current.config
  return { ...config, ...patch }
}
async function claim(id: string) {
  await api(student, `/tasks/${id}/claim`, 'POST')
  return (await flow(id, student)).participants[0]!
}
async function submit(id: string, person: WorkflowParticipant, extra: Record<string, unknown> = {}, actor = student) {
  return api<TaskWorkflow>(actor, `${flowPath(id)}/submit`, 'POST', { participantId: person.id, version: person.version, description: 'Completed the fictional activity and recorded the result.', note: '', fileIds: [], ...extra })
}
async function importRoster(id: string, count: number) {
  const input = { source: `audit-${id}`, rows: Array.from({ length: count }, (_, i) => ({ externalId: `R${String(i + 1).padStart(4, '0')}`, name: `Audit Person ${i + 1}` })) }
  const preview = await api<RosterImportPreview>(teacher, `${flowPath(id)}/import/preview`, 'POST', input)
  expect(preview.valid).toBe(true)
  return api<TaskWorkflow>(teacher, `${flowPath(id)}/import`, 'POST', { ...input, hash: preview.hash, idempotencyKey: `browser-${id}` })
}
async function expand(details: Locator) {
  if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click()
  await expect(details).toHaveJSProperty('open', true)
}

test.beforeAll(async ({ baseURL }) => {
  expect(baseURL).toBeTruthy()
  admin = await login(baseURL!, 'E2EADMIN')
  teacher = await login(baseURL!, 'E2ETEACHER')
  student = await login(baseURL!, 'E2ESTUDENT')
})
test.beforeEach(async () => { await school({ defaultLocale: 'zh-CN' }) })
test.afterAll(async () => { for (const actor of actors) await actor.http.dispose() })

for (const language of ['zh-CN', 'en'] as const) {
  test(`expired correction keeps reused images through real mobile and review pages (${language})`, async ({ browser, page }, testInfo) => {
    test.setTimeout(120_000)
    const label = (zh: string, en: string) => language === 'en' ? en : zh
    await school({ defaultLocale: language })
    const source = await api<CampusTask>(teacher, '/tasks', 'POST', payload('Source evidence'))
    const target = await api<CampusTask>(teacher, '/tasks', 'POST', { ...payload('Deadline correction'), proofTypes: ['image', 'text'], workflow: { templateId: 'generic-practice', templateVersion: 1, mode: 'individual', plannedMinutes: 60, submissionDeadline: new Date(Date.now() + 86_400_000).toISOString(), personalSubmissionRequired: true } })
    const sourcePerson = await claim(source.id)
    const png = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#246a49' } }).png().toBuffer()
    const upload = await student.http.post(`/api/files/proof?taskId=${source.id}`, { headers: { Origin: student.origin, 'X-CSRF-Token': student.session.csrfToken }, multipart: { file: { name: 'audit-evidence.png', mimeType: 'image/png', buffer: png } } })
    expect(upload.status(), await upload.text()).toBeLessThan(400)
    const file = (await upload.json()).data as UploadData
    const sourceFlow = await submit(source.id, sourcePerson, { fileIds: [file.id] })
    let current = await submit(target.id, await claim(target.id), { fileIds: [file.id], sourceRevisionId: sourceFlow.participants[0]!.latestRevisionId })
    current = await api(teacher, `${flowPath(target.id)}/config`, 'PUT', configInput(current, { submissionDeadline: new Date(Date.now() - 60_000).toISOString() }))
    let person = current.participants[0]!
    current = await api(teacher, `${flowPath(target.id)}/review`, 'POST', { participantId: person.id, version: person.version, revisionId: person.latestRevisionId, decision: 'changes_requested', feedback: 'Add the handover result.' })

    const studentContext = await browser.newContext({ baseURL: student.origin, storageState: await student.http.storageState(), viewport: { width: 390, height: 844 } })
    const studentPage = await studentContext.newPage()
    try {
      await studentPage.goto(`/student/tasks/${target.id}/submit`)
      await expect(studentPage.locator('.proof-img-thumb img')).toHaveCount(1)
      await studentPage.getByLabel(label('完成说明', 'Work description'), { exact: true }).fill('Completed the work and handed over the record to the coordinator.')
      await studentPage.getByRole('button', { name: label('提交完成凭证', 'Submit evidence'), exact: true }).click()
      await expect(studentPage.locator('.proof-form-container > p[role="alert"]')).toContainText(language === 'en' ? /deadline|closed/i : /截止/)

      await showAs(page, teacher, flowPath(target.id))
      await expand(page.locator('.workspace-requirements'))
      await expand(page.locator('.workflow-config-editor'))
      const editor = page.locator('.workflow-config-editor')
      await expect(editor.getByRole('combobox', { name: label('模板与要求', 'Template and requirements'), exact: true })).toBeDisabled()
      await expect(editor.getByRole('combobox', { name: label('任务模式', 'Task mode'), exact: true })).toBeDisabled()
      await expect(editor.getByLabel(label('要求个人补充', 'Require personal evidence'), { exact: true })).toBeDisabled()
      const deadline = Temporal.Now.zonedDateTimeISO('Asia/Shanghai').add({ days: 1 }).toPlainDateTime().toString({ smallestUnit: 'minute' })
      await editor.getByLabel(label('材料截止时间', 'Evidence deadline'), { exact: false }).fill(deadline)
      await editor.getByLabel(label('计划时长（分钟）', 'Planned duration (minutes)'), { exact: true }).fill('90')
      await editor.getByRole('button', { name: label('更新要求', 'Update requirements'), exact: true }).click()
      await expect.poll(async () => (await flow(target.id)).config.plannedMinutes).toBe(90)

      await studentPage.getByRole('button', { name: label('刷新并保留草稿', 'Refresh and keep draft'), exact: true }).click()
      await expect(studentPage.locator('.proof-img-thumb img')).toHaveCount(1)
      await studentPage.getByRole('button', { name: label('提交完成凭证', 'Submit evidence'), exact: true }).click()
      await expect(studentPage).toHaveURL(new RegExp(`${flowPath(target.id)}$`))
      person = (await flow(target.id)).participants[0]!
      expect(person.revisions).toHaveLength(2)
      expect(person.revisions[1]!.fileIds).toEqual([file.id])
      expect(person.revisions[0]!.fileIds).toEqual([file.id])

      await page.goto(`/teacher/review?task=${target.id}`)
      await expect(page.locator('.review-images-row img')).toHaveCount(1)
      await page.getByLabel(label('负责人确认分钟数', 'Coordinator-confirmed minutes'), { exact: false }).fill('75')
      await page.getByRole('button', { name: label('通过', 'Approve'), exact: true }).click()
      await expect.poll(async () => (await flow(target.id)).participants[0]!.status).toBe('completed')
      await studentPage.screenshot({ path: testInfo.outputPath(`correction-${language}-mobile.png`), fullPage: true })
    } finally { await studentContext.close() }
  })

  test(`student can read authorized shared evidence without editing controls (${language})`, async ({ page }) => {
    await school({ defaultLocale: language })
    const task = await api<CampusTask>(teacher, '/tasks', 'POST', { ...payload('Shared evidence'), workflow: { templateId: 'community-garden', templateVersion: 1, mode: 'group', plannedMinutes: 60, submissionDeadline: null, personalSubmissionRequired: false } })
    await claim(task.id)
    let current = await flow(task.id)
    current = await api(teacher, `${flowPath(task.id)}/common`, 'POST', { version: current.config.version, description: 'The fictional team completed the garden activity.', note: 'Shared handover record.', fileIds: [] })
    const person = current.participants[0]!
    await api(teacher, `${flowPath(task.id)}/group-confirm`, 'POST', { participantId: person.id, version: person.version, commonRevisionId: current.commonRevisions[0]!.id, confirmedMinutes: 60, feedback: '' })
    await showAs(page, student, flowPath(task.id))
    const common = page.locator('.workflow-common-materials')
    await expand(common)
    await expect(common.locator('.common-revision')).toContainText('The fictional team completed the garden activity.')
    await expect(common).toContainText('Shared handover record.')
    await expect(common.locator('input, textarea, button')).toHaveCount(0)
    await expect(page.locator('.roster-row')).not.toContainText(language === 'en' ? 'No evidence yet' : '尚无材料')
    expect((await flow(task.id, student)).participants[0]!.revisions).toHaveLength(0)
  })
}

test('coordinator creates capacity 31 through the wizard and imports 31 people', async ({ page }) => {
  await showAs(page, teacher, '/teacher/create')
  await page.getByLabel('任务名称', { exact: true }).fill(`31-person browser task ${Date.now()}`)
  await page.getByLabel('具体地点', { exact: true }).fill('Fictional room')
  await page.getByLabel('任务说明', { exact: true }).fill('A fictional activity for thirty-one participants.')
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  const capacity = page.locator('.van-stepper__input')
  await capacity.fill('31')
  await capacity.press('Tab')
  await expect(capacity).toHaveValue('31')
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  const created = page.waitForResponse(response => response.url().endsWith('/api/tasks') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '确认发布任务', exact: true }).click()
  const response = await created
  expect(response.status()).toBeLessThan(400)
  const task = (await response.json()).data as CampusTask
  expect(task.capacity).toBe(31)
  expect((await importRoster(task.id, 31)).participants).toHaveLength(31)
})

test('101 selected reviews produce two requests and retain an individual conflict receipt', async ({ page }) => {
  test.setTimeout(120_000)
  const task = await api<CampusTask>(teacher, '/tasks', 'POST', payload('Batch reviews', 101))
  const roster = await importRoster(task.id, 101)
  for (const person of roster.participants) await submit(task.id, person, {}, teacher)
  await showAs(page, teacher, flowPath(task.id))
  await expect(page.locator('.roster-row')).toHaveCount(101)
  await page.getByRole('button', { name: '全选当前待审', exact: true }).click()
  await expand(page.locator('.workflow-batch'))
  await page.locator('.workflow-batch').getByLabel('负责人确认分钟数', { exact: true }).fill('60')
  // Another authorized review changes one selected row after it was read, without altering the UI snapshot.
  const current = await flow(task.id)
  const conflicting = current.participants[0]!
  await api(teacher, `${flowPath(task.id)}/review`, 'POST', { participantId: conflicting.id, version: conflicting.version, revisionId: conflicting.latestRevisionId, decision: 'changes_requested', feedback: 'Clarify the activity result.' })
  const sizes: number[] = []
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/workflow/batch-review')) sizes.push((req.postDataJSON() as { items: unknown[] }).items.length) })
  await page.locator('.workflow-batch').getByRole('button', { name: '批量确认', exact: true }).click()
  await expect(page.locator('.workflow-batch-results li')).toHaveCount(101)
  expect(sizes).toEqual([100, 1])
  const results = page.locator('.workflow-batch-results')
  await expect(results.locator(`li[data-participant-id="${conflicting.id}"]`)).not.toContainText('成功')
  expect((await results.locator('li').allTextContents()).filter(text => text.includes('成功'))).toHaveLength(100)
  const final = await flow(task.id)
  expect(final.participants.filter(person => person.status === 'completed')).toHaveLength(100)
  expect(final.participants.find(person => person.id === conflicting.id)!.status).toBe('changes_requested')
})

test('administrator edits an external participant name and password without invented organization data', async ({ page, baseURL }) => {
  await school({ allowExternalParticipants: true, requireDepartment: true, requireGrade: true, requireClass: true })
  const account = `EXTERNAL${Date.now()}`
  const external = await api<CampusUser>(admin, '/admin/accounts', 'POST', { role: 'student', account, name: 'Fictional external participant', password, approval: 'approved', isExternal: true })
  await showAs(page, admin, `/admin/accounts?keyword=${account}`)
  await page.locator('.admin-table-row').filter({ hasText: account }).getByRole('button', { name: '编辑', exact: true }).click()
  const editor = page.locator('.admin-editor-panel')
  await editor.getByLabel('姓名', { exact: true }).fill('Renamed external participant')
  const newPassword = 'E2E@Changed456'
  await editor.getByLabel('重置密码（选填）', { exact: true }).fill(newPassword)
  const update = page.waitForRequest(req => req.method() === 'PATCH' && req.url().endsWith(`/api/admin/accounts/${external.id}`))
  await editor.getByRole('button', { name: '保存账号', exact: true }).click()
  const submitted = (await update).postDataJSON() as Record<string, unknown>
  for (const field of ['departmentId', 'gradeId', 'classId']) expect(submitted[field]).toBeUndefined()
  await expect(editor).toBeHidden()
  const saved = (await api<PageData<CampusUser>>(admin, `/admin/accounts?keyword=${account}`)).items.find(person => person.id === external.id)!
  expect(saved.name).toBe('Renamed external participant')
  expect(saved.isExternal).toBe(true)
  expect(saved.departmentId || saved.gradeId || saved.classId).toBeFalsy()
  const externalSession = await login(baseURL!, account, newPassword)
  expect(externalSession.session.user?.id).toBe(external.id)

  // Nonempty organization IDs must survive the same serializer unchanged.
  const internalAccount = `INTERNAL${Date.now()}`
  const organization = { departmentId: 'dept-cs', gradeId: 'grade-2024', classId: 'class-24se1' }
  const internal = await api<CampusUser>(admin, '/admin/accounts', 'POST', { role: 'student', account: internalAccount, name: 'Fictional internal participant', password, approval: 'approved', ...organization })
  await page.goto(`/admin/accounts?keyword=${internalAccount}`)
  await page.locator('.admin-table-row').filter({ hasText: internalAccount }).getByRole('button', { name: '编辑', exact: true }).click()
  await editor.getByLabel('姓名', { exact: true }).fill('Renamed internal participant')
  const retainedUpdate = page.waitForRequest(req => req.method() === 'PATCH' && req.url().endsWith(`/api/admin/accounts/${internal.id}`))
  await editor.getByRole('button', { name: '保存账号', exact: true }).click()
  expect((await retainedUpdate).postDataJSON()).toMatchObject(organization)
  await expect(editor).toBeHidden()
  expect((await api<PageData<CampusUser>>(admin, `/admin/accounts?keyword=${internalAccount}`)).items[0]).toMatchObject({ ...organization, name: 'Renamed internal participant' })
})

test('confirmed task access revocation clears the old roster and participant panel on focus', async ({ page }) => {
  const replacement = await api<CampusUser>(admin, '/admin/accounts', 'POST', { role: 'teacher', account: `REPLACE${Date.now()}`, name: 'Fictional replacement', departmentId: 'dept-cs', password, approval: 'approved' })
  const task = await api<CampusTask>(teacher, '/tasks', 'POST', payload('Access revocation'))
  await importRoster(task.id, 1)
  await showAs(page, teacher, flowPath(task.id))
  await page.locator('.roster-row').getByRole('button').click()
  await expect(page.locator('.participant-panel')).toBeVisible()
  const latest = await api<CampusTask>(admin, `/tasks/${task.id}`)
  await api(admin, `${flowPath(task.id)}/handover`, 'POST', { ownerId: replacement.id, version: latest.version, reason: 'Fictional responsibility transfer.' })
  const revoked = page.waitForResponse(response => response.url().endsWith(`/api${flowPath(task.id)}`) && response.status() === 403)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await revoked
  await expect(page.locator('.roster-row')).toHaveCount(0)
  await expect(page.locator('.participant-panel')).toHaveCount(0)
  await expect(page.getByText('Audit Person 1', { exact: true })).toHaveCount(0)
  await expect(page.locator('.workflow-page').getByRole('button', { name: '返回', exact: true })).toBeVisible()
  const stillDenied = await teacher.http.get(`/api${flowPath(task.id)}`)
  expect(stillDenied.status()).toBe(403)
})

test('an authorized in-flight export is cancelled when handover revokes access without leaving the page', async ({ page }) => {
  const replacement = await api<CampusUser>(admin, '/admin/accounts', 'POST', { role: 'teacher', account: `EXPORTOWNER${Date.now()}`, name: 'Fictional export owner', departmentId: 'dept-cs', password, approval: 'approved' })
  const task = await api<CampusTask>(teacher, '/tasks', 'POST', payload('Revoked export lifecycle'))
  const current = await submit(task.id, await claim(task.id))
  const person = current.participants[0]!
  await api(teacher, `${flowPath(task.id)}/review`, 'POST', { participantId: person.id, version: person.version, revisionId: person.latestRevisionId, decision: 'approved', feedback: '', confirmedMinutes: 60 })
  const approved = await flow(task.id)
  await api(teacher, `${flowPath(task.id)}/closeout`, 'POST', { version: approved.config.version, reason: 'Fictional completion record for handover.' })
  await showAs(page, teacher, flowPath(task.id))
  const documentStartedAt = await page.evaluate(() => performance.timeOrigin)
  const normal = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 CSV', exact: true }).click()
  expect((await normal).suggestedFilename()).toMatch(/\.csv$/)

  let allow!: () => void
  let started!: () => void
  let done!: () => void
  const gate = new Promise<void>(resolve => { allow = resolve })
  const responseReady = new Promise<void>(resolve => { started = resolve })
  const routed = new Promise<void>(resolve => { done = resolve })
  await page.route(`**/api${flowPath(task.id)}/snapshots/*/export?*`, async route => {
    try {
      // The real service completes its final authorization check before the administrator hands over.
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      started()
      await gate
      await route.fulfill({ response }).catch(() => {}) // Explicit page-scope cancellation may already have closed the route.
    } finally { done() }
  })
  try {
    await page.getByRole('button', { name: '下载 CSV', exact: true }).click()
    await responseReady
    const latest = await api<CampusTask>(admin, `/tasks/${task.id}`)
    await api(admin, `${flowPath(task.id)}/handover`, 'POST', { ownerId: replacement.id, version: latest.version, reason: 'Fictional export access revocation.' })
    const revoked = page.waitForResponse(response => response.url().endsWith(`/api${flowPath(task.id)}`) && response.status() === 403)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await revoked
    await expect(page.locator('.roster-row')).toHaveCount(0)
    await expect(page.locator('.snapshot-card')).toHaveCount(0)
    await expect(page.locator('.workflow-page').getByRole('button', { name: '返回', exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${flowPath(task.id)}$`))
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStartedAt)
    const session = await page.request.get('/api/auth/session')
    expect(session.status()).toBe(200)
    expect(((await session.json()).data as SessionData).user?.id).toBe(teacher.session.user?.id)
    const lateDownload = page.waitForEvent('download', { timeout: 1500 }).then(() => true, () => false)
    allow()
    await routed
    expect(await lateDownload).toBe(false)
  } finally { allow() }
})

test('an authorized in-flight export does not download after leaving, signing out and switching account', async ({ page }) => {
  const task = await api<CampusTask>(teacher, '/tasks', 'POST', payload('Lifecycle export'))
  const current = await submit(task.id, await claim(task.id))
  const person = current.participants[0]!
  await api(teacher, `${flowPath(task.id)}/review`, 'POST', { participantId: person.id, version: person.version, revisionId: person.latestRevisionId, decision: 'approved', feedback: '', confirmedMinutes: 60 })
  const approved = await flow(task.id)
  await api(teacher, `${flowPath(task.id)}/closeout`, 'POST', { version: approved.config.version, reason: 'Fictional completion record.' })
  await showAs(page, teacher, flowPath(task.id))
  // A real successful download is the positive control before any response interception.
  const normal = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 CSV', exact: true }).click()
  expect((await normal).suggestedFilename()).toMatch(/\.csv$/)
  let allow!: () => void
  let started!: () => void
  let done!: () => void
  const gate = new Promise<void>(resolve => { allow = resolve })
  const responseReady = new Promise<void>(resolve => { started = resolve })
  const routed = new Promise<void>(resolve => { done = resolve })
  await page.route(`**/api${flowPath(task.id)}/snapshots/*/export?*`, async route => {
    try {
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      started()
      await gate
      await route.fulfill({ response }).catch(() => {}) // The expected client abort can already have closed this route.
    } finally { done() }
  })
  await page.getByRole('button', { name: '下载 CSV', exact: true }).click()
  await responseReady
  await page.locator('a[href="/profile"]').first().click()
  await expect(page).toHaveURL(/\/profile$/)
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await page.locator('.van-dialog__confirm').click()
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('登录账号', { exact: true }).fill('E2ESTUDENT')
  await page.getByLabel('登录密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登 录', exact: true }).click()
  await expect(page).toHaveURL(/\/student\/home$/)
  const lateDownload = page.waitForEvent('download', { timeout: 1500 }).then(() => true, () => false)
  allow()
  await routed
  expect(await lateDownload).toBe(false)
})
