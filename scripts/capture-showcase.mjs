import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { Temporal } from '@js-temporal/polyfill'

// Run after npm run build with Node 24.13.1+. This script uses only fresh,
// fictional databases, normal business services and an authenticated browser.
// It does not load .env, reuse a running service or alter the rendered DOM.
// Optional positional arguments restrict output, e.g. `student admin`.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const only = new Set(process.argv.slice(2))
for (const kind of only) if (!['roster', 'review', 'group', 'export', 'student', 'admin', 'login', 'teacher', 'create', 'create-rules', 'create-preview', 'student-home', 'hall', 'detail', 'submit'].includes(kind)) throw new Error(`Unknown screenshot kind: ${kind}`)
const output = path.join(project, 'docs/screenshots')
const scratch = path.join(project, '.local/showcase-capture')
await fs.access(path.join(project, 'dist/index.html'))
await fs.mkdir(scratch, { recursive: true })
await fs.mkdir(output, { recursive: true })
process.env.NODE_ENV = 'test'
const fromBuild = relative => import(new URL(`../dist-server/server/${relative}`, import.meta.url))
const { buildApp } = await fromBuild('app.js')
const { installFromTrustedHost } = await fromBuild('installation/service.js')
const { createAdminManagedUser } = await fromBuild('modules/accounts.service.js')
const { createTask, claimTask, startTask } = await fromBuild('modules/tasks.service.js')
const flow = await fromBuild('modules/workflow.service.js')
const { seedWorkflowDemo } = await fromBuild('demo/workflow-seed.js')

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

