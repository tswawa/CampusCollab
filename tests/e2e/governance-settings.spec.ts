import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('登录账号', { exact: true }).fill('E2EADMIN')
  await page.getByLabel('登录密码', { exact: true }).fill('E2E@Browser123')
  await page.getByRole('button', { name: '登 录', exact: true }).click()
  await expect(page).toHaveURL('/admin/home')
}
const item = {
  taskId: 'task_cleanup_fixture',
  title: '校园花园维护',
  taskVersion: 1,
  lastSnapshotAt: '2020-01-01T00:00:00Z',
  eligibleAt: '2021-01-01T00:00:00Z',
  eligible: true,
  counts: { participants: 8, revisions: 7, snapshots: 1, files: 2, fileBytes: 1024, notices: 3 },
  blockers: [] as Array<{ code: string; count: number }>,
  previewHash: 'a'.repeat(64)
}
const overview = (items: (typeof item)[], pendingFileDeletions = 0) => ({
  retentionDays: 365,
  items,
  pendingFileDeletions,
  page: 1,
  pageSize: 100,
  total: items.length,
  automaticDeletion: false,
  backupDeletionAutomatic: false
})
const success = (data: unknown) => ({ ok: true, data, message: '已保存' })

test('设置按分区加载，未到期无删除入口，邮件未知结果重发需确认', async ({ page }, testInfo) => {
  let mailReads = 0
  let retries = 0
  let failedMail = false
  await page.route(/\/api\/admin\/retention(?:\?.*)?$/, route =>
    route.fulfill({
      json: success(
        overview([
          {
            ...item,
            eligible: false,
            eligibleAt: '2099-01-01T00:00:00Z',
            blockers: [{ code: 'RETENTION_NOT_DUE', count: 1 }]
          }
        ])
      )
    })
  )
  await page.route('**/api/admin/mail-deliveries', route => {
    mailReads++
    return route.fulfill({
      json: success({
        enabled: failedMail,
        counts: { pending: 0, sending: 0, accepted: 0, failed: failedMail ? 1 : 0 },
        items: failedMail
          ? [
              {
                id: 'mail_fixture',
                recipientName: '陈老师',
                status: 'failed',
                attempts: 1,
                errorCode: 'MAIL_OUTCOME_UNKNOWN',
                updatedAt: '2026-10-08T01:00:00Z'
              }
            ]
          : []
      })
    })
  })
  await page.route('**/api/admin/mail-deliveries/mail_fixture/retry', route => {
    retries++
    expect(route.request().postDataJSON()).toEqual({})
    return route.fulfill({ json: success(null) })
  })
  await signIn(page)
  await page.goto('/admin/governance')
  await expect(page).toHaveURL('/admin/settings/data')
  const main = page.locator('#main-content')
  await expect(main.getByRole('heading', { name: '数据管理', exact: true })).toBeVisible()
  await expect(main.getByText('365 天', { exact: true })).toBeVisible()
  expect(mailReads).toBe(0)
  await expect(main).not.toContainText('SMTP')
  await expect(main).not.toContainText(item.taskId)
  await main.locator('summary').filter({ hasText: '已结项任务' }).click()
  await expect(main.getByText('保存中', { exact: true })).toBeVisible()
  await expect(main.getByRole('button', { name: '查看清理范围', exact: true })).toHaveCount(0)
  await expect(main.getByRole('button', { name: '永久删除', exact: true })).toHaveCount(0)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`data-settings-${width}.png`), fullPage: true })
  }
  await main.getByRole('link', { name: '修改', exact: true }).click()
  await expect(page).toHaveURL('/admin/settings#retention-settings')
  await expect(page.getByLabel('结项后保存天数', { exact: true })).toBeInViewport()
  await page
    .getByRole('navigation', { name: '系统设置', exact: true })
    .getByRole('link', { name: '通知设置', exact: true })
    .click()
  await expect(main.getByText('未启用', { exact: true })).toBeVisible()
  await expect(main.getByText('使用中', { exact: true })).toBeVisible()
  await expect(main.getByText('等待发送', { exact: true })).toHaveCount(0)
  await expect(main).not.toContainText('SMTP')
  await page.screenshot({ path: testInfo.outputPath('notification-settings-mobile.png'), fullPage: true })
  failedMail = true
  await page.reload()
  await expect(main.getByText('陈老师', { exact: true })).toBeVisible()
  await main.getByRole('button', { name: '重新发送', exact: true }).click()
  const confirmation = page.getByRole('dialog').filter({ hasText: '投递结果未知；重试可能重复发送。' })
  await expect(confirmation).toContainText('重试可能重复发送')
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  expect(retries).toBe(0)
  await main.getByRole('button', { name: '重新发送', exact: true }).click()
  await confirmation.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => retries).toBe(1)
})

