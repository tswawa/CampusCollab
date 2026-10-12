import { expect, request, type APIRequestContext, type Browser } from '@playwright/test'
import type { AppLocale, SchoolProfile, SessionData } from '../../shared/contracts.js'

type InstitutionAdminSession = { context: APIRequestContext; session: SessionData; baseURL: string }
const adminSessions = new WeakMap<Browser, InstitutionAdminSession>()

async function institutionAdminSession(browser: Browser, baseURL: string) {
  const existing = adminSessions.get(browser)
  if (existing) {
    if (existing.baseURL !== baseURL) throw new Error('An administrator session cannot cross isolated E2E servers')
    return existing
  }
  // One authenticated API session per worker browser, independent of per-test page fixtures.
  // Locale changes must not consume a new production login-rate allowance each time.
  const context = await request.newContext({ baseURL })
  try {
    const anonymousResponse = await context.get('/api/auth/session')
    expect(anonymousResponse.status()).toBe(200)
    const anonymous = (await anonymousResponse.json()).data as SessionData
    const login = await context.post('/api/auth/login', {
      headers: { Origin: new URL(baseURL).origin, 'X-CSRF-Token': anonymous.csrfToken },
      data: { account: 'E2EADMIN', password: 'E2E@Browser123' }
    })
    expect(login.status()).toBe(200)
    const session = (await login.json()).data as SessionData
    const authenticated = { context, session, baseURL }
    adminSessions.set(browser, authenticated)
    return authenticated
  } catch (error) {
    await context.dispose()
    throw error
  }
}

/** Test precondition only. Actual settings interaction is covered in admin-console.spec.ts. */
export async function setInstitutionLocale(browser: Browser, locale: AppLocale, baseURL: string | undefined) {
  if (!baseURL) throw new Error('The isolated E2E baseURL is required')
  const { context, session } = await institutionAdminSession(browser, baseURL)
  const schoolResponse = await context.get('/api/school')
  expect(schoolResponse.status()).toBe(200)
  const { logo: _logo, ...school } = (await schoolResponse.json()).data as SchoolProfile
  if (school.defaultLocale !== locale) {
    const changed = await context.put('/api/admin/school', {
      headers: { Origin: new URL(baseURL).origin, 'X-CSRF-Token': session.csrfToken },
      data: { ...school, defaultLocale: locale }
    })
    expect(changed.status(), await changed.text()).toBe(200)
    expect((await changed.json()).data.defaultLocale).toBe(locale)
  }
}

export async function disposeInstitutionSession(browser: Browser) {
  const existing = adminSessions.get(browser)
  adminSessions.delete(browser)
  await existing?.context.dispose()
}
