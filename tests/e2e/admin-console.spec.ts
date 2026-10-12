import { expect, request, test, type Page } from '@playwright/test'
import type { SessionData } from '../../shared/contracts.js'
import { disposeInstitutionSession, setInstitutionLocale } from './institution.js'

async function noPersonalLanguageSwitch(page: Page) {
  await expect(page.locator('.language-bar, input[name="institution-language-edition"]')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: /^(Language|语言)$/ })).toHaveCount(0)
}

test.afterEach(async ({ browser, baseURL }) => {
  await setInstitutionLocale(browser, 'zh-CN', baseURL)
})
test.afterAll(async ({ browser }) => {
  await disposeInstitutionSession(browser)
})

test('管理员创建的学生账号必须修改初始密码后才能进入首页', async ({ browser, baseURL }) => {
  await setInstitutionLocale(browser, 'zh-CN', baseURL)
  const admin = await request.newContext({ baseURL })
  const student = await browser.newContext({ baseURL })
  try {
    const anonymousResponse = await admin.get('/api/auth/session')
    expect(anonymousResponse.status()).toBe(200)
    const anonymous = (await anonymousResponse.json()).data as SessionData
    const login = await admin.post('/api/auth/login', {
      headers: { Origin: new URL(baseURL!).origin, 'X-CSRF-Token': anonymous.csrfToken },
      data: { account: 'E2EADMIN', password: 'E2E@Browser123' }
    })
    expect(login.status(), await login.text()).toBe(200)
    const session = (await login.json()).data as SessionData
    const account = `B2STUDENT${Date.now()}`
    const initialPassword = 'E2E@Initial456'
    const created = await admin.post('/api/admin/accounts', {
      headers: { Origin: new URL(baseURL!).origin, 'X-CSRF-Token': session.csrfToken },
      data: {
        role: 'student',
        account,
        name: 'Fictional password-change student',
        departmentId: 'dept-cs',
        gradeId: 'grade-2024',
        classId: 'class-24se1',
        password: initialPassword,
        approval: 'approved'
      }
    })
    expect(created.status(), await created.text()).toBe(201)

    const page = await student.newPage()
    await page.goto('/login')
    await page.getByLabel('登录账号', { exact: true }).fill(account)
    await page.getByLabel('登录密码', { exact: true }).fill(initialPassword)
    await page.getByRole('button', { name: '登 录', exact: true }).click()
    await expect(page).toHaveURL('/account/password')
    await expect(page.getByRole('heading', { name: '设置新密码', exact: true })).toBeVisible()
    await page.goto('/student/home')
    await expect(page).toHaveURL('/account/password')
    await page.getByLabel('当前密码', { exact: true }).fill(initialPassword)
    await page.getByLabel('新密码', { exact: true }).fill('E2E@Renewed789')
    await page.getByLabel('确认新密码', { exact: true }).fill('E2E@Renewed789')
    await page.getByRole('button', { name: '更新密码', exact: true }).click()
    await expect(page).toHaveURL('/student/home')
  } finally {
    await student.close()
    await admin.dispose()
  }
})

test('管理员保存机构语言后，已有成员会话和公共入口统一采用新版本', async ({ browser, page, baseURL }, testInfo) => {
  await setInstitutionLocale(browser, 'zh-CN', baseURL)
  const member = await browser.newContext({ baseURL })
  const visitor = await browser.newContext({ baseURL })
  try {
    await member.addInitScript(() => localStorage.setItem('campus.locale', 'en'))
    const memberPage = await member.newPage()
    await memberPage.goto('/login')
    await expect(memberPage.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await memberPage.getByLabel('登录账号', { exact: true }).fill('E2ETEACHER')
    await memberPage.getByLabel('登录密码', { exact: true }).fill('E2E@Browser123')
    await memberPage.getByRole('button', { name: '登 录', exact: true }).click()
    await expect(memberPage).toHaveURL('/teacher/home')
    await noPersonalLanguageSwitch(memberPage)
    const publicPage = await visitor.newPage()
    await publicPage.goto('/login')
    await expect(publicPage.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await noPersonalLanguageSwitch(publicPage)

    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/login')
    await page.getByLabel('登录账号', { exact: true }).fill('E2EADMIN')
    await page.getByLabel('登录密码', { exact: true }).fill('E2E@Browser123')
    await page.getByRole('button', { name: '登 录', exact: true }).click()
    await expect(page).toHaveURL('/admin/home')
    await page
      .getByRole('navigation', { name: '管理员后台导航', exact: true })
      .getByRole('link', { name: '系统设置', exact: true })
      .click()
    await expect(page).toHaveURL('/admin/settings')
    const edition = page.getByRole('radio', { name: '英文版', exact: true })
    await edition.check()
    await expect(page.locator('.admin-unsaved-note')).toHaveText('未保存')
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    const before = await page.request.get('/api/school')
    expect((await before.json()).data.defaultLocale).toBe('zh-CN')
    const [saved] = await Promise.all([
      page.waitForResponse(
        response => new URL(response.url()).pathname === '/api/admin/school' && response.request().method() === 'PUT'
      ),
      page.getByRole('button', { name: '保存设置', exact: true }).click()
    ])
    expect(saved.status(), await saved.text()).toBe(200)
    expect((await saved.json()).data.defaultLocale).toBe('en')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('radio', { name: 'English edition', exact: true })).toBeChecked()
    await expect(page.locator('.admin-unsaved-note')).toHaveCount(0)
    await expect(page.locator('.language-bar')).toHaveCount(0)

    for (const [width, height] of [
      [1440, 1000],
      [768, 1024],
      [390, 844]
    ] as const) {
      await page.setViewportSize({ width, height })
      const save = page.getByRole('button', { name: 'Save settings', exact: true })
      await save.scrollIntoViewIfNeeded()
      await expect(save).toBeInViewport({ ratio: 1 })
      const dimensions = await save.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return {
          left: rect.left,
          right: rect.right,
          height: rect.height,
          scroll: element.scrollWidth,
          client: element.clientWidth
        }
      })
      expect(dimensions.left).toBeGreaterThanOrEqual(0)
      expect(dimensions.right).toBeLessThanOrEqual(width)
      expect(dimensions.height).toBeGreaterThanOrEqual(36)
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
      ).toBe(true)
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
      await expect(page.locator('.van-toast:visible')).toHaveCount(0)
      await expect
        .poll(() => page.locator('.admin-topbar').evaluate(element => element.getBoundingClientRect().top))
        .toBe(0)
      await page.screenshot({ path: testInfo.outputPath(`admin-settings-en-${width}.png`), fullPage: true })
    }

    for (const other of [memberPage, publicPage]) {
      await other.reload()
      await expect(other.locator('html')).toHaveAttribute('lang', 'en')
      await noPersonalLanguageSwitch(other)
    }
    await expect(memberPage).toHaveURL('/teacher/home')
    const session = await member.request.get('/api/auth/session')
    expect((await session.json()).data).toMatchObject({ locale: 'en', user: { account: 'E2ETEACHER', locale: 'en' } })
    await publicPage.goto('/register/student')
    await expect(publicPage.locator('html')).toHaveAttribute('lang', 'en')
    await expect(publicPage.getByRole('button', { name: 'Create an account', exact: true })).toBeVisible()
    await noPersonalLanguageSwitch(publicPage)
  } finally {
    await member.close()
    await visitor.close()
  }
})
