import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { CampusUser, CatalogData, PageData, SessionData } from '../../shared/contracts.js'

const password = 'E2E@Browser123'

async function api<T>(page: Page, path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  const result = await page.evaluate(
    async ({ path, method, body }) => {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (method !== 'GET') {
        const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
        const session = await response.json()
        if (!response.ok || !session.ok || !session.data?.csrfToken) throw new Error('管理员 CSRF 会话未就绪')
        headers['Content-Type'] = 'application/json'
        headers['X-CSRF-Token'] = session.data.csrfToken
      }
      const response = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(body)
      })
      return { status: response.status, body: await response.json() }
    },
    { path, method, body }
  )
  expect(result.status, `${method} ${path}: ${JSON.stringify(result.body)}`).toBe(200)
  expect(result.body).toMatchObject({ ok: true, message: expect.any(String) })
  expect(result.body).toHaveProperty('data')
  return result.body.data as T
}

async function expectHonestAuthCopy(page: Page) {
  const shell = page.locator('.auth-shell')
  await expect(shell).toBeVisible()
  await expect(shell).not.toContainText(/统一身份认证|统一认证|身份认证通过|学籍核验通过/)
}

async function submitLogin(page: Page, account: string) {
  await expectHonestAuthCopy(page)
  await page.getByLabel('登录账号', { exact: true }).fill(account)
  await page.getByLabel('登录密码', { exact: true }).fill(password)
  const [response] = await Promise.all([
    page.waitForResponse(
      response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST'
    ),
    page.getByRole('button', { name: '登 录', exact: true }).click()
  ])
  expect(response.request().postDataJSON()).toEqual({ account, password })
  return { status: response.status(), body: await response.json() }
}

async function login(page: Page, account: string, expectedPath: string): Promise<SessionData> {
  const result = await submitLogin(page, account)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  expect(result.body).toMatchObject({
    ok: true,
    message: expect.any(String),
    data: { user: { account, approval: 'approved' } }
  })
  await expect(page).toHaveURL(expectedPath)
  return result.body.data as SessionData
}

type RegistrationOrganization = {
  department: CatalogData['departments'][number]
  grade: CatalogData['grades'][number]
  classItem: CatalogData['classes'][number]
}

async function register(
  page: Page,
  role: 'student' | 'teacher',
  account: string,
  name: string,
  organization: RegistrationOrganization
) {
  await expectHonestAuthCopy(page)
  await page.getByRole('button', { name: '注册账号', exact: true }).click()
  await expect(page).toHaveURL('/register')
  await expect(page.getByRole('heading', { name: '选择注册身份', exact: true })).toBeVisible()
  await expectHonestAuthCopy(page)
  await page
    .locator('article[role="button"]')
    .filter({
      has: page.getByRole('heading', { name: role === 'student' ? '在籍学生' : '指导教师 / 教职工', exact: true })
    })
    .click()
  await expect(page).toHaveURL(`/register/${role}`)
  await expect(page.locator('.api-load-state')).toHaveCount(0)
  await expectHonestAuthCopy(page)
  await page.getByLabel('真实姓名', { exact: true }).fill(name)
  await page.getByLabel(role === 'student' ? '学号' : '教工号', { exact: true }).fill(account)

  const select = (label: string) => page.getByLabel(new RegExp(`^${label}`))
  if (role === 'student') await expect(select('行政班级')).toBeDisabled()
  await select('所属学院').selectOption(organization.department.id)
  await expect(select('所属学院')).toHaveValue(organization.department.id)
  if (role === 'student') {
    await expect(select('行政班级')).toBeDisabled()
    await select('年级').selectOption(organization.grade.id)
    await expect(select('年级')).toHaveValue(organization.grade.id)
    await expect(select('行政班级')).toBeEnabled()
    await select('行政班级').selectOption(organization.classItem.id)
    await expect(select('行政班级')).toHaveValue(organization.classItem.id)
  } else {
    await expect(page.locator('.auth-page-content select')).toHaveCount(1)
  }
  await page.getByLabel('设置密码', { exact: true }).fill(password)
  await page.getByLabel('确认密码', { exact: true }).fill(password)
  const agreement = page.getByRole('checkbox').filter({
    has: page.getByText('我确认登记资料真实', { exact: true })
  })
  await expect(agreement).toBeVisible()
  await agreement.check()
  await expect(agreement).toBeChecked()
  const [response] = await Promise.all([
    page.waitForResponse(
      response => new URL(response.url()).pathname === '/api/auth/register' && response.request().method() === 'POST'
    ),
    page.getByRole('button', { name: role === 'student' ? '注册账号' : '提交教师登记申请', exact: true }).click()
  ])
  expect(response.request().postDataJSON()).toEqual({
    role,
    account,
    name,
    departmentId: organization.department.id,
    password,
    locale: 'zh-CN',
    isExternal: false,
    ...(role === 'student' ? { gradeId: organization.grade.id, classId: organization.classItem.id } : {})
  })
  const result = await response.json()
  expect(response.status(), JSON.stringify(result)).toBe(201)
  expect(result).toMatchObject({ ok: true, message: expect.any(String), data: null })
  await expect(page).toHaveURL(url => url.pathname === '/register-success' && url.searchParams.get('role') === role)
  await expect(
    page.getByRole('heading', { name: role === 'student' ? '学生账号登记成功' : '登记申请已提交', exact: true })
  ).toBeVisible()
  await expectHonestAuthCopy(page)
  if (role === 'student') await expect(page.locator('.auth-shell p')).toHaveCount(0)
  else await expect(page.locator('.auth-shell p')).toHaveText('请等待管理员审核，审核通过后可登录。')
}

