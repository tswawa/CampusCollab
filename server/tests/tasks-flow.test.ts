import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Temporal } from '@js-temporal/polyfill'
import type { CampusTask, CreateTaskPayload, DashboardData, NoticePage, PageData, ReviewItem } from '../../shared/contracts.js'
import { createAdminManagedUser } from '../modules/accounts.service.js'
import { closeTestApp, createAdmin, createTestApp, dataOf, login, testOrigin } from './helpers.js'

type Session = Awaited<ReturnType<typeof login>>
const headers = (session: Session) => ({ origin: testOrigin, cookie: session.cookie, 'x-csrf-token': session.csrf })

function taskPayload(title: string, claimMode: 'direct' | 'application', capacity: number): CreateTaskPayload {
  const now = Temporal.Now.zonedDateTimeISO('Asia/Shanghai')
  const date = now.add({ days: 3 }).toPlainDate().toString()
  const deadlineDate = now.add({ days: 2 }).toPlainDate().toString()
  return {
    title,
    categoryId: 'category-device',
    campusId: 'campus-main',
    description: '这是用于验证服务端任务状态、权限和并发名额的测试任务。',
    checklist: ['按要求完成测试任务'],
    date,
    startTime: '14:00',
    endTime: '16:00',
    signupDeadline: `${deadlineDate} 20:00`,
    place: '实验楼 B302',
    duration: '约 2 小时',
    capacity,
    audienceScope: 'department',
    audienceId: 'dept-cs',
    requirements: ['细心负责'],
    proofTypes: ['text'],
    claimMode,
    contacts: [{ type: 'office', label: '办公地点', value: '实验楼 B302' }]
  }
}

