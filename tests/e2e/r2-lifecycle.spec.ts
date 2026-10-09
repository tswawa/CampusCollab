import { expect, request, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import sharp from 'sharp'
import type { CampusTask, SessionData, UploadData } from '../../shared/contracts.js'
import type { TaskWorkflow } from '../../shared/workflow-contracts.js'

// The suite runner gives this spec its own server and temporary database.
// These are synthetic accounts and images; all setup uses authenticated public endpoints.
const password = 'E2E@Browser123'
type Actor = { http: APIRequestContext; session: SessionData; origin: string }

async function openPreview(page: Page, trigger: Locator) {
  await trigger.click()
  const preview = page.locator('.van-image-preview')
  await expect(preview).toBeVisible()
  await expect(preview.locator('img').first()).toHaveJSProperty('naturalWidth', 32)
  return preview
}

async function closePreview(page: Page) {
  const preview = page.locator('.van-image-preview')
  await preview.locator('.van-image-preview__close-icon').click()
  await expect(preview).toBeHidden()
  await expect(preview.locator('img')).toHaveCount(0)
}

test('evidence previews remain usable and close with their page or revoked session', async ({ page, baseURL }) => {
  expect(baseURL).toBeTruthy()
  const actors: Actor[] = []
  const login = async (account: string): Promise<Actor> => {
    const http = await request.newContext({ baseURL })
    const anonymous = (await (await http.get('/api/auth/session')).json()).data as SessionData
    const response = await http.post('/api/auth/login', {
      headers: { Origin: baseURL!, 'X-CSRF-Token': anonymous.csrfToken }, data: { account, password }
    })
    expect(response.status(), await response.text()).toBe(200)
    const actor = { http, session: (await response.json()).data as SessionData, origin: baseURL! }
    actors.push(actor)
    return actor
  }
  const api = async <T>(actor: Actor, path: string, method = 'GET', data?: unknown): Promise<T> => {
    const response = await actor.http.fetch(`/api${path}`, {
      method, headers: { Origin: actor.origin, 'X-CSRF-Token': actor.session.csrfToken },
      ...(method === 'GET' ? {} : { data: data ?? {} })
    })
    expect(response.ok(), await response.text()).toBe(true)
    return (await response.json()).data as T
  }
  const showAs = async (actor: Actor, path: string) => {
    await page.context().addCookies((await actor.http.storageState()).cookies)
    await page.goto(path)
  }

  try {
    const admin = await login('E2EADMIN')
    const teacher = await login('E2ETEACHER')
    const student = await login('E2ESTUDENT')
    const task = await api<CampusTask>(teacher, '/tasks', 'POST', {
      title: 'Fictional evidence preview lifecycle', categoryId: 'category-event', campusId: 'campus-main',
      description: 'Synthetic picture used only to test preview lifecycle.', checklist: [],
      date: '2098-10-10', startTime: '10:00', endTime: '12:00', signupDeadline: '2098-10-09 10:00',
      place: 'Fictional room', duration: '120 minutes', capacity: 1, audienceScope: 'school',
      requirements: [], proofTypes: ['image', 'text'], claimMode: 'direct', contacts: []
    })
    await api(student, `/tasks/${task.id}/claim`, 'POST')
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#246A49' } }).png().toBuffer()
    const upload = await student.http.post(`/api/files/proof?taskId=${task.id}`, {
      headers: { Origin: student.origin, 'X-CSRF-Token': student.session.csrfToken },
      multipart: { file: { name: 'fictional.png', mimeType: 'image/png', buffer: png } }
    })
    expect(upload.status(), await upload.text()).toBe(201)
    const file = (await upload.json()).data as UploadData
    const flowPath = `/tasks/${task.id}/workflow`
    const submit = async () => {
      const participant = (await api<TaskWorkflow>(student, flowPath)).participants[0]!
      return api<TaskWorkflow>(student, `${flowPath}/submit`, 'POST', {
        participantId: participant.id, version: participant.version,
        description: 'Fictional work completed; the green square is synthetic.', note: '', fileIds: [file.id]
      })
    }
    await submit()

    // All four production entry points use the same owned-preview lifecycle.
    await showAs(teacher, `/tasks/${task.id}`)
    await openPreview(page, page.locator('.review-images-row img').first())
    await closePreview(page)

    await page.goto(`/teacher/review?task=${task.id}`)
    const thumb = page.locator('.review-images-row img')
    await expect(thumb).toHaveJSProperty('naturalWidth', 32)
    const preview = await openPreview(page, thumb)
    const validSession = page.waitForResponse(response => response.url().endsWith('/api/auth/session'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    expect((await (await validSession).json()).data.user.id).toBe(teacher.session.user!.id)
    await expect(preview).toBeVisible()
    await closePreview(page)
    await openPreview(page, thumb)

    // Trigger the rendered SPA navigation handler beneath the modal. A full reload
    // or browser back would close Vant independently and would not test page ownership.
    await page.locator('.navbar-action').dispatchEvent('click')
    await expect(page).toHaveURL(/\/notifications$/)
    await expect(preview).toBeHidden()
    await expect(preview.locator('img')).toHaveCount(0)
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/teacher/review\\?task=${task.id}$`))
    await openPreview(page, thumb)
    await expect(preview).toBeVisible()
    await closePreview(page)

    await showAs(admin, `/admin/tasks?task=${task.id}`)
    await openPreview(page, page.getByRole('button', { name: '查看 1 张凭证图片', exact: true }))
    await closePreview(page)

    const participant = (await api<TaskWorkflow>(teacher, flowPath)).participants[0]!
    await api(teacher, `${flowPath}/review`, 'POST', {
      participantId: participant.id, version: participant.version, revisionId: participant.latestRevisionId,
      decision: 'changes_requested', feedback: 'Add the fictional handover detail.'
    })
    await showAs(student, `/student/tasks/${task.id}/submit`)
    await openPreview(page, page.locator('.proof-img-thumb img'))
    await closePreview(page)
    await submit()

    // Regression for the independently reproduced R2 failure: the old body preview
    // must disappear after actual revocation, without requiring its close button.
    await showAs(teacher, `/teacher/review?task=${task.id}`)
    const revokedPreview = await openPreview(page, page.locator('.review-images-row img'))
    await api(admin, `/admin/accounts/${teacher.session.user!.id}/status`, 'POST', {
      approval: 'disabled', version: teacher.session.user!.version
    })
    const anonymousSession = page.waitForResponse(response => response.url().endsWith('/api/auth/session'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    expect((await (await anonymousSession).json()).data.user).toBeNull()
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.locator('.review-images-row')).toHaveCount(0)
    await expect(revokedPreview).toBeHidden()
    await expect(revokedPreview.locator('img')).toHaveCount(0)
    await expect(page.getByLabel('登录账号', { exact: true })).toBeVisible()
    expect((await teacher.http.get(file.url)).status()).toBe(401)
  } finally {
    for (const actor of actors) await actor.http.dispose()
  }
})