async function expectProfile(page: Page, user: CampusUser) {
  await page.goto('/profile')
  const profile = page.locator('.profile-page')
  await expect(profile.getByRole('heading', { name: user.name, exact: true })).toBeVisible()
  await expect(profile.locator('.user-role-badge')).toHaveText(user.role === 'student' ? '在籍学生' : '教师身份')
  const values = profile.locator('.van-cell__value')
  await expect(values.filter({ hasText: user.account })).toHaveText(user.account)
  await expect(values.filter({ hasText: user.department })).toHaveText(user.department)
  if (user.className) await expect(values.filter({ hasText: user.className })).toHaveText(user.className)
  if (user.grade) await expect(values.filter({ hasText: user.grade })).toHaveText(user.grade)
  await expect(profile.getByText('已启用', { exact: true })).toBeVisible()
  await expect(profile).not.toContainText('身份认证通过')
}

test('学生和教师通过真实表单注册，教师必须经独立管理员审批后才能登录', async ({ browser, page, baseURL }) => {
  const teacherContext = await browser.newContext({ baseURL })
  const adminContext = await browser.newContext({ baseURL })
  try {
    const teacherPage = await teacherContext.newPage()
    const adminPage = await adminContext.newPage()
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const studentAccount = `REGS${suffix}`
    const teacherAccount = `REGT${suffix}`
    const studentName = '注册验收学生'
    const teacherName = '注册验收教师'

    await page.goto('/')
    await expect(page.getByRole('button', { name: '校园账号登录', exact: true })).toBeVisible()
    await expectHonestAuthCopy(page)
    const catalog = await api<CatalogData>(page, '/catalog')
    const department = catalog.departments.find(item => item.enabled && item.name === '计算机科学与技术学院')
    const grade = catalog.grades.find(item => item.enabled && item.name === '2024级')
    const classItem = catalog.classes.find(
      item =>
        item.enabled && item.name === '24软件1班' && item.departmentId === department?.id && item.gradeId === grade?.id
    )
    expect(department, '公共 catalog 必须提供计算机学院').toBeDefined()
    expect(grade, '公共 catalog 必须提供 2024级').toBeDefined()
    expect(classItem, '软件班必须属于选定学院及年级').toBeDefined()
    const organization = { department: department!, grade: grade!, classItem: classItem! }

    await page.getByRole('button', { name: '校园账号登录', exact: true }).click()
    await register(page, 'student', studentAccount, studentName, organization)
    await page.getByRole('button', { name: '前往登录', exact: true }).click()
    const studentSession = await login(page, studentAccount, '/student/home')
    expect(studentSession.user).toMatchObject({
      role: 'student',
      name: studentName,
      departmentId: department!.id,
      department: department!.name,
      gradeId: grade!.id,
      grade: grade!.name,
      classId: classItem!.id,
      className: classItem!.name
    })
    await expect(
      page.locator('.student-home-page').getByRole('heading', { name: '校内协作任务', exact: true })
    ).toBeVisible()
    await expectProfile(page, studentSession.user!)

    await teacherPage.goto('/login')
    await register(teacherPage, 'teacher', teacherAccount, teacherName, organization)
    await teacherPage.getByRole('button', { name: '前往登录', exact: true }).click()
    const rejected = await submitLogin(teacherPage, teacherAccount)
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(403)
    expect(rejected.body).toMatchObject({ ok: false, code: 'ACCOUNT_PENDING', message: '账号正在等待学校管理员审核' })
    await expect(teacherPage.locator('.van-toast__text')).toContainText('账号正在等待学校管理员审核')
    await expect(teacherPage).toHaveURL('/login')
    expect((await api<SessionData>(teacherPage, '/auth/session')).user).toBeNull()
    await teacherPage.goto('/teacher/home')
    await expect(teacherPage).toHaveURL(
      url => url.pathname === '/login' && url.searchParams.get('redirect') === '/teacher/home'
    )
    await expect(teacherPage.locator('.teacher-home-page')).toHaveCount(0)

    await adminPage.goto('/login')
    const adminSession = await login(adminPage, 'E2EADMIN', '/admin/home')
    expect(adminSession.user?.role).toBe('admin')
    const students = await api<PageData<CampusUser>>(adminPage, `/admin/accounts?keyword=${studentAccount}`)
    expect(students.items).toHaveLength(1)
    expect(students.items[0]).toMatchObject({
      id: studentSession.user!.id,
      account: studentAccount,
      role: 'student',
      approval: 'approved',
      departmentId: department!.id,
      gradeId: grade!.id,
      classId: classItem!.id
    })
    const teachers = await api<PageData<CampusUser>>(adminPage, `/admin/accounts?keyword=${teacherAccount}`)
    expect(teachers.items).toHaveLength(1)
    const pendingTeacher = teachers.items[0]!
    expect(pendingTeacher).toMatchObject({
      account: teacherAccount,
      name: teacherName,
      role: 'teacher',
      approval: 'pending',
      departmentId: department!.id
    })

    // 审批是唯一由测试直接发送的写请求，只传 schema 允许的两个字段。
    const approved = await api<CampusUser>(
      adminPage,
      `/admin/accounts/${encodeURIComponent(pendingTeacher.id)}/status`,
      'POST',
      {
        approval: 'approved',
        version: pendingTeacher.version
      }
    )
    expect(approved).toMatchObject({ id: pendingTeacher.id, approval: 'approved', version: pendingTeacher.version + 1 })
    const teacherSession = await login(teacherPage, teacherAccount, '/teacher/home')
    expect(teacherSession.user).toMatchObject({
      id: pendingTeacher.id,
      role: 'teacher',
      name: teacherName,
      departmentId: department!.id,
      department: department!.name,
      approval: 'approved'
    })
    await expect(
      teacherPage.locator('.teacher-home-page').getByRole('heading', { name: '我发布的任务', exact: true })
    ).toBeVisible()
    await expectProfile(teacherPage, teacherSession.user!)
    await page.reload()
    await expect(page.locator('.profile-page').getByRole('heading', { name: studentName, exact: true })).toBeVisible()
    await expect(adminPage.locator('.admin-account-summary strong')).toHaveText('端到端管理员')
  } finally {
    await Promise.all([teacherContext.close(), adminContext.close()])
  }
})

