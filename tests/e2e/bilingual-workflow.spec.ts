import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { Temporal } from '@js-temporal/polyfill'
import type { CampusTask } from '../../shared/contracts.js'
import type { TaskWorkflow, WorkflowParticipant, WorkflowSnapshot } from '../../shared/workflow-contracts.js'
import { disposeInstitutionSession, setInstitutionLocale } from './institution.js'

async function expandDetails(summary: Locator) {
  const details = summary.locator('..')
  if ((await details.getAttribute('open')) === null) await summary.click()
  await expect(details).toHaveJSProperty('open', true)
}

async function expectNoPersonalLanguageControl(page: Page) {
  await expect(page.getByRole('combobox', { name: /^(语言|Language)$/ })).toHaveCount(0)
  await expect(page.locator('.language-bar')).toHaveCount(0)
}

test.afterEach(async ({ browser, baseURL }) => {
  await setInstitutionLocale(browser, 'zh-CN', baseURL)
})
test.afterAll(async ({ browser }) => {
  await disposeInstitutionSession(browser)
})

async function assertContentFits(scope: Locator) {
  const issues = () =>
    scope.locator('button, .roster-row, .roster-table-wrap, .roster-identity strong').evaluateAll(elements => {
      const failures: string[] = []
      const visible = (element: Element) =>
        element.checkVisibility({ checkVisibilityCSS: true }) && element.getBoundingClientRect().width > 0
      const buttons: Array<{ name: string; rect: DOMRect }> = []
      for (const element of elements.filter(visible)) {
        const rect = element.getBoundingClientRect()
        const name = element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 90) || element.tagName
        let left = 0
        let right = window.innerWidth
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) {
            const parentRect = parent.getBoundingClientRect()
            left = Math.max(left, parentRect.left + parent.clientLeft)
            right = Math.min(right, parentRect.left + parent.clientLeft + parent.clientWidth)
          }
        }
        if (rect.left < left - 1 || rect.right > right + 1) failures.push(`Clipped horizontally: ${name}`)
        if (element.tagName === 'BUTTON') {
          if (rect.height < 36) failures.push(`Button too short to operate: ${name}`)
          if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
            failures.push(`Button content overflows: ${name}`)
          buttons.push({ name, rect })
        }
        if (element.tagName === 'BUTTON' || element.matches('.roster-identity strong')) {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent?.trim()) continue
            const range = document.createRange()
            range.selectNodeContents(walker.currentNode)
            for (const textRect of range.getClientRects()) {
              if (
                textRect.left < Math.max(left, rect.left) - 1 ||
                textRect.right > Math.min(right, rect.right) + 1 ||
                textRect.top < rect.top - 1 ||
                textRect.bottom > rect.bottom + 1
              )
                failures.push(`Text leaves its control: ${name}`)
            }
          }
        }
      }
      for (let a = 0; a < buttons.length; a++)
        for (let b = a + 1; b < buttons.length; b++) {
          const first = buttons[a]!
          const second = buttons[b]!
          if (
            Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left) > 1 &&
            Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top) > 1
          )
            failures.push(`Overlapping buttons: ${first.name} / ${second.name}`)
        }
      return failures
    })
  await expect.poll(issues, { message: 'Primary content must fit even when an ancestor hides overflow' }).toEqual([])
}

async function assertResponsiveWorkspace(
  page: Page,
  testInfo: TestInfo,
  stage: 'open' | 'closed',
  label: (zh: string, en: string) => string
) {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.evaluate(() => window.scrollTo(0, 0))
    await expectNoPersonalLanguageControl(page)
    // The overview exposes the main roster's real counts in the initial viewport.
    // Its position is a usability outcome, independent of card count or grid implementation.
    await expect(page.getByRole('region', { name: label('名单进度', 'Roster progress'), exact: true })).toBeInViewport({
      ratio: 1
    })
    await expect(
      page.getByRole('heading', { name: new RegExp(`^${label('名单工作台', 'Roster workspace')}`) })
    ).toBeInViewport()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `${viewport.name}: document overflow`
    ).toBe(true)
    await assertContentFits(page.locator('.workflow-page'))
    await page.screenshot({
      path: testInfo.outputPath(`workflow-${stage === 'open' ? 'open-' : ''}${viewport.name}.png`),
      fullPage: true
    })
  }
}

