import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { CampusUser, DashboardData, NoticePage, PageData, ReviewItem } from '../../shared/contracts.js'
import type { AppDatabase, SqlRow } from '../db/database.js'
import { getSchool, getTaskRow, getTaskRows, mapMember, mapUser } from '../db/models.js'
import { mapLocalizedNotice } from '../i18n/notices.js'
import { resolveRequestLocale } from '../i18n/index.js'
import type { Locale } from '../i18n/messages.js'
import { assertCondition } from '../errors.js'
import { DefaultResponseSchema, IdParamsSchema, pageNumber, success } from '../http.js'
import type { SessionService } from '../security/session.js'
import { calculateTaskStatus, mapTaskForViewer } from './tasks.service.js'

const text = (value: unknown) => String(value ?? '')
const number = (value: unknown) => Number(value)
const EmptyBodySchema = Type.Object({}, { additionalProperties: false })
const PageQuerySchema = Type.Object({
  page: Type.Optional(Type.String()),
  pageSize: Type.Optional(Type.String())
}, { additionalProperties: false })
const ReviewQuerySchema = Type.Object({
  taskId: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  page: Type.Optional(Type.String()),
  pageSize: Type.Optional(Type.String())
}, { additionalProperties: false })

function noticePage(db: AppDatabase, user: CampusUser, locale: Locale, page: number, pageSize: number): NoticePage {
  const userId = user.id
  const total = number(db.get('SELECT COUNT(*) count FROM notices WHERE user_id = ?', userId)?.count ?? 0)
  const unreadCount = number(db.get('SELECT COUNT(*) count FROM notices WHERE user_id = ? AND read = 0', userId)?.count ?? 0)
  const rows = db.all(`SELECT * FROM notices
    WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, userId, pageSize, (page - 1) * pageSize)
  return { items: rows.map((row) => mapLocalizedNotice(db, row, user, locale)), total, page, pageSize, unreadCount }
}

function reviewPage(
  db: AppDatabase,
  viewer: CampusUser,
  taskId: string | undefined,
  page: number,
  pageSize: number
): PageData<ReviewItem> {
  assertCondition(viewer && (viewer.role === 'teacher' || viewer.role === 'admin'), 403, 'FORBIDDEN', '没有验收中心访问权限')
  const conditions = ["tm.status = 'review'"]
  const params: Array<string | number> = []
  if (viewer.role === 'teacher') {
    conditions.push('t.teacher_id = ?')
    params.push(viewer.id)
  }
  if (taskId) {
    conditions.push('t.id = ?')
    params.push(taskId)
  }
  const where = conditions.join(' AND ')
  const total = number(db.get(`SELECT COUNT(*) count FROM task_members tm
    JOIN tasks t ON t.id = tm.task_id JOIN proofs p ON p.task_id = tm.task_id AND p.user_id = tm.user_id
    WHERE ${where}`, ...params)?.count ?? 0)
  const rows = db.all(`SELECT tm.*, u.account, u.name, d.name department_name, c.name class_name,
      p.submitted_at proof_submitted_at
    FROM task_members tm JOIN tasks t ON t.id = tm.task_id
    JOIN proofs p ON p.task_id = tm.task_id AND p.user_id = tm.user_id
    JOIN users u ON u.id = tm.user_id LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN classes c ON c.id = u.class_id
    WHERE ${where} ORDER BY p.submitted_at DESC, tm.task_id, tm.user_id LIMIT ? OFFSET ?`,
  ...params, pageSize, (page - 1) * pageSize)
  const items = rows.map((memberRow) => {
    const taskRow = getTaskRow(db, text(memberRow.task_id))
    assertCondition(taskRow, 404, 'TASK_NOT_FOUND', '待验收任务不存在')
    const member = mapMember(db, memberRow)
    assertCondition(member.proof, 409, 'PROOF_NOT_FOUND', '待验收凭证不存在')
    return { task: mapTaskForViewer(db, taskRow, viewer), member, proof: member.proof }
  })
  return { items, total, page, pageSize }
}

function recentRowsForStudent(db: AppDatabase, user: { id: string; departmentId?: string; classId?: string; gradeId?: string }): SqlRow[] {
  return getTaskRows(db, `(EXISTS (SELECT 1 FROM task_members recent_member WHERE recent_member.task_id = t.id AND recent_member.user_id = ?)
    OR t.audience_scope = 'school'
    OR (t.audience_scope = 'department' AND t.audience_id = ?)
    OR (t.audience_scope = 'class' AND t.audience_id = ?)
    OR (t.audience_scope = 'grade' AND t.audience_id = ?))`,
  [user.id, user.departmentId ?? '', user.classId ?? '', user.gradeId ?? ''], 't.created_at DESC', 6, 0)
}

function adminDashboard(db: AppDatabase, viewer: CampusUser): DashboardData {
  const pendingTeacherRows = db.all(`SELECT u.*, d.name department_name, c.name class_name, g.name grade_name
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN classes c ON c.id = u.class_id LEFT JOIN grades g ON g.id = u.grade_id
    WHERE u.role = 'teacher' AND u.approval = 'pending' ORDER BY u.created_at ASC`)
  const recentTasks = getTaskRows(db, '', [], 't.created_at DESC', 6, 0).map((row) => mapTaskForViewer(db, row, viewer))
  return {
    stats: {
      users: number(db.get('SELECT COUNT(*) count FROM users')?.count ?? 0),
      pendingAccounts: number(db.get("SELECT COUNT(*) count FROM users WHERE approval = 'pending'")?.count ?? 0),
      tasks: number(db.get("SELECT COUNT(*) count FROM tasks WHERE status <> 'cancelled'")?.count ?? 0),
      // Workflow rows include unbound roster participants. Bound members also have
      // a legacy mirror, which must not add a second pending item.
      pendingProofs: number(db.get(`SELECT COUNT(*) count FROM (
        SELECT p.task_id FROM workflow_participants p WHERE p.status = 'review'
        UNION ALL
        SELECT tm.task_id FROM task_members tm WHERE tm.status = 'review'
          AND NOT EXISTS (SELECT 1 FROM workflow_participants p
            WHERE p.task_id = tm.task_id AND p.user_id = tm.user_id)
      )`)?.count ?? 0)
    },
    recentTasks,
    activeTask: null,
    pendingTeachers: pendingTeacherRows.map(row => mapUser(row, getSchool(db).defaultLocale)),
    organizationStats: {
      departments: number(db.get('SELECT COUNT(*) count FROM departments')?.count ?? 0),
      grades: number(db.get('SELECT COUNT(*) count FROM grades')?.count ?? 0),
      classes: number(db.get('SELECT COUNT(*) count FROM classes')?.count ?? 0),
      campuses: number(db.get('SELECT COUNT(*) count FROM campuses')?.count ?? 0),
      categories: number(db.get('SELECT COUNT(*) count FROM task_categories')?.count ?? 0)
    }
  }
}

function studentDashboard(db: AppDatabase, viewer: CampusUser): DashboardData {
  const counts = db.get(`SELECT
      SUM(CASE WHEN status IN ('upcoming', 'in_progress', 'changes_requested') THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) review,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) completed
    FROM task_members WHERE user_id = ?`, viewer.id)
  const active = db.get(`SELECT t.id FROM task_members tm JOIN tasks t ON t.id = tm.task_id
    WHERE tm.user_id = ? AND tm.status IN ('changes_requested', 'in_progress', 'upcoming') AND t.status <> 'cancelled'
    ORDER BY CASE tm.status WHEN 'changes_requested' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
      t.start_at ASC, tm.updated_at DESC LIMIT 1`, viewer.id)
  const activeRow = active ? getTaskRow(db, text(active.id)) : undefined
  const recentTasks = recentRowsForStudent(db, viewer).map((row) => mapTaskForViewer(db, row, viewer))
  return {
    stats: {
      active: number(counts?.active ?? 0),
      review: number(counts?.review ?? 0),
      completed: number(counts?.completed ?? 0)
    },
    recentTasks,
    activeTask: activeRow ? mapTaskForViewer(db, activeRow, viewer) : null,
    pendingTeachers: [],
    organizationStats: {}
  }
}

function teacherDashboard(db: AppDatabase, viewer: CampusUser): DashboardData {
  const rows = getTaskRows(db, 't.teacher_id = ?', [viewer.id], 't.created_at DESC', 1000000, 0)
  const stats = { review: 0, recruiting: 0, in_progress: 0, completed: 0 }
  rows.forEach((row) => {
    const status = calculateTaskStatus(db, text(row.id))
    if (status === 'review') stats.review += 1
    else if (status === 'in_progress') stats.in_progress += 1
    else if (status === 'completed') stats.completed += 1
    else if (status === 'recruiting') stats.recruiting += 1
  })
  return {
    stats,
    recentTasks: rows.slice(0, 6).map((row) => mapTaskForViewer(db, row, viewer)),
    activeTask: null,
    pendingTeachers: [],
    organizationStats: {}
  }
}

function dashboard(db: AppDatabase, viewer: CampusUser): DashboardData {
  if (viewer.role === 'admin') return adminDashboard(db, viewer)
  if (viewer.role === 'teacher') return teacherDashboard(db, viewer)
  return studentDashboard(db, viewer)
}

export function registerNoticeDashboardRoutes(app: FastifyInstance, db: AppDatabase, sessions: SessionService) {
  app.get('/api/notices', {
    schema: { querystring: PageQuerySchema, response: DefaultResponseSchema }
  }, async (request) => {
    const user = sessions.requireUser(request)
    const query = request.query as Record<string, unknown>
    return success(noticePage(db, user, resolveRequestLocale(request, db, sessions), pageNumber(query.page, 1), pageNumber(query.pageSize, 20, 100)))
  })

  app.post('/api/notices/read-all', {
    schema: { body: EmptyBodySchema, response: DefaultResponseSchema }
  }, async (request) => {
    const user = sessions.requireUser(request)
    db.run('UPDATE notices SET read = 1 WHERE user_id = ? AND read = 0', user.id)
    return success(null, '全部通知已标为已读')
  })

  app.post('/api/notices/:id/read', {
    schema: { params: IdParamsSchema, body: EmptyBodySchema, response: DefaultResponseSchema }
  }, async (request) => {
    const user = sessions.requireUser(request)
    const id = (request.params as { id: string }).id
    assertCondition(db.get('SELECT 1 marker FROM notices WHERE id = ? AND user_id = ?', id, user.id), 404, 'NOTICE_NOT_FOUND', '通知不存在')
    db.run('UPDATE notices SET read = 1 WHERE id = ? AND user_id = ?', id, user.id)
    return success(null, '通知已标为已读')
  })

  app.get('/api/reviews', {
    schema: { querystring: ReviewQuerySchema, response: DefaultResponseSchema }
  }, async (request) => {
    const viewer = sessions.requireUser(request, ['teacher', 'admin'])
    const query = request.query as Record<string, unknown>
    return success(reviewPage(
      db,
      viewer,
      typeof query.taskId === 'string' ? query.taskId : undefined,
      pageNumber(query.page, 1),
      pageNumber(query.pageSize, 20, 100)
    ))
  })

  app.get('/api/dashboard', {
    schema: { response: DefaultResponseSchema }
  }, async (request) => {
    const viewer = sessions.requireUser(request)
    return success(dashboard(db, viewer))
  })
}

export const registerNoticesDashboardRoutes = registerNoticeDashboardRoutes
