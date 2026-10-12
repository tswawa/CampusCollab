import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { Temporal } from '@js-temporal/polyfill'
import sharp from 'sharp'

const password = 'E2E@Browser123'

type ApiResponse<T> = { status: number; body: { ok: boolean; message: string; code?: string; data?: T } }

async function login(page: Page, account: string, expectedPath: string) {
  await page.goto('/login')
  await page.getByLabel('登录账号').fill(account)
  await page.getByLabel('登录密码').fill(password)
  await page.getByRole('button', { name: /登 录/ }).click()
  await expect(page).toHaveURL(new RegExp(expectedPath.replaceAll('/', '\\/')))
}

async function api<T>(page: Page, path: string, method = 'GET', body?: unknown): Promise<ApiResponse<T>> {
  return page.evaluate(
    async ({ path, method, body }) => {
      const session = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' }).then(
        response => response.json()
      )
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (method !== 'GET') {
        headers['Content-Type'] = 'application/json'
        headers['X-CSRF-Token'] = session.data.csrfToken
      }
      const response = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
      })
      return { status: response.status, body: await response.json() }
    },
    { path, method, body }
  )
}

async function contextPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  return { context, page: await context.newPage() }
}

test('生产构建在独立会话完成真实任务闭环、冲突保护和账号失效', async ({ browser, page }) => {
  await page.goto('/admin/tasks')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await expect(page.getByLabel('登录账号')).toBeVisible()
  await login(page, 'E2EADMIN', '/admin/home')
  await expect(page.locator('.admin-backoffice-shell')).toBeVisible()

  const teacher = await contextPage(browser)
  const student = await contextPage(browser)
  const secondAdmin = await contextPage(browser)
  try {
    await login(teacher.page, 'E2ETEACHER', '/teacher/home')
    await login(student.page, 'E2ESTUDENT', '/student/home')
    await login(secondAdmin.page, 'E2EADMIN', '/admin/home')

    const observed = Temporal.Now.zonedDateTimeISO('Asia/Shanghai').toPlainDate()
    const instructedCurrent = Temporal.PlainDate.from('2026-09-09')
    const base = Temporal.PlainDate.compare(observed, instructedCurrent) < 0 ? instructedCurrent : observed
    const taskDate = base.add({ days: 3 }).toString()
    const deadlineDate = base.add({ days: 2 }).toString()
    const title = `浏览器端到端设备登记-${Date.now()}`
    const created = await api<{ id: string }>(teacher.page, '/tasks', 'POST', {
      title,
      categoryId: 'category-device',
      campusId: 'campus-main',
      description: '通过生产页面验证接单、真实图片上传、退回重提和最终验收。',
      checklist: ['核对设备编号', '登记异常情况'],
      date: taskDate,
      startTime: '14:00',
      endTime: '16:00',
      signupDeadline: `${deadlineDate} 20:00`,
      place: '实验楼 B302',
      duration: '约 2 小时',
      capacity: 1,
      audienceScope: 'department',
      audienceId: 'dept-cs',
      requirements: ['细心负责'],
      proofTypes: ['image', 'text'],
      claimMode: 'direct',
      contacts: [{ type: 'office', label: '办公地点', value: '实验楼 B302' }]
    })
    expect(created.status).toBe(201)
    const taskId = created.body.data!.id

    await student.page.goto('/student/tasks')
    const card = student.page.locator('.campus-task-card').filter({ hasText: title })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: '立即接取' }).click()
    await expect(student.page.getByText('接取操作成功')).toBeVisible()
    await student.page.goto(`/tasks/${taskId}`)
    await expect(student.page.getByRole('button', { name: '开始任务' })).toBeVisible()
    await student.page.getByRole('button', { name: '开始任务' }).click()
    await expect(student.page.getByRole('button', { name: '提交完成凭证' })).toBeVisible()
    await student.page.getByRole('button', { name: '提交完成凭证' }).click()
    await expect(student.page.locator('.proof-form-container')).toBeVisible()

    const png = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#246A49' } })
      .png()
      .toBuffer()
    await student.page
      .locator('input[type=file][multiple]')
      .setInputFiles({ name: '现场凭证.png', mimeType: 'image/png', buffer: png })
    await expect(student.page.locator('.proof-img-thumb img')).toHaveCount(1)
    await student.page.getByLabel('完成说明').fill('已完成设备编号核对、异常登记和现场交接。')
    await student.page.getByLabel('补充备注').fill('生产端真实图片上传')
    await student.page.getByRole('button', { name: '提交完成凭证' }).click()
    await expect(student.page).toHaveURL(new RegExp(`/tasks/${taskId}$`))
    await student.page.goto(`/tasks/${taskId}`)
    await expect(student.page.getByText('待老师验收')).toBeVisible()

    await teacher.page.goto(`/teacher/review?task=${taskId}`)
    const review = teacher.page.locator('.review-item-card').filter({ hasText: title })
    await expect(review).toBeVisible()
    await expect(review.locator('img')).toHaveJSProperty('naturalWidth', 80)
    await review.locator('textarea').fill('请补充设备总数和异常处理结果。')
    await review.getByRole('button', { name: '退回' }).click()
    await expect(teacher.page.locator('.campus-empty')).toBeVisible()

    await student.page.goto(`/tasks/${taskId}`)
    await expect(student.page.getByText('请补充设备总数和异常处理结果。')).toBeVisible()
    await student.page.getByRole('button', { name: '按意见修改并重新提交' }).click()
    await expect(student.page.locator('.proof-img-thumb img')).toHaveCount(1)
    await student.page.getByLabel('完成说明').fill('共核对 36 台设备，2 台标签磨损已登记并移交管理员处理。')
    await student.page.getByRole('button', { name: '提交完成凭证' }).click()
    await expect(student.page).toHaveURL(new RegExp(`/tasks/${taskId}$`))

    await teacher.page.goto(`/teacher/review?task=${taskId}`)
    const finalReview = teacher.page.locator('.review-item-card').filter({ hasText: title })
    await expect(finalReview).toBeVisible()
    await finalReview.locator('textarea').fill('补充完整，验收通过。')
    await finalReview.getByLabel('负责人确认分钟数').fill('90')
    await finalReview.getByRole('button', { name: '通过' }).click()
    await expect(teacher.page.locator('.campus-empty')).toBeVisible()

    await student.page.goto(`/tasks/${taskId}`)
    await expect(student.page.getByText('该任务已完成')).toBeVisible()
    await student.page.reload()
    await expect(student.page.getByText('补充完整，验收通过。')).toBeVisible()
    await student.page.goto('/notifications')
    await expect(student.page.getByText('完成材料需修改（补正）', { exact: true })).toBeVisible()
    await expect(student.page.getByText('完成材料已通过审核', { exact: true })).toBeVisible()
    await student.page.getByRole('button', { name: '全部标为已读' }).click()
    await expect(student.page.getByText(/0 条未读/)).toBeVisible()

    await page.goto(`/admin/tasks?task=${taskId}`)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.getByText('参与学生与凭证')).toBeVisible()
    await expect(page.locator('.admin-table-row').filter({ hasText: title }).locator('.admin-task-status')).toHaveText(
      '已完成'
    )
    await page.getByRole('button', { name: '关闭任务详情', exact: true }).click()
    await page
      .locator('.admin-table-row')
      .filter({ hasText: title })
      .getByRole('button', { name: '编辑', exact: true })
      .click()
    const taskEditor = page.getByRole('dialog', { name: '编辑任务', exact: true })
    await expect(taskEditor.getByText('当前状态', { exact: true })).toBeVisible()
    await expect(taskEditor).not.toContainText('执行进度由接单与验收更新')
    await expect(taskEditor.getByLabel('任务名称', { exact: true })).toHaveValue(title)
    await expect(taskEditor.getByRole('button', { name: '保存任务', exact: true })).toBeEnabled()
    await taskEditor.getByRole('button', { name: '取消', exact: true }).click()

    const schoolA = await api<{
      version: number
      name: string
      platformName: string
      badge: string
      announcement: string
      primaryColor: string
    }>(page, '/school')
    const schoolB = await api<typeof schoolA.body.data>(secondAdmin.page, '/school')
    const schoolPayload = (school: NonNullable<typeof schoolA.body.data>) => ({
      name: school.name,
      platformName: school.platformName,
      badge: school.badge,
      announcement: school.announcement,
      primaryColor: school.primaryColor,
      version: school.version
    })
    const updateA = await api(page, '/admin/school', 'PUT', {
      ...schoolPayload(schoolA.body.data!),
      announcement: '多会话品牌同步公告',
      version: schoolA.body.data!.version
    })
    expect(updateA.status).toBe(200)
    const staleB = await api(secondAdmin.page, '/admin/school', 'PUT', {
      ...schoolPayload(schoolB.body.data!),
      announcement: '不应覆盖的旧版本公告',
      version: schoolB.body.data!.version
    })
    expect(staleB.status).toBe(409)
    expect(staleB.body.code).toBe('STALE_VERSION')
    await student.page.goto('/student/home')
    await expect(student.page.getByText('多会话品牌同步公告')).toBeVisible()

    const accounts = await api<{ items: Array<{ id: string; account: string; approval: string; version: number }> }>(
      page,
      '/admin/accounts?pageSize=100'
    )
    const studentAccount = accounts.body.data!.items.find(item => item.account === 'E2ESTUDENT')!
    const disabled = await api<{ version: number }>(page, `/admin/accounts/${studentAccount.id}/status`, 'POST', {
      approval: 'disabled',
      version: studentAccount.version
    })
    expect(disabled.status).toBe(200)
    await student.page.goto('/student/home')
    await expect(student.page).toHaveURL(/\/login\?redirect=/)
    const enabled = await api(page, `/admin/accounts/${studentAccount.id}/status`, 'POST', {
      approval: 'approved',
      version: disabled.body.data!.version
    })
    expect(enabled.status).toBe(200)

    const unknown = await api(page, '/does-not-exist')
    expect(unknown.status).toBe(404)
    expect(unknown.body.code).toBe('API_NOT_FOUND')
    expect(await page.evaluate(() => document.cookie)).toBe('')
    expect(
      await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some(entry => entry.name.includes('/src/') || entry.name.includes('/@vite/'))
      )
    ).toBe(false)
    const response = await page.request.get('/admin/tasks')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-security-policy']).toContain("default-src 'self'")
    expect(response.headers()['strict-transport-security']).toBeUndefined()
  } finally {
    await Promise.all([teacher.context.close(), student.context.close(), secondAdmin.context.close()])
  }
})