async function expectNoPageOverflow(page: Page, width: number) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    client: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    scrollX: window.scrollX
  }))
  const context = `${width}px ${new URL(page.url()).pathname}: ${JSON.stringify(dimensions)}`
  expect(dimensions.viewport, context).toBe(width)
  expect(dimensions.document, context).toBeLessThanOrEqual(dimensions.client)
  expect(dimensions.body, context).toBeLessThanOrEqual(dimensions.client)
  expect(dimensions.scrollX, context).toBe(0)
  for (const selector of ['.admin-topbar', '.admin-main-content', '.admin-module-page']) {
    const bounds = await page.locator(selector).boundingBox()
    expect(bounds, `${context} ${selector}`).not.toBeNull()
    expect(bounds!.x, selector).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width, selector).toBeLessThanOrEqual(width)
  }
}

async function expectSidebarClosed(page: Page) {
  await expect(page.locator('.admin-sidebar')).not.toHaveClass(/is-open/)
  // 抽屉用 transform 移出屏幕，并非 display:none，不能用 toBeHidden 代替。
  await expect(page.locator('.admin-sidebar')).not.toBeInViewport()
  await expect(page.locator('.admin-sidebar-mask')).toHaveCount(0)
}

async function openSidebar(page: Page) {
  await page.getByRole('button', { name: '打开后台导航', exact: true }).click()
  await expect(page.locator('.admin-sidebar')).toHaveClass(/is-open/)
  await expect(page.locator('.admin-sidebar')).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.admin-sidebar-mask')).toBeVisible()
  await expect(page.locator('.admin-sidebar').getByRole('button', { name: '关闭后台导航', exact: true })).toBeFocused()
}