function seed(db, teacher, student, locale) {
  const en = locale === 'en'
  const t = (zh, english) => en ? english : zh
  const date = Temporal.Now.zonedDateTimeISO(en ? 'America/New_York' : 'Asia/Shanghai').toPlainDate().add({ days: 3 }).toString()
  const base = {
    categoryId: 'category-event', campusId: 'campus-main', date, startTime: '09:00', endTime: '12:00',
    signupDeadline: `${date} 08:00`, duration: t('计划 180 分钟', '180 planned minutes'), capacity: 12,
    audienceScope: 'school', requirements: [], proofTypes: ['text'], claimMode: 'direct', contacts: [],
    workflow: { templateId: 'generic-practice', templateVersion: 1, mode: 'individual', plannedMinutes: 180, submissionDeadline: null, personalSubmissionRequired: true }
  }
  const rosterTask = createTask(db, teacher, { ...base,
    title: t('校园开放日 · 访客引导', 'Campus Open Day · Visitor welcome'),
    description: t('协助访客签到、校园路线引导与场地整理，活动后记录服务内容和实际参与时长。', 'Welcome visitors, help with check-in and campus directions, then record completed work and actual time.'),
    checklist: [t('核对签到人数', 'Count visitor check-ins'), t('完成岗位交接', 'Complete the shift handover')],
    place: t('图书馆前厅', 'Library atrium')
  })
  const names = en ? ['Riley Chen', 'Jamie Lee', 'Sam Taylor', 'Ari Park', 'Casey Wu'] : ['叶涵', '顾清', '许晨', '陆知遥', '江予安']
  const input = { source: t('开放日报名名单', 'Open Day registrations'), rows: names.map((name, i) => ({ externalId: `202610${String(i + 1).padStart(2, '0')}`, name, department: t('校园志愿服务队', 'Campus volunteers') })) }
  flow.importRoster(db, teacher, rosterTask.id, { ...input, hash: flow.previewRosterImport(db, teacher, rosterTask.id, input).hash, idempotencyKey: 'showcase-open-day' })
  const person = index => flow.getTaskWorkflow(db, teacher, rosterTask.id).participants.find(p => p.externalId === input.rows[index].externalId)
  const submit = (index, description, minutes, note = '') => {
    const p = person(index)
    flow.submitWorkflowRevision(db, teacher, rosterTask.id, { participantId: p.id, version: p.version, description, note, fileIds: [], reportedMinutes: minutes })
  }
  const review = (index, decision, feedback, minutes, missingItems = []) => {
    const p = person(index)
    flow.reviewWorkflowRevision(db, teacher, rosterTask.id, { participantId: p.id, version: p.version, revisionId: p.latestRevisionId, decision, feedback, confirmedMinutes: minutes, missingItems })
  }
  submit(0, t('在图书馆协助访客签到和路线引导。', 'Helped visitors check in and find campus venues.'), 180)
  review(0, 'changes_requested', t('请补充签到人数和离岗时间，便于核对实际服务时长。', 'Add the visitor count and shift end time so the actual duration can be checked.'), null, ['description', 'reportedMinutes'])
  submit(0, t('完成 42 位访客签到，09:00 到岗、11:30 离岗；已将余下导览资料交接给下一班。', 'Checked in 42 visitors from 09:00 to 11:30; handed the remaining guide packs to the next shift.'), 150, t('已补充人数、离岗时间和交接结果。', 'Added the count, shift end time and handover outcome.'))
  submit(1, t('完成入口引导与资料分发。', 'Welcomed visitors and distributed campus guides.'), 120)
  review(1, 'changes_requested', t('请补充交接对象与剩余资料数量。', 'Add who received the handover and the number of remaining guide packs.'), null, ['note'])
  submit(2, t('完成 3 组访客路线引导，归还全部指示牌。', 'Guided three visitor groups and returned all direction signs.'), 90)
  review(2, 'approved', t('已核对岗位记录与实际参与时间。', 'Shift record and actual participation time checked.'), 90)
  submit(4, t('引导访客前往实验室参观，完成两轮场地检查。', 'Directed visitors to the laboratories and completed two venue checks.'), 120)

  const groupTask = createTask(db, teacher, { ...base,
    title: t('校园花园 · 周末养护', 'Campus garden · Weekend care'),
    description: t('分组完成花坛养护、工具清点与场地清洁，公共记录由负责人提交，实际时长逐人确认。', 'Care for planted beds, check tools and clean the site. Use one shared activity record and confirm each person separately.'),
    checklist: [t('养护分配花坛', 'Care for assigned beds'), t('清点归还工具', 'Return and count tools')], place: t('校园花园 A—C 区', 'Campus garden · Beds A–C'),
    workflow: { ...base.workflow, templateId: 'community-garden', mode: 'group', plannedMinutes: 120, personalSubmissionRequired: false }
  })
  const groupInput = { source: t('园艺社签到名单', 'Gardening society attendance'), rows: input.rows.slice(0, 4) }
  flow.importRoster(db, teacher, groupTask.id, { ...groupInput, hash: flow.previewRosterImport(db, teacher, groupTask.id, groupInput).hash, idempotencyKey: 'showcase-garden' })
  let group = flow.getTaskWorkflow(db, teacher, groupTask.id)
  group = flow.submitCommonRevision(db, teacher, groupTask.id, { version: group.config.version,
    description: t('A—C 区花坛已养护；12 件工具全部归还，通道清理完成。', 'Beds A–C cared for; 12 tools returned; paths cleared.'),
    note: t('各组组长已核对签到、离场时间与工作分工。', 'Team leads checked attendance, departure times and assigned work.'), fileIds: [] })
  for (const p of group.participants.filter(person => ['20261001', '20261002'].includes(person.externalId))) flow.confirmGroupParticipant(db, teacher, groupTask.id, { participantId: p.id, version: p.version, commonRevisionId: group.commonRevisions[0].id, confirmedMinutes: p.externalId.endsWith('01') ? 90 : 75, feedback: t('签到与岗位记录已核对。', 'Attendance and work log checked.') })
  const completed = seedWorkflowDemo(db, teacher)

  const labTask = createTask(db, teacher, { ...base, categoryId: 'category-device',
    title: t('实验室开放日 · 设备核对', 'Laboratory equipment check'),
    description: t('核对展示设备、整理指引卡并向实验室负责人交接。', 'Check display equipment, organize instruction cards and hand over to the laboratory coordinator.'),
    checklist: [t('核对设备编号与状态', 'Check equipment IDs and condition'), t('登记异常并完成交接', 'Record issues and complete handover')],
    place: t('实验楼 B302', 'Science building · B302')
  })
  claimTask(db, student, labTask.id)
  startTask(db, student, labTask.id)
  return { rosterTask, groupTask, completed, labTask, names }
}