async function postTaskAction<T>(context: Awaited<ReturnType<typeof createTestApp>>, session: Session, taskId: string, action: string, payload: Record<string, unknown> = {}) {
  return context.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/${action}`, headers: headers(session), payload }).then((response) => ({ response, data: response.statusCode < 300 ? dataOf<T>(response) : undefined }))
}

test('任务发布、最后名额竞争、凭证退回重提、通知与统计形成服务端闭环', async () => {
  const context = await createTestApp()
  try {
    await createAdmin(context)
    const teacher = await createAdminManagedUser(context.db, {
      role: 'teacher', account: 'TFLOW01', name: '流程教师', departmentId: 'dept-cs', password: 'Teacher@123', approval: 'approved'
    })
    const otherTeacher = await createAdminManagedUser(context.db, {
      role: 'teacher', account: 'TFLOW02', name: '其他教师', departmentId: 'dept-cs', password: 'Teacher@123', approval: 'approved'
    })
    const student1 = await createAdminManagedUser(context.db, {
      role: 'student', account: 'FLOWST01', name: '流程学生甲', departmentId: 'dept-cs', gradeId: 'grade-2024', classId: 'class-24se1', password: 'Student@123', approval: 'approved'
    })
    const student2 = await createAdminManagedUser(context.db, {
      role: 'student', account: 'FLOWST02', name: '流程学生乙', departmentId: 'dept-cs', gradeId: 'grade-2024', classId: 'class-24se1', password: 'Student@123', approval: 'approved'
    })
    const outsider = await createAdminManagedUser(context.db, {
      role: 'student', account: 'FLOWOUT1', name: '范围外学生', departmentId: 'dept-me', gradeId: 'grade-2023', classId: 'class-23me2', password: 'Student@123', approval: 'approved'
    })
    const teacherSession = await login(context, teacher.account, 'Teacher@123')
    const otherTeacherSession = await login(context, otherTeacher.account, 'Teacher@123')
    const studentSession1 = await login(context, student1.account, 'Student@123')
    const studentSession2 = await login(context, student2.account, 'Student@123')
    const outsiderSession = await login(context, outsider.account, 'Student@123')
    const adminSession = await login(context, 'ADMIN001', 'Admin@123')

    const createResponse = await context.app.inject({
      method: 'POST', url: '/api/tasks', headers: headers(teacherSession), payload: taskPayload('最后名额并发任务', 'direct', 1)
    })
    assert.equal(createResponse.statusCode, 201)
    const created = dataOf<CampusTask>(createResponse)
    assert.equal(created.teacherId, teacher.id)
    assert.equal(created.location, '实验楼 B302')
    assert.equal(created.place, '主校区 · 实验楼 B302')
    const partialEdit = await context.app.inject({
      method: 'PATCH', url: `/api/tasks/${created.id}`, headers: headers(teacherSession),
      payload: { place: '实验楼 B303', version: created.version }
    })
    assert.equal(partialEdit.statusCode, 200)
    assert.equal(dataOf<CampusTask>(partialEdit).audienceId, 'dept-cs')
    assert.equal(dataOf<CampusTask>(partialEdit).location, '实验楼 B303')
    const forgedState = await context.app.inject({
      method: 'PATCH', url: `/api/tasks/${created.id}`, headers: headers(teacherSession),
      payload: { status: 'completed', version: dataOf<CampusTask>(partialEdit).version }
    })
    assert.equal(forgedState.statusCode, 400)
    assert.equal(forgedState.json().ok, false)

    const outsideList = dataOf<PageData<CampusTask>>(await context.app.inject({ method: 'GET', url: '/api/tasks?pageSize=100', headers: { cookie: outsiderSession.cookie } }))
    assert.equal(outsideList.items.some((item) => item.id === created.id), false)
    const outsideClaim = await postTaskAction<CampusTask>(context, outsiderSession, created.id, 'claim')
    assert.equal(outsideClaim.response.statusCode, 403)

    const [claim1, claim2] = await Promise.all([
      postTaskAction<CampusTask>(context, studentSession1, created.id, 'claim'),
      postTaskAction<CampusTask>(context, studentSession2, created.id, 'claim')
    ])
    const claims = [claim1, claim2]
    assert.deepEqual(claims.map((item) => item.response.statusCode).sort(), [200, 409])
    const winnerSession = claim1.response.statusCode === 200 ? studentSession1 : studentSession2
    const winnerId = claim1.response.statusCode === 200 ? student1.id : student2.id
    const loserSession = claim1.response.statusCode === 200 ? studentSession2 : studentSession1
    const loserId = claim1.response.statusCode === 200 ? student2.id : student1.id
    const winnerClaim = (claim1.response.statusCode === 200 ? claim1.data : claim2.data)!
    assert.equal(winnerClaim.occupiedCount, 1)
    assert.equal(winnerClaim.remainingSeats, 0)
    assert.equal(winnerClaim.contacts.length, 1)
    const loserDetail = await context.app.inject({ method: 'GET', url: `/api/tasks/${created.id}`, headers: { cookie: loserSession.cookie } })
    const loserTask = dataOf<CampusTask>(loserDetail)
    assert.equal(loserTask.members.length, 0)
    assert.equal(loserTask.contacts.length, 0)

    const otherTeacherEdit = await context.app.inject({
      method: 'PATCH', url: `/api/tasks/${created.id}`, headers: headers(otherTeacherSession),
      payload: { title: '不应修改', version: created.version }
    })
    assert.equal(otherTeacherEdit.statusCode, 403)

    const started = (await postTaskAction<CampusTask>(context, winnerSession, created.id, 'start')).data!
    const winnerMember = started.members.find((member) => member.userId === winnerId)!
    assert.equal(winnerMember.status, 'in_progress')
    const submitted = (await postTaskAction<CampusTask>(context, winnerSession, created.id, 'proof', {
      description: '已按要求完成全部测试工作。', note: '', fileIds: [], version: winnerMember.version
    })).data!
    assert.equal(submitted.members[0].status, 'review')

    const reviews = dataOf<PageData<ReviewItem>>(await context.app.inject({
      method: 'GET', url: `/api/reviews?taskId=${created.id}`, headers: { cookie: teacherSession.cookie }
    }))
    assert.equal(reviews.total, 1)
    assert.equal(reviews.items[0].member.userId, winnerId)
    const rejected = (await postTaskAction<CampusTask>(context, teacherSession, created.id, 'review', {
      userId: winnerId, approved: false, feedback: '请补充更具体的完成说明。', version: reviews.items[0].member.version
    })).data!
    assert.equal(rejected.members.find((member) => member.userId === winnerId)?.status, 'changes_requested')
    const duplicateReview = await postTaskAction<CampusTask>(context, teacherSession, created.id, 'review', {
      userId: winnerId, approved: true, feedback: '', version: reviews.items[0].member.version
    })
    assert.equal(duplicateReview.response.statusCode, 409)

    const studentAfterReject = dataOf<CampusTask>(await context.app.inject({ method: 'GET', url: `/api/tasks/${created.id}`, headers: { cookie: winnerSession.cookie } }))
    const rejectedMember = studentAfterReject.members[0]
    const resubmitted = (await postTaskAction<CampusTask>(context, winnerSession, created.id, 'proof', {
      description: '已补充设备数量、登记结果和现场交接情况。', note: '已按反馈修改', fileIds: [], version: rejectedMember.version
    })).data!
    const reviewMember = resubmitted.members[0]
    const approved = (await postTaskAction<CampusTask>(context, teacherSession, created.id, 'review', {
      userId: winnerId, approved: true, feedback: '验收通过', version: reviewMember.version
    })).data!
    assert.equal(approved.status, 'completed')
    assert.equal(approved.members.find((member) => member.userId === winnerId)?.status, 'completed')

    const staleDuplicate = await postTaskAction<CampusTask>(context, teacherSession, created.id, 'review', {
      userId: winnerId, approved: true, feedback: '', version: reviewMember.version
    })
    assert.equal(staleDuplicate.response.statusCode, 409)
    const winnerNotices = dataOf<NoticePage>(await context.app.inject({ method: 'GET', url: '/api/notices?pageSize=100', headers: { cookie: winnerSession.cookie } }))
    assert.ok(winnerNotices.items.some((notice) => notice.title.includes('需修改')))
    assert.ok(winnerNotices.items.some((notice) => notice.title.includes('已通过')))
    const loserNotices = dataOf<NoticePage>(await context.app.inject({ method: 'GET', url: '/api/notices?pageSize=100', headers: { cookie: loserSession.cookie } }))
    assert.equal(loserNotices.items.some((notice) => notice.content.includes(created.title)), false)
    const markAll = await context.app.inject({ method: 'POST', url: '/api/notices/read-all', headers: headers(winnerSession), payload: {} })
    assert.equal(markAll.statusCode, 200)
    assert.equal(dataOf<NoticePage>(await context.app.inject({ method: 'GET', url: '/api/notices', headers: { cookie: winnerSession.cookie } })).unreadCount, 0)

    const studentDashboard = dataOf<DashboardData>(await context.app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: winnerSession.cookie } }))
    assert.equal(studentDashboard.stats.completed, 1)
    const teacherDashboard = dataOf<DashboardData>(await context.app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: teacherSession.cookie } }))
    assert.equal(teacherDashboard.stats.completed, 1)

    const partialCreate = dataOf<CampusTask>(await context.app.inject({
      method: 'POST', url: '/api/tasks', headers: headers(teacherSession), payload: taskPayload('部分完成仍继续招募', 'direct', 2)
    }))
    const partialClaim = (await postTaskAction<CampusTask>(context, studentSession1, partialCreate.id, 'claim')).data!
    const partialStart = (await postTaskAction<CampusTask>(context, studentSession1, partialCreate.id, 'start')).data!
    const partialMember = partialStart.members[0]
    const partialProof = (await postTaskAction<CampusTask>(context, studentSession1, partialCreate.id, 'proof', {
      description: '完成了第一名额对应的工作。', note: '', fileIds: [], version: partialMember.version
    })).data!
    const partialReviewMember = partialProof.members[0]
    const partialApproved = (await postTaskAction<CampusTask>(context, teacherSession, partialCreate.id, 'review', {
      userId: student1.id, approved: true, feedback: '', version: partialReviewMember.version
    })).data!
    assert.equal(partialApproved.status, 'recruiting')
    assert.equal(partialApproved.remainingSeats, 1)
    assert.equal(partialClaim.id, partialCreate.id)

    const application = dataOf<CampusTask>(await context.app.inject({
      method: 'POST', url: '/api/tasks', headers: headers(teacherSession), payload: taskPayload('申请模式并发录取', 'application', 1)
    }))
    await postTaskAction<CampusTask>(context, studentSession1, application.id, 'claim')
    await postTaskAction<CampusTask>(context, studentSession2, application.id, 'claim')
    const applications = dataOf<CampusTask>(await context.app.inject({ method: 'GET', url: `/api/tasks/${application.id}`, headers: { cookie: teacherSession.cookie } }))
    assert.equal(applications.occupiedCount, 0)
    assert.equal(applications.members.filter((member) => member.status === 'applied').length, 2)
    const accepted = (await postTaskAction<CampusTask>(context, teacherSession, application.id, 'approve', {
      userId: student1.id, version: applications.members.find((member) => member.userId === student1.id)!.version
    })).data!
    const secondApproval = await postTaskAction<CampusTask>(context, teacherSession, application.id, 'approve', {
      userId: student2.id, version: applications.members.find((member) => member.userId === student2.id)!.version
    })
    assert.equal(secondApproval.response.statusCode, 409)
    assert.equal(accepted.members.find((member) => member.userId === student2.id)?.status, 'applied')

    const cancelled = (await postTaskAction<CampusTask>(context, teacherSession, application.id, 'cancel', { version: accepted.version })).data!
    assert.equal(cancelled.status, 'cancelled')
    const noticeCount = Number(context.db.get('SELECT COUNT(*) count FROM notices')?.count ?? 0)
    const repeatedCancel = await postTaskAction<CampusTask>(context, teacherSession, application.id, 'cancel', { version: cancelled.version })
    assert.equal(repeatedCancel.response.statusCode, 409)
    assert.equal(context.db.get('SELECT COUNT(*) count FROM notices')?.count, noticeCount)
    const restored = (await postTaskAction<CampusTask>(context, adminSession, application.id, 'restore', { version: cancelled.version })).data!
    assert.equal(restored.members.find((member) => member.userId === student1.id)?.status, 'upcoming')
    assert.equal(restored.members.find((member) => member.userId === student2.id)?.status, 'applied')
    assert.equal(restored.status, 'full')

    const mineApplied = dataOf<PageData<CampusTask>>(await context.app.inject({
      method: 'GET', url: '/api/tasks?mine=true&status=applied&pageSize=100', headers: { cookie: studentSession2.cookie }
    }))
    assert.ok(mineApplied.items.some((task) => task.id === application.id))
    assert.equal(mineApplied.items.every((task) => task.members.length <= 1), true)
    assert.equal(loserId === student2.id || loserId === student1.id, true)
  } finally { await closeTestApp(context) }
})