async function expectFullyReadable(locator: Locator, width: number) {
  await expect(locator).toBeVisible()
  await locator.scrollIntoViewIfNeeded()
  await expect(locator).toBeInViewport()
  const dimensions = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const box = (value: DOMRect) => ({ left: value.left, right: value.right, top: value.top, bottom: value.bottom })
    const clip = { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight }
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      const bounds = ancestor.getBoundingClientRect()
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        clip.left = Math.max(clip.left, bounds.left + ancestor.clientLeft)
        clip.right = Math.min(clip.right, bounds.left + ancestor.clientLeft + ancestor.clientWidth)
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        clip.top = Math.max(clip.top, bounds.top + ancestor.clientTop)
        clip.bottom = Math.min(clip.bottom, bounds.top + ancestor.clientTop + ancestor.clientHeight)
      }
    }
    const text: ReturnType<typeof box>[] = []
    // Native form controls render their values outside ordinary DOM text nodes.
    if (!element.matches('input, select, textarea')) {
      const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      while (nodes.nextNode()) {
        if (!nodes.currentNode.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(nodes.currentNode)
        text.push(...Array.from(range.getClientRects(), box))
      }
    }
    return { rect: box(rect), clip, text, content: element.scrollWidth, available: element.clientWidth }
  })
  const context = `${locator}: ${JSON.stringify(dimensions)}`
  // Fractional grid/scroll coordinates can leave less than one CSS pixel outside
  // an intersection. Check physical clipping instead of demanding ratio === 1.
  const tolerance = 1
  expect(dimensions.rect.left, context).toBeGreaterThanOrEqual(dimensions.clip.left - tolerance)
  expect(dimensions.rect.right, context).toBeLessThanOrEqual(Math.min(width, dimensions.clip.right) + tolerance)
  expect(dimensions.rect.top, context).toBeGreaterThanOrEqual(dimensions.clip.top - tolerance)
  expect(dimensions.rect.bottom, context).toBeLessThanOrEqual(dimensions.clip.bottom + tolerance)
  for (const text of dimensions.text) {
    expect(text.left, context).toBeGreaterThanOrEqual(Math.max(dimensions.rect.left, dimensions.clip.left) - tolerance)
    expect(text.right, context).toBeLessThanOrEqual(Math.min(dimensions.rect.right, dimensions.clip.right) + tolerance)
    expect(text.top, context).toBeGreaterThanOrEqual(Math.max(dimensions.rect.top, dimensions.clip.top) - tolerance)
    expect(text.bottom, context).toBeLessThanOrEqual(
      Math.min(dimensions.rect.bottom, dimensions.clip.bottom) + tolerance
    )
  }
  expect(dimensions.content, `${locator} 不应裁切文字`).toBeLessThanOrEqual(dimensions.available + 1)
}