test('清理重新读取版本，冲突后要求刷新，任务移除后仍可重试附件', async ({ page }) => {
  let purged = false
  let pending = 0
  let previews = 0
  let purges = 0
  let fileRetries = 0
  await page.route(/\/api\/admin\/retention(?:\?.*)?$/, route =>
    route.fulfill({ json: success(overview(purged ? [] : [item], pending)) })
  )
  await page.route('**/api/admin/retention/tasks/task_cleanup_fixture/preview', route => {
    previews++
    return route.fulfill({
      json: success({ ...item, taskVersion: previews + 1, previewHash: (previews === 1 ? 'b' : 'c').repeat(64) })
    })
  })
  await page.route('**/api/admin/retention/tasks/task_cleanup_fixture/purge', route => {
    purges++
    expect(route.request().postDataJSON()).toEqual({
      version: purges + 1,
      previewHash: (purges === 1 ? 'b' : 'c').repeat(64),
      confirmation: item.taskId
    })
    if (purges === 1)
      return route.fulfill({
        status: 409,
        json: { ok: false, code: 'RETENTION_PREVIEW_STALE', message: '请重新预览清理范围' }
      })
    purged = true
    pending = 1
    return route.fulfill({
      json: success({ purged: true, files: { processed: 2, deleted: 1, failed: 1, pending: 1 } })
    })
  })
  await page.route('**/api/admin/retention/files/retry', route => {
    fileRetries++
    pending = 0
    return route.fulfill({ json: success({ processed: 1, deleted: 1, failed: 0, pending: 0 }) })
  })
  await signIn(page)
  await page.goto('/admin/settings/data')
  await page.getByRole('button', { name: '查看清理范围', exact: true }).click()
  expect(previews).toBe(1)
  const preview = page.getByRole('dialog', { name: '清理确认', exact: true })
  const remove = preview.getByRole('button', { name: '永久删除', exact: true })
  await expect(remove).toBeDisabled()
  await preview.getByRole('textbox').fill('wrong-task')
  await expect(remove).toBeDisabled()
  await preview.getByRole('textbox').fill(item.taskId)
  await remove.click()
  const finalConfirmation = page.getByRole('dialog').filter({ hasText: '确认永久删除？' })
  await expect(finalConfirmation).toContainText('账号保留')
  await finalConfirmation.getByRole('button', { name: '永久删除', exact: true }).click()
  await expect(preview.getByRole('alert')).toContainText('请重新核对清理范围')
  await expect(remove).toBeDisabled()
  await expect(preview.getByRole('textbox')).toHaveValue('')
  await preview.getByRole('button', { name: '重新检查', exact: true }).click()
  await expect(preview.getByRole('textbox')).toBeEnabled()
  await preview.getByRole('textbox').fill(item.taskId)
  await remove.click()
  await finalConfirmation.getByRole('button', { name: '永久删除', exact: true }).click()
  await expect(preview).toBeHidden()
  await expect(page.getByRole('alert')).toContainText('部分附件仍待处理')
  await page.getByRole('button', { name: '重试清理', exact: true }).click()
  await expect.poll(() => fileRetries).toBe(1)
  await expect(page.getByRole('button', { name: '重试清理', exact: true })).toHaveCount(0)
  expect(purges).toBe(2)
})