async function api<T>(page: Page, path: string, method = 'GET', body?: unknown): Promise<T> {
  const result = await page.evaluate(
    async ({ path, method, body }) => {
      const session = await fetch('/api/auth/session').then(r => r.json())
      const response = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.data.csrfToken,
          'Accept-Language': 'en'
        },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
      })
      return { status: response.status, payload: await response.json() }
    },
    { path, method, body }
  )
  expect(result.status, `${path}: ${JSON.stringify(result.payload)}`).toBeLessThan(400)
  expect(result.payload.ok).toBe(true)
  return result.payload.data as T
}

test('public registration follows institution language and ignores a legacy personal preference', async ({
  browser,
  page,
  baseURL
}) => {
  await page.addInitScript(() => localStorage.setItem('campus.locale', 'en'))
  for (const language of ['zh-CN', 'en'] as const) {
    await setInstitutionLocale(browser, language, baseURL)
    await page.goto('/register/student')
    await expect(page.locator('html')).toHaveAttribute('lang', language)
    await expectNoPersonalLanguageControl(page)
    await page.getByLabel(language === 'en' ? 'Name' : '真实姓名', { exact: true }).fill('Alex Morgan')
    await expect(page.getByLabel(language === 'en' ? 'Name' : '真实姓名', { exact: true })).toHaveValue('Alex Morgan')
    await expect(
      page.getByRole('button', { name: language === 'en' ? 'Create an account' : '注册账号', exact: true })
    ).toBeVisible()
  }
})