test('桌面账号表与 390px、360px 管理员抽屉和账号卡片操作可用', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/login')
  const adminSession = await login(page, 'E2EADMIN', '/admin/home')
  const desktopNavigation = page.getByRole('navigation', { name: '管理员后台导航', exact: true })
  await expect(desktopNavigation).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('button', { name: '打开后台导航', exact: true })).toBeHidden()
  await desktopNavigation.getByRole('link', { name: '账号管理', exact: true }).click()
  await expect(page).toHaveURL('/admin/accounts')
  await expect(page.locator('.admin-page-heading h1')).toHaveText('账号管理')
  const accounts = await api<PageData<CampusUser>>(page, '/admin/accounts?page=1&pageSize=20')
  expect(accounts.items.length).toBeGreaterThan(0)
  const table = page.locator('.admin-main-content .admin-table-card')
  await expect(table).toHaveCount(1)
  await expect(table.locator('.admin-table-header')).toBeVisible()
  await expect(table.locator('.admin-table-header > span')).toHaveText(['账号信息', '角色', '组织归属', '状态', '操作'])
  await expect(table.locator('.admin-table-row')).toHaveCount(accounts.items.length)
  await expect(table.locator('.admin-user-cell span').filter({ hasText: /^E2EADMIN$/ })).toBeVisible()
  await expect(
    table.locator('.admin-table-row').first().getByRole('button', { name: '编辑', exact: true })
  ).toBeInViewport({ ratio: 1 })
  await expectNoPageOverflow(page, 1440)

  for (const width of [390, 360]) {
    await test.step(`${width}px 导航、账号卡片、设置`, async () => {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/admin/home')
      await expect(
        page.locator('.admin-page-heading').getByRole('heading', { name: '后台概览', exact: true })
      ).toBeVisible()
      await expect(page.locator('.api-load-state')).toHaveCount(0)
      await expectSidebarClosed(page)
      await expectNoPageOverflow(page, width)
      await openSidebar(page)
      const navigation = page.getByRole('navigation', { name: '管理员后台导航', exact: true })
      await expect(navigation.getByRole('link')).toHaveCount(5)
      for (const name of ['系统概览', '账号管理', '任务管理', '组织架构', '系统设置']) {
        await expect(navigation.getByRole('link', { name, exact: true })).toBeVisible()
      }
      for (const link of await navigation.getByRole('link').all()) await expect(link).toBeInViewport()
      await expectNoPageOverflow(page, width)
      await page.locator('.admin-sidebar-mask').click({ position: { x: width - 10, y: 100 } })
      await expectSidebarClosed(page)

      await openSidebar(page)
      await expect(page.getByRole('dialog', { name: '管理员后台导航', exact: true })).toHaveAttribute(
        'aria-modal',
        'true'
      )
      await page.keyboard.press('Escape')
      await expectSidebarClosed(page)
      await expect(page.getByRole('button', { name: '打开后台导航', exact: true })).toBeFocused()

      await openSidebar(page)
      await navigation.locator('a.admin-nav-link[href="/admin/accounts"]').click()
      await expect(page).toHaveURL('/admin/accounts')
      await expect(
        page.locator('.admin-page-heading').getByRole('heading', { name: '账号管理', exact: true })
      ).toBeVisible()
      await expectSidebarClosed(page)
      await expect(table).toHaveCount(1)
      await expect(table.locator('.admin-user-cell span').filter({ hasText: /^E2EADMIN$/ })).toBeVisible()
      await expect(page.getByPlaceholder('搜索姓名、账号、学院或班级', { exact: true })).toBeVisible()
      await expect(page.getByRole('combobox', { name: '按角色筛选', exact: true })).toBeVisible()
      await expect(page.getByRole('combobox', { name: '按状态筛选', exact: true })).toBeVisible()
      await expectNoPageOverflow(page, width)
      await expect(table.locator('.admin-table-header')).toBeHidden()
      await expect(table.locator('.admin-table-row')).toHaveCount(accounts.items.length)
      for (const account of accounts.items) {
        const card = table.locator('.admin-table-row').filter({ has: page.getByText(account.account, { exact: true }) })
        const fields = [
          card.locator('.admin-user-cell strong'),
          card.locator('.admin-user-cell span'),
          card.locator(':scope > span').first(),
          card.locator('.admin-organization-cell strong'),
          card.locator('.admin-status-pill')
        ]
        const values = [
          account.name,
          account.account,
          { student: '学生', teacher: '教师', admin: '管理员' }[account.role],
          account.department || '—',
          { approved: '正常', pending: '待审核', disabled: '已停用' }[account.approval]
        ]
        if (account.className) {
          fields.push(card.locator('.admin-organization-cell span'))
          values.push(`${account.grade} · ${account.className}`)
        }
        for (const [index, field] of fields.entries()) {
          await expect(field).toHaveText(values[index]!)
          await expectFullyReadable(field, width)
        }
        const statusAction = { approved: '停用', pending: '通过', disabled: '启用' }[account.approval]
        for (const name of ['编辑', statusAction, '删除']) {
          const action = card.getByRole('button', { name, exact: true })
          await expectFullyReadable(action, width)
          if (account.id === adminSession.user!.id && name !== '编辑') {
            await expect(action).toBeDisabled()
          } else {
            await expect(action).toBeEnabled()
            await action.click({ trial: true })
          }
        }
      }
      const student = accounts.items.find(account => account.role === 'student')
      expect(student, '账号卡片验收必须覆盖包含年级和班级的学生账号').toBeDefined()
      const studentCard = table
        .locator('.admin-table-row')
        .filter({ has: page.getByText(student!.account, { exact: true }) })
      await studentCard.getByRole('button', { name: '编辑', exact: true }).click()
      const editor = page.getByRole('dialog', { name: '编辑账号', exact: true })
      await expect(editor).toBeVisible()
      for (const [label, value] of [
        ['角色', student!.role],
        ['姓名', student!.name],
        ['登录账号', student!.account],
        ['所属学院 / 部门', student!.departmentId ?? ''],
        ['年级', student!.gradeId ?? ''],
        ['班级', student!.classId ?? ''],
        ['账号状态', student!.approval]
      ]) {
        // Native select labels include option text in label.textContent; use the
        // actual accessible role/name, as presented to assistive technology.
        const field = ['角色', '所属学院 / 部门', '年级', '班级', '账号状态'].includes(label!)
          ? editor.getByRole('combobox', { name: label!, exact: true })
          : editor.getByRole('textbox', { name: label!, exact: true })
        await expectFullyReadable(field, width)
        await expect(field).toHaveValue(value!)
        await expect(field).toBeEnabled()
      }
      const resetPassword = editor.getByLabel('重置密码（选填）', { exact: true })
      await expectFullyReadable(resetPassword, width)
      await resetPassword.fill('LayoutOnly@123')
      await expect(resetPassword).toHaveValue('LayoutOnly@123')
      await resetPassword.clear()
      const status = editor.getByRole('combobox', { name: '账号状态', exact: true })
      await status.selectOption('disabled')
      await expect(status).toHaveValue('disabled')
      await status.selectOption(student!.approval)
      const saveAccount = editor.getByRole('button', { name: '保存账号', exact: true })
      await expectFullyReadable(saveAccount, width)
      await saveAccount.click({ trial: true })
      await editor.getByRole('button', { name: '取消', exact: true }).click()
      await expect(editor).toBeHidden()
      await expectNoPageOverflow(page, width)

      await openSidebar(page)
      await navigation.locator('a.admin-nav-link[href="/admin/settings"]').click()
      await expect(page).toHaveURL('/admin/settings')
      await expect(
        page.locator('.admin-page-heading').getByRole('heading', { name: '系统设置', exact: true })
      ).toBeVisible()
      await expectSidebarClosed(page)
      await expect(page.locator('.api-load-state')).toHaveCount(0)
      await expect(
        page.locator('.admin-settings-main').getByRole('heading', { name: '学校品牌', exact: true })
      ).toBeVisible()
      await expect(
        page.locator('.admin-settings-side').getByRole('heading', { name: '数据导出', exact: true })
      ).toBeVisible()
      await expect(page.getByLabel('学校名称', { exact: true })).toHaveValue(/\S/)
      await expect(page.getByLabel('平台名称', { exact: true })).toHaveValue(/\S/)
      await expect(page.getByLabel('校方公告', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeVisible()
      await expectNoPageOverflow(page, width)
      await openSidebar(page)
      await expectNoPageOverflow(page, width)
      await navigation.locator('a.admin-nav-link[href="/admin/home"]').click()
      await expect(page).toHaveURL('/admin/home')
      await expectSidebarClosed(page)
    })
  }
})