async function login(page, account, password) {
  await page.goto('/login')
  const result = await page.evaluate(async ({ account, password }) => {
    const session = await fetch('/api/auth/session').then(response => response.json())
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.data.csrfToken }, body: JSON.stringify({ account, password }) })
    return response.status
  }, { account, password })
  if (result !== 200) throw new Error(`Login failed with status ${result}`)
}

async function ready(page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('.van-toast')).toBeHidden()
}

async function capture(page, locale, kind, options = {}) {
  if (only.size && !only.has(kind)) return
  await ready(page)
  const filename = `showcase-${locale === 'en' ? 'en' : 'zh'}-${kind}.png`
  const { locator, ...settings } = options
  await (locator ?? page).screenshot({ path: path.join(output, filename), type: 'png', animations: 'disabled', ...settings })
  console.log(`${filename} ${page.url().replace(/^https?:\/\/[^/]+/, '')}`)
}

async function loginByForm(page, locale, account, password, captureLogin = false) {
  const en = locale === 'en'; const t = (zh, english) => en ? english : zh
  await page.goto('/login')
  const accountField = page.getByLabel(t('登录账号', 'Account'), { exact: true })
  const passwordField = page.getByLabel(t('登录密码', 'Password'), { exact: true })
  await expect(accountField).toBeVisible()
  await accountField.fill(account)
  if (captureLogin) await capture(page, locale, 'login', { locator: page.locator('.auth-shell') })
  await passwordField.fill(password)
  await page.getByRole('button', { name: t('登 录', 'Sign in'), exact: true }).click()
  await expect(page).toHaveURL(/\/(teacher|student|admin)\/home$/)
}