for (const language of ['zh-CN', 'en'] as const) {
  test(`eight-person roster closes out six confirmed and two incomplete in ${language}`, async ({
    browser,
    page,
    baseURL
  }, testInfo) => {
    test.setTimeout(120_000)
    const en = language === 'en'
    const label = (zh: string, english: string) => (en ? english : zh)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await setInstitutionLocale(browser, language, baseURL)
    await page.goto('/login')
    await api(page, '/auth/login', 'POST', { account: 'E2ETEACHER', password: 'E2E@Browser123' })
    const date = Temporal.Now.zonedDateTimeISO('Asia/Shanghai').toPlainDate().add({ days: 4 }).toString()
    const created = await api<CampusTask>(page, '/tasks', 'POST', {
      title: `Garden session ${language} ${Date.now()}`,
      categoryId: 'category-device',
      campusId: 'campus-main',
      description: 'Synthetic community garden task for eight participants.',
      checklist: ['Record actual participation'],
      date,
      startTime: '14:00',
      endTime: '16:00',
      signupDeadline: `${date} 12:00`,
      place: 'Community garden',
      duration: '2 hours planned',
      capacity: 8,
      audienceScope: 'school',
      requirements: [],
      proofTypes: ['text'],
      claimMode: 'direct',
      contacts: [],
      workflow: {
        templateId: 'community-garden',
        templateVersion: 1,
        mode: 'individual',
        plannedMinutes: 120,
        submissionDeadline: null,
        personalSubmissionRequired: true
      }
    })
    const path = `/tasks/${created.id}/workflow`
    await page.goto(path)
    await expect(page.locator('html')).toHaveAttribute('lang', language)
    await expect(page.getByRole('heading', { name: created.title })).toBeVisible()
    await expandDetails(page.getByText(label('导入名单', 'Import roster'), { exact: true }))
    await page.getByLabel(label('名单来源', 'Roster source'), { exact: true }).fill('synthetic-garden-2026')
    const names = ['Alex Morgan', 'Alex Morgan', 'Sam', 'Jo Lin', 'Ari Park', 'Riley Chen', 'Taylor Kim', 'Jamie Lee']
    await page
      .getByLabel(label('也可粘贴 CSV', 'Or paste CSV'), { exact: true })
      .fill('externalId,name\n' + names.map((name, i) => `000${i + 1},${name}`).join('\n'))
    await page.getByRole('button', { name: label('预览导入', 'Preview import'), exact: true }).click()
    await expect(page.locator('.workflow-table-wrap tbody tr')).toHaveCount(8)
    await page.getByRole('button', { name: label('确认导入', 'Confirm import'), exact: true }).click()
    await expect(page.locator('.roster-row')).toHaveCount(8)
    await page.reload()
    await expect(page.locator('.roster-row')).toHaveCount(8)
    await expect(page.getByRole('button', { name: label('确认结项', 'Close out task'), exact: true })).toBeDisabled()
    await assertResponsiveWorkspace(page, testInfo, 'open', label)
    const searchLabel = label('搜索姓名或编号', 'Search name or ID')
    await page.getByLabel(searchLabel, { exact: true }).fill('0006')
    const statusFilters = page.getByRole('group', { name: label('状态筛选', 'Filter by status'), exact: true })
    await statusFilters.getByRole('button', { name: new RegExp(`^${label('未提交', 'Not submitted')}\\s*8$`) }).click()
    await expect(page.locator('.roster-row')).toHaveCount(1)
    await expect(page.locator('.roster-row')).toContainText('0006')
    const otherLanguage = en ? 'zh-CN' : 'en'
    await setInstitutionLocale(browser, otherLanguage, baseURL)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', otherLanguage)
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expectNoPersonalLanguageControl(page)
    await expect(page.locator('.roster-row')).toHaveCount(8)
    await expect(page.locator('.roster-row').filter({ hasText: '0006' })).toContainText('Riley Chen')
    await setInstitutionLocale(browser, language, baseURL)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', language)
    await expect(page.locator('.roster-row')).toHaveCount(8)
    let flow = await api<TaskWorkflow>(page, path)
    const byId = (externalId: string): WorkflowParticipant => flow.participants.find(p => p.externalId === externalId)!
    for (let i = 1; i <= 6; i++) {
      const participant = byId(`000${i}`)
      flow = await api<TaskWorkflow>(page, `${path}/submit`, 'POST', {
        participantId: participant.id,
        version: participant.version,
        description: `Completed garden activity for participant ${i}.`,
        note: '',
        fileIds: [],
        reportedMinutes: i === 6 ? 75 : 90
      })
    }
    let sixth = byId('0006')
    flow = await api<TaskWorkflow>(page, `${path}/review`, 'POST', {
      participantId: sixth.id,
      version: sixth.version,
      revisionId: sixth.latestRevisionId,
      decision: 'changes_requested',
      feedback: 'Add the garden bed number.',
      missingItems: ['Garden bed number']
    })
    await page.reload()
    const sixthRow = page.locator('.roster-row').filter({ hasText: '0006' })
    await expect(sixthRow).toContainText(label('待补正', 'Changes requested'))
    await sixthRow.getByRole('button').click()
    const dialog = page.getByRole('dialog', { name: 'Riley Chen' })
    await expect(dialog).toBeVisible()
    await assertContentFits(dialog)
    await expandDetails(dialog.getByText(label('新增提交版本', 'Submit a new version'), { exact: true }))
    await dialog
      .getByLabel(label('完成说明', 'Work description'), { exact: false })
      .fill('Completed garden bed 12; handover recorded.')
    await dialog.getByRole('button', { name: label('提交新版本', 'Submit new version'), exact: true }).click()
    await expect(dialog).toBeHidden()
    await sixthRow.getByRole('button').click()
    await expect(dialog.getByText('Completed garden bed 12; handover recorded.', { exact: true })).toBeVisible()
    await dialog.getByLabel(label('负责人确认分钟数', 'Coordinator-confirmed minutes'), { exact: false }).fill('75')
    await dialog.getByRole('button', { name: label('确认通过', 'Approve'), exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(sixthRow.getByRole('button')).toBeFocused()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: label('全选当前待审', 'Select all pending reviews'), exact: true }).click()
    await expandDetails(page.locator('.workflow-batch summary'))
    await page
      .locator('.workflow-batch')
      .getByLabel(label('负责人确认分钟数', 'Coordinator-confirmed minutes'), { exact: true })
      .fill('90')
    await page
      .locator('.workflow-batch')
      .getByRole('button', { name: label('批量确认', 'Confirm selected'), exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: label('批量处理结果', 'Results for each participant'), exact: true })
    ).toBeVisible()
    for (const id of ['0007', '0008']) {
      await page.locator('.roster-row').filter({ hasText: id }).getByRole('button').click()
      const panel = page.locator('.participant-panel')
      await expandDetails(panel.getByText(label('异常结束', 'Record an exception'), { exact: true }))
      await panel.getByLabel(label('原因', 'Reason'), { exact: false }).fill('No submission received.')
      await panel.getByRole('button', { name: label('记录结果', 'Save outcome'), exact: true }).click()
      await expect(panel).toBeHidden()
    }
    await expect(
      page
        .locator('.workspace-metric')
        .filter({ has: page.getByText(label('确认分钟', 'Confirmed minutes'), { exact: true }) })
        .locator('strong')
    ).toHaveText(en ? /^525\s*min$/ : /^525\s*分钟$/)
    await page
      .getByLabel(label('结项原因或说明', 'Closeout reason or note'), { exact: true })
      .fill('Six confirmed; two incomplete. Synthetic demonstration.')
    await page.getByRole('button', { name: label('确认结项', 'Close out task'), exact: true }).click()
    await page.locator('.van-dialog__confirm').click()
    await expect(
      page
        .locator('.snapshot-card')
        .getByRole('heading', { name: new RegExp(`^${label('结果版本 1', 'Result version 1')}`) })
    ).toBeVisible()
    await page.getByRole('button', { name: label('查看快照核对', 'Check snapshot totals'), exact: true }).click()
    await expect(page.locator('.snapshot-totals')).toHaveJSProperty('open', true)
    await expect(
      page
        .locator('.snapshot-totals')
        .getByText(label('确认合计 525 分钟', '525 coordinator-confirmed minutes in total'), { exact: true })
    ).toBeVisible()
    await expect(page.locator('.snapshot-totals tbody tr')).toHaveCount(8)
    await page.locator('.snapshot-totals > summary').click()
    const downloadEvent = page.waitForEvent('download')
    await page
      .getByRole('button', { name: label('下载结果包 ZIP', 'Download completion package ZIP'), exact: true })
      .click()
    expect((await downloadEvent).suggestedFilename()).toMatch(/\.zip$/)
    flow = await api<TaskWorkflow>(page, path)
    const snapshot = await api<WorkflowSnapshot>(page, `${path}/snapshots/${flow.snapshots[0]!.id}`)
    expect(snapshot.totals).toMatchObject({ participants: 8, completed: 6, confirmedMinutes: 525 })
    expect(snapshot.participants.filter(p => p.status === 'incomplete')).toHaveLength(2)
    expect(snapshot.participants.map(p => p.externalId).sort()).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008'
    ])
    sixth = snapshot.participants.find(p => p.externalId === '0006')!
    expect(sixth.revisions).toHaveLength(2)
    expect(sixth.confirmedRevisionId).toBe(sixth.latestRevisionId)
    await expect(page.locator('.van-toast')).toBeHidden()
    await assertResponsiveWorkspace(page, testInfo, 'closed', label)
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.tagName === 'BODY')).toBe(false)
  })
}