test('断网启动显示明确错误和重试，恢复后忽略伪造旧演示身份并要求真实登录', async ({ page, context }) => {
  const forgedUser = {
    id: 'admin-demo',
    role: 'admin',
    account: 'ADMIN001',
    name: '伪造演示管理员',
    department: '信息化与教务管理中心',
    approval: 'approved',
    skills: []
  }
  const legacyStorage = {
    'campus-auth': JSON.stringify({
      demo: true,
      currentUserId: forgedUser.id,
      currentUser: forgedUser,
      users: [forgedUser],
      sessionReady: true
    }),
    currentUserId: forgedUser.id
  }
  await context.addInitScript(entries => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value)
  }, legacyStorage)
  const abortedRequests: string[] = []
  const apiPattern = '**/api/**'
  await context.route(apiPattern, async route => {
    abortedRequests.push(new URL(route.request().url()).pathname)
    await route.abort('internetdisconnected')
  })
  const expectLegacyStorageUnchanged = async () => {
    expect(
      await page.evaluate(
        keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])),
        Object.keys(legacyStorage)
      )
    ).toEqual(legacyStorage)
  }

  await page.goto('/admin/accounts')
  await expect(page.getByRole('heading', { name: '连接校园协作服务', exact: true })).toBeVisible()
  const loadState = page.locator('.api-load-state[role="status"]')
  await expect(loadState).toHaveCount(1)
  await expect(loadState.getByText('连接失败，请检查网络后重试', { exact: true })).toBeVisible()
  const retry = loadState.getByRole('button', { name: '重试', exact: true })
  await expect(retry).toBeVisible()
  await expect(retry).toBeEnabled()
  expect(abortedRequests).toContain('/api/auth/session')
  await expect(
    page.locator('.admin-backoffice-shell, .student-home-page, .teacher-home-page, .profile-page')
  ).toHaveCount(0)
  await expect(page.getByLabel('登录账号', { exact: true })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(forgedUser.name)
  await expectLegacyStorageUnchanged()

  await context.unroute(apiPattern)
  const [sessionResponse] = await Promise.all([
    page.waitForResponse(
      response => new URL(response.url()).pathname === '/api/auth/session' && response.request().method() === 'GET'
    ),
    retry.click()
  ])
  expect(sessionResponse.status()).toBe(200)
  expect(await sessionResponse.json()).toMatchObject({
    ok: true,
    message: expect.any(String),
    data: { user: null, csrfToken: expect.any(String) }
  })
  await expect(page).toHaveURL(
    url => url.pathname === '/login' && url.searchParams.get('redirect') === '/admin/accounts'
  )
  await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible()
  await expect(page.locator('.api-load-state')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '连接校园协作服务', exact: true })).toHaveCount(0)
  await expect(page.locator('.admin-backoffice-shell')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(forgedUser.name)
  await expectLegacyStorageUnchanged()

  const session = await login(page, 'E2EADMIN', '/admin/accounts')
  expect(session.user).toMatchObject({ role: 'admin', account: 'E2EADMIN', name: '端到端管理员', approval: 'approved' })
  expect(session.user!.id).not.toBe(forgedUser.id)
  await expect(page.locator('.admin-account-summary strong')).toHaveText('端到端管理员')
  await expect(page.locator('.admin-account-summary span')).toHaveText('E2EADMIN')
  await expect(
    page.locator('.admin-main-content .admin-user-cell span').filter({ hasText: /^E2EADMIN$/ })
  ).toBeVisible()
  await expect(page.locator('body')).not.toContainText(forgedUser.name)
  await expectLegacyStorageUnchanged()
})