async function captureRoleTour(browser, origin, locale, password) {
  const en = locale === 'en'; const t = (zh, english) => en ? english : zh
  const viewport = { width: 560, height: 1050 }
  const title = t('校园开放日 · 上午引导', 'Campus Open Day · Morning welcome')
  const date = Temporal.Now.zonedDateTimeISO(en ? 'America/New_York' : 'Asia/Shanghai').toPlainDate().add({ days: 5 }).toString()
  const teacherContext = await browser.newContext({ baseURL: origin, viewport, deviceScaleFactor: 2, locale: en ? 'en-US' : 'zh-CN', timezoneId: en ? 'America/New_York' : 'Asia/Shanghai' })
  const teacherPage = await teacherContext.newPage()
  try {
    await loginByForm(teacherPage, locale, 'SHOWCOORD', password, true)
    await expect(teacherPage).toHaveURL(/\/teacher\/home$/)
    await capture(teacherPage, locale, 'teacher', { locator: teacherPage.locator('.teacher-home-page') })
    await teacherPage.goto('/teacher/create')
    await expect(teacherPage.locator('.create-task-page')).toBeVisible()
    await teacherPage.getByLabel(t('任务名称', 'Task name'), { exact: true }).fill(title)
    await teacherPage.getByLabel(t('任务分类', 'Task category'), { exact: true }).selectOption({ label: t('活动协助', 'Events') })
    await teacherPage.getByLabel(t('所在校区', 'Campus'), { exact: true }).selectOption({ label: t('主校区', 'Main campus') })
    await teacherPage.getByLabel(t('具体地点', 'Location'), { exact: true }).fill(t('图书馆前厅', 'Library atrium'))
    await teacherPage.getByLabel(t('任务说明', 'Task description'), { exact: true }).fill(t('协助访客签到、路线引导与资料交接，活动后记录实际参与时长。', 'Welcome visitors, guide campus routes and hand over materials; record the actual time after the shift.'))
    await teacherPage.getByLabel(t('工作清单', 'Checklist'), { exact: true }).fill(t('核对签到人数\n完成岗位交接\n归还导览资料', 'Count visitor check-ins\nComplete the shift handover\nReturn guide packs'))
    await capture(teacherPage, locale, 'create', { locator: teacherPage.locator('.create-task-page') })
    await teacherPage.getByRole('button', { name: t('下一步', 'Next'), exact: true }).click()
    await teacherPage.getByLabel(t('任务日期', 'Task date'), { exact: true }).fill(date)
    await teacherPage.getByLabel(t('开始时间', 'Start time'), { exact: true }).fill('09:00')
    await teacherPage.getByLabel(t('结束时间', 'End time'), { exact: true }).fill('11:30')
    await teacherPage.getByLabel(t('报名截止', 'Sign-up deadline'), { exact: true }).fill(`${date}T08:30`)
    await teacherPage.getByLabel(t('预计耗时', 'Estimated duration'), { exact: true }).fill(t('约 2.5 小时', 'About 2.5 hours'))
    await teacherPage.getByLabel(t('招募人数', 'Capacity'), { exact: true }).locator('input').fill('6')
    await capture(teacherPage, locale, 'create-rules', { locator: teacherPage.locator('.create-task-page') })
    await teacherPage.getByRole('button', { name: t('下一步', 'Next'), exact: true }).click()
    await teacherPage.getByRole('button', { name: t('下一步', 'Next'), exact: true }).click()
    await expect(teacherPage.getByRole('button', { name: t('确认发布任务', 'Publish task'), exact: true })).toBeVisible()
    await capture(teacherPage, locale, 'create-preview', { locator: teacherPage.locator('.create-task-page') })
    await teacherPage.getByRole('button', { name: t('确认发布任务', 'Publish task'), exact: true }).click()
    await expect(teacherPage).toHaveURL(/\/tasks\/[^/]+\/workflow$/)
    const taskId = teacherPage.url().match(/\/tasks\/([^/]+)\/workflow$/)?.[1]
    if (!taskId) throw new Error('Published task id was not present in the workflow URL')
    await teacherContext.close()

    const studentContext = await browser.newContext({ baseURL: origin, viewport, deviceScaleFactor: 2, locale: en ? 'en-US' : 'zh-CN', timezoneId: en ? 'America/New_York' : 'Asia/Shanghai' })
    const studentPage = await studentContext.newPage()
    try {
      await loginByForm(studentPage, locale, 'SHOWSTUDENT', password)
      await expect(studentPage).toHaveURL(/\/student\/home$/)
      await capture(studentPage, locale, 'student-home', { locator: studentPage.locator('.student-home-page') })
      await studentPage.goto('/student/tasks')
      const search = studentPage.getByPlaceholder(t('搜索任务、地点或发布老师', 'Search tasks, locations or coordinators'))
      await search.fill(title)
      const card = studentPage.locator('.campus-task-card').filter({ hasText: title })
      await expect(card).toBeVisible()
      await capture(studentPage, locale, 'hall', { locator: studentPage.locator('.task-hall-page') })
      await card.click()
      await expect(studentPage).toHaveURL(new RegExp(`/tasks/${taskId}$`))
      await expect(studentPage.locator('.task-detail-container h1')).toHaveText(title)
      await expect(studentPage.getByRole('button', { name: t('立即接取任务', 'Join task'), exact: true })).toBeVisible()
      await capture(studentPage, locale, 'detail')
      await studentPage.getByRole('button', { name: t('立即接取任务', 'Join task'), exact: true }).click()
      await expect(studentPage.getByRole('button', { name: t('开始任务', 'Start task'), exact: true })).toBeVisible()
      await studentPage.getByRole('button', { name: t('开始任务', 'Start task'), exact: true }).click()
      await expect(studentPage.getByRole('button', { name: t('提交完成凭证', 'Submit evidence'), exact: true })).toBeVisible()
      await studentPage.goto(`/student/tasks/${taskId}/submit`)
      await expect(studentPage.locator('.proof-form-container')).toBeVisible()
      await studentPage.getByLabel(t('自报分钟数', 'Self-reported minutes'), { exact: true }).fill('150')
      await studentPage.getByLabel(t('完成说明', 'Work description'), { exact: true }).fill(t('完成 42 位访客签到、路线引导和资料交接，岗位记录已交给下一班负责人。', 'Checked in 42 visitors, guided campus routes and handed the guide packs to the next shift coordinator.'))
      await studentPage.getByLabel(t('补充备注', 'Additional notes'), { exact: true }).fill(t('09:00—11:30，交接完成。', '09:00–11:30; handover complete.'))
      await capture(studentPage, locale, 'submit')
    } finally { await studentContext.close() }
  } finally {
    await teacherContext.close()
  }
}

