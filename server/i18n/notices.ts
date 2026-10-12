import type { AppNotice, CampusUser } from '../../shared/contracts.js'
import { createId, nowIso, type AppDatabase, type SqlRow } from '../db/database.js'
import { isTaskVisibleTo, mapNotice } from '../db/models.js'
import type { MessageParams } from '../errors.js'
import { formatMessage, type Locale } from './messages.js'
import { enqueueNoticeEmail } from '../mail/queue.js'

type NoticeTarget = { kind: 'task' | 'accounts'; id: string }
type NoticeTemplate = { 'zh-CN': [string, string]; en: [string, string] }

export const noticeTemplates: Record<string, NoticeTemplate> = {
  'account.registration_pending': {
    'zh-CN': ['收到账号注册申请', '{actorName}提交了账号审核申请。'],
    en: ['Account registration pending', '{actorName} has submitted an account registration for approval.']
  },
  'task.applied': {
    'zh-CN': ['收到任务申请', '{actorName}申请参与任务“{taskTitle}”。'],
    en: ['New task application', '{actorName} has applied for “{taskTitle}”.']
  },
  'task.joined': {
    'zh-CN': ['收到任务报名', '{actorName}已报名任务“{taskTitle}”。'],
    en: ['New task signup', '{actorName} has joined “{taskTitle}”.']
  },
  'task.withdrawn': {
    'zh-CN': ['参与者已退出', '{actorName}已撤回任务“{taskTitle}”的报名或申请。'],
    en: ['Participant withdrew', '{actorName} has withdrawn from “{taskTitle}”.']
  },
  'task.started': {
    'zh-CN': ['参与者已开始任务', '{actorName}已开始任务“{taskTitle}”。'],
    en: ['Participant started task', '{actorName} has started “{taskTitle}”.']
  },
  'task.application_approved': {
    'zh-CN': ['任务申请已通过', '你对任务“{taskTitle}”的申请已通过。'],
    en: ['Application approved', 'Your application for “{taskTitle}” was approved.']
  },
  'task.application_rejected': {
    'zh-CN': ['任务申请未通过', '你对任务“{taskTitle}”的申请未通过。{feedback}'],
    en: ['Application declined', 'Your application for “{taskTitle}” was declined. {feedback}']
  },
  'task.invited': {
    'zh-CN': ['收到任务邀请', '{actorName}邀请你参与任务“{taskTitle}”。'],
    en: ['Task invitation', '{actorName} invited you to “{taskTitle}”.']
  },
  'task.proof_submitted': {
    'zh-CN': ['收到待审核材料', '{actorName}已提交任务“{taskTitle}”的完成材料。'],
    en: ['Evidence ready for review', '{actorName} submitted evidence for “{taskTitle}”.']
  },
  'task.proof_approved': {
    'zh-CN': ['完成材料已通过审核', '任务“{taskTitle}”的完成材料已确认。{feedback}'],
    en: ['Evidence confirmed', 'Your evidence for “{taskTitle}” was confirmed. {feedback}']
  },
  'task.changes_requested': {
    'zh-CN': ['完成材料需修改（补正）', '任务“{taskTitle}”的完成材料需要补正。{feedback}'],
    en: ['Changes requested', 'Changes are requested for your evidence for “{taskTitle}”. {feedback}']
  },
  'task.cancelled': {
    'zh-CN': ['任务已撤销', '任务“{taskTitle}”已撤销。'],
    en: ['Task cancelled', '“{taskTitle}” has been cancelled.']
  },
  'task.restored': {
    'zh-CN': ['任务已恢复', '任务“{taskTitle}”已恢复，原参与进度保留。'],
    en: ['Task restored', '“{taskTitle}” was restored with participation progress preserved.']
  },
  'task.updated': {
    'zh-CN': ['任务信息已更新', '任务“{taskTitle}”的信息已更新，请查看最新安排。'],
    en: ['Task details updated', 'Details for “{taskTitle}” have changed. Check the latest arrangements.']
  },
  'task.closed_out': {
    'zh-CN': ['任务已结项', '任务“{taskTitle}”已结项，请查看个人结果。'],
    en: ['Task closed out', '“{taskTitle}” has been closed out. Check your individual outcome.']
  },
  'task.reopened': {
    'zh-CN': ['任务已重新开放', '任务“{taskTitle}”已重新开放。{feedback}'],
    en: ['Task reopened', '“{taskTitle}” has been reopened. {feedback}']
  },
  'task.handover': {
    'zh-CN': ['任务负责人已交接', '任务“{taskTitle}”的负责人已交接。'],
    en: ['Task coordinator changed', 'Responsibility for “{taskTitle}” has been transferred.']
  }
}

function eventText(eventType: string, params: MessageParams, locale: Locale): [string, string] | undefined {
  const template = noticeTemplates[eventType]?.[locale]
  return template
    ? [formatMessage(template[0], params), formatMessage(template[1], { feedback: '', ...params }).trim()]
    : undefined
}

export function createEventNotice(
  db: AppDatabase,
  userId: string,
  eventType: string,
  params: MessageParams,
  target?: NoticeTarget,
  type: 'task' | 'review' | 'system' = 'task',
  timestamp = nowIso()
) {
  const translated = eventText(eventType, params, 'zh-CN')
  if (!translated) throw new Error(`Unknown notification event: ${eventType}`)
  const id = createId('notice')
  db.run(
    `INSERT INTO notices(id, user_id, title, content, type, read, created_at, event_type, event_params_json, target_kind, target_id)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    id,
    userId,
    translated[0],
    translated[1],
    type,
    timestamp,
    eventType,
    JSON.stringify(params),
    target?.kind ?? null,
    target?.id ?? null
  )
  enqueueNoticeEmail(db, id, userId)
  return id
}

function authorizedTarget(db: AppDatabase, row: SqlRow, user: CampusUser): NoticeTarget | undefined {
  if (!row.target_id) return undefined
  if (row.target_kind === 'accounts')
    return user.role === 'admin' ? { kind: 'accounts', id: String(row.target_id) } : undefined
  if (row.target_kind !== 'task') return undefined
  const task = db.get('SELECT * FROM tasks WHERE id = ?', String(row.target_id))
  if (!task) return undefined
  const authorized =
    user.role === 'admin' ||
    (user.role === 'teacher' && String(task.teacher_id) === user.id) ||
    (user.role === 'student' &&
      (isTaskVisibleTo(task, user) ||
        Boolean(db.get('SELECT 1 FROM task_members WHERE task_id = ? AND user_id = ?', String(task.id), user.id))))
  return authorized ? { kind: 'task', id: String(task.id) } : undefined
}

export function mapLocalizedNotice(db: AppDatabase, row: SqlRow, user: CampusUser, locale: Locale): AppNotice {
  const legacy = mapNotice(row)
  if (!row.event_type) return legacy
  let params: MessageParams = {}
  try {
    const candidate: unknown = JSON.parse(String(row.event_params_json ?? '{}'))
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      params = Object.fromEntries(
        Object.entries(candidate).filter(
          ([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value)
        )
      ) as MessageParams
    }
  } catch {
    /* Preserve readable historical text when an old event is malformed. */
  }
  const translated = eventText(String(row.event_type), params, locale)
  return {
    ...legacy,
    ...(translated ? { title: translated[0], content: translated[1] } : {}),
    eventType: String(row.event_type),
    eventParams: params,
    target: authorizedTarget(db, row, user)
  }
}
