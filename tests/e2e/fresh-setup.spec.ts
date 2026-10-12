import { expect, test } from '@playwright/test'

// scripts/test-e2e.mjs runs this spec twice, with a new empty database per edition.
test.skip(process.env.E2E_FRESH_SETUP !== '1', 'Requires the isolated fresh-installation fixture')
const locale = process.env.E2E_SETUP_LOCALE === 'zh-CN' ? 'zh-CN' : 'en'

test(`${locale}: 首次安装建立机构与管理员，成功后关闭安装入口`, async ({ page, browser, baseURL }, testInfo) => {
  const english = locale === 'en'
  const institution = english ? 'Northbridge Example University' : '首装验收示例大学'
  const platform = english ? 'Campus Collaboration' : '校园协作中心'
  const administrator = english ? 'Example Administrator' : '首装验收管理员'
  const timezone = english ? 'Europe/London' : 'Asia/Shanghai'
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/admin/home')
  await expect(page).toHaveURL('/setup')
  const state = await page.request.get('/api/installation')
  expect((await state.json()).data).toMatchObject({ status: 'required', setupAvailable: true })
  await page.locator(`input[name="edition"][value="${locale}"]`).check()
  await expect(page.locator('html')).toHaveAttribute('lang', locale)
  await expect(
    page.getByRole('heading', { name: english ? 'Choose your system edition' : '选择整套系统的语言版本', exact: true })
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath(`setup-${locale}-edition.png`), fullPage: true })
  const next = () => page.getByRole('button', { name: english ? 'Continue' : '下一步', exact: true })
  await next().click()
  await page.locator('#setup-school').fill(institution)
  await page.locator('#setup-platform').fill(platform)
  await page.locator('#setup-timezone').fill(timezone)
  await next().click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#setup-admin-name').fill(administrator)
  await page.locator('#setup-account').fill('FIRSTADMIN')
  await page.locator('#setup-password').fill('E2E@FirstSetup123')
  await page.locator('#setup-confirm').fill('E2E@FirstSetup123')
  await page.locator('#setup-token').fill('E2E-FICTIONAL-SETUP-TOKEN-0123456789')
  const create = page.getByRole('button', { name: english ? 'Create workspace' : '创建工作空间', exact: true })
  await create.scrollIntoViewIfNeeded()
  await expect(create).toBeInViewport({ ratio: 1 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  )
  const [installed] = await Promise.all([
    page.waitForResponse(
      response => new URL(response.url()).pathname === '/api/installation' && response.request().method() === 'POST'
    ),
    create.click()
  ])
  expect(installed.status(), await installed.text()).toBe(201)
  expect((await installed.json()).data).toMatchObject({
    installation: { status: 'configured', locale, setupAvailable: false },
    school: { name: institution, platformName: platform, defaultLocale: locale, timezone },
    session: { locale, user: { role: 'admin', account: 'FIRSTADMIN', name: administrator } }
  })
  await expect(page).toHaveURL('/admin/home')
  await expect(page.locator('html')).toHaveAttribute('lang', locale)
  await expect(page.locator('#main-content')).toHaveCount(1)
  await expect(page.locator('.admin-topbar-institution')).toHaveText(institution)
  await expect(page.locator('.language-bar')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath(`setup-${locale}-complete-mobile.png`), fullPage: true })
  await page.goto('/setup')
  await expect(page).toHaveURL('/admin/home')
  await expect(page.locator('#setup-token')).toHaveCount(0)
  const configured = await page.request.get('/api/installation')
  expect((await configured.json()).data).toMatchObject({ status: 'configured', locale, setupAvailable: false })

  const visitor = await browser.newContext({ baseURL })
  try {
    const anonymous = await visitor.newPage()
    await anonymous.goto('/setup')
    await expect(anonymous).toHaveURL('/login')
    await expect(anonymous.locator('html')).toHaveAttribute('lang', locale)
    await expect(anonymous.locator('#setup-token, input[name="edition"], .language-bar')).toHaveCount(0)
  } finally {
    await visitor.close()
  }
})