const browser = await chromium.launch({ headless: true })
try {
  for (const locale of ['en', 'zh-CN']) {
    const en = locale === 'en'; const t = (zh, english) => en ? english : zh
    const root = await fs.mkdtemp(path.join(scratch, 'run-'))
    const port = await freePort(); const origin = `http://127.0.0.1:${port}`
    let built; let context
    try {
      built = await buildApp({ logger: false, config: {
        nodeEnv: 'test', host: '127.0.0.1', port, appOrigins: [origin], secureCookie: false, trustProxy: false,
        databasePath: path.join(root, 'campus.sqlite'), uploadDir: path.join(root, 'uploads'), backupDir: path.join(root, 'backups'),
        timezone: en ? 'America/New_York' : 'Asia/Shanghai', serveClient: true, clientDist: path.join(project, 'dist'), setupToken: '',
        mail: { enabled: false, host: '', port: 587, secure: false, user: '', password: '', from: '', pollIntervalMs: 15000 }
      } })
      const password = randomBytes(24).toString('base64url')
      await installFromTrustedHost(built.db, { locale, name: t('中国海洋大学', 'Harvard University'), platformName: t('高校任务协作平台', 'CampusCollab'), timezone: en ? 'America/New_York' : 'Asia/Shanghai', admin: { account: 'SHOWADMIN', name: t('周老师', 'Alex Morgan'), password } })
      const teacher = await createAdminManagedUser(built.db, { role: 'teacher', account: 'SHOWCOORD', name: t('林老师', 'Jordan Lee'), departmentId: 'dept-cs', approval: 'approved', password })
      const student = await createAdminManagedUser(built.db, { role: 'student', account: 'SHOWSTUDENT', name: t('沈思远', 'Avery Chen'), departmentId: 'dept-cs', gradeId: 'grade-2024', classId: 'class-24se1', approval: 'approved', password })
      await createAdminManagedUser(built.db, { role: 'teacher', account: 'SHOWPENDING', name: t('陈老师', 'Morgan Chen'), departmentId: 'dept-fl', approval: 'pending', password })
      const sample = seed(built.db, teacher, student, locale)
      await built.app.listen({ host: '127.0.0.1', port })
      await captureRoleTour(browser, origin, locale, password)
      context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 2, locale: en ? 'en-US' : 'zh-CN', timezoneId: en ? 'America/New_York' : 'Asia/Shanghai' })
      context.setDefaultTimeout(15_000)
      let page = await context.newPage()
      await login(page, teacher.account, password)
      await page.goto(`/tasks/${sample.rosterTask.id}/workflow`)
      await expect(page.locator('.roster-row')).toHaveCount(5)
      await capture(page, locale, 'roster')
      await page.locator('.roster-row').filter({ hasText: sample.names[0] }).getByRole('button').click()
      const panel = page.locator('.participant-panel')
      await expect(panel).toBeVisible()
      await panel.getByLabel(t('负责人确认分钟数', 'Coordinator-confirmed minutes'), { exact: false }).fill('150')
      await panel.getByLabel(t('补正意见', 'Changes requested'), { exact: true }).fill(t('已补充 42 位访客、11:30 离岗时间和交接结果，可据此确认 150 分钟。', 'Visitor count, 11:30 shift end and handover are now recorded. Confirm 150 minutes.'))
      await panel.getByRole('heading', { name: sample.names[0], exact: true }).click()
      const reviewBox = await panel.locator(':scope > section.workflow-section').first().boundingBox()
      await capture(page, locale, 'review', { clip: { x: 680, y: 0, width: 760, height: Math.min(1050, Math.ceil(reviewBox.y + reviewBox.height + 16)) } })
      await panel.getByRole('button', { name: t('关闭', 'Close'), exact: true }).click()

      await page.goto(`/tasks/${sample.groupTask.id}/workflow`)
      await expect(page.locator('.roster-row')).toHaveCount(4)
      await page.locator('.roster-row').filter({ hasText: sample.names[2] }).getByRole('button').click()
      await expect(panel).toBeVisible()
      await panel.getByLabel(t('负责人确认分钟数', 'Coordinator-confirmed minutes'), { exact: false }).fill('105')
      await panel.getByLabel(t('补正意见', 'Changes requested'), { exact: true }).fill(t('已核对签到与 A 区养护分工，实际参与 105 分钟。', 'Attendance and work in Bed A checked; actual participation was 105 minutes.'))
      await expect(panel.getByRole('button', { name: t('确认实际参与', 'Confirm participation'), exact: true })).toBeVisible()
      await panel.getByRole('heading', { name: sample.names[2], exact: true }).click()
      const groupBox = await panel.locator(':scope > section.workflow-section').first().boundingBox()
      await capture(page, locale, 'group', { clip: { x: 680, y: 0, width: 760, height: Math.min(1000, Math.ceil(groupBox.y + groupBox.height + 16)) } })
      await panel.getByRole('button', { name: t('关闭', 'Close'), exact: true }).click()

      await page.goto(`/tasks/${sample.completed.taskId}/workflow`)
      await expect(page.locator('.snapshot-card')).toBeVisible()
      await page.getByRole('button', { name: t('查看快照核对', 'Check snapshot totals'), exact: true }).click()
      await page.locator('#workflow-results').scrollIntoViewIfNeeded()
      await capture(page, locale, 'export', { locator: page.locator('#workflow-results') })
      await context.close(); context = undefined

      context = await browser.newContext({ baseURL: origin, viewport: { width: 430, height: 1000 }, deviceScaleFactor: 2, hasTouch: true, locale: en ? 'en-US' : 'zh-CN', timezoneId: en ? 'America/New_York' : 'Asia/Shanghai' })
      page = await context.newPage()
      await login(page, student.account, password)
      await page.goto(`/student/tasks/${sample.labTask.id}/submit`)
      await expect(page.locator('.proof-form-container')).toBeVisible()
      await page.getByLabel(t('自报分钟数', 'Self-reported minutes'), { exact: true }).fill('90')
      await page.getByLabel(t('完成说明', 'Work description'), { exact: true }).fill(t('已核对 36 台展示设备，2 台标签磨损已登记；指引卡整理完毕，全部设备交接给实验室负责人。', 'Checked 36 display devices and recorded two worn labels. Organized the guide cards and handed all equipment to the laboratory coordinator.'))
      await page.getByLabel(t('补充备注', 'Additional notes'), { exact: true }).fill(t('09:00—10:30；异常登记表已交接。', '09:00–10:30; issue log handed over.'))
      await page.locator('.proof-header-card').click()
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.mouse.move(210, 300)
      await page.mouse.wheel(0, -3000)
      await page.waitForTimeout(150)
      const mobileNavbar = await page.locator('.van-nav-bar').boundingBox()
      const mobileHeading = await page.locator('.proof-header-card h2').boundingBox()
      expect(mobileNavbar.y + mobileNavbar.height, 'Navigation must not cover the task title').toBeLessThanOrEqual(mobileHeading.y)
      await capture(page, locale, 'student', { clip: { x: 0, y: 0, width: 430, height: 900 } })
      await context.close(); context = undefined

      context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: en ? 'en-US' : 'zh-CN' })
      page = await context.newPage()
      await login(page, 'SHOWADMIN', password)
      await page.goto('/admin/home')
      await expect(page.locator('.admin-dashboard-task')).toHaveCount(5)
      const adminCards = await page.locator('.admin-dashboard-columns').boundingBox()
      await capture(page, locale, 'admin', { clip: { x: 224, y: 64, width: 1216, height: Math.ceil(adminCards.y + adminCards.height + 24 - 64) } })
    } finally {
      await context?.close()
      await built?.app.close()
      // Delete only the unique scratch directory created by this iteration.
      const resolved = await fs.realpath(root)
      if (path.dirname(resolved) !== await fs.realpath(scratch) || !path.basename(resolved).startsWith('run-')) throw new Error('Unexpected showcase cleanup path')
      await fs.rm(resolved, { recursive: true, force: true })
    }
  }
} finally { await browser.close() }
