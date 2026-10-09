import { msg, type MessageKey } from '@/mobile/i18n'

export interface RetentionBlocker { code: string; count: number }
const blockerMessages: Record<string, MessageKey> = {
  RETENTION_TASK_OPEN: '任务尚未结项，不能删除。',
  RETENTION_SNAPSHOT_MISSING: '缺少结项快照，不能核定保存期限。',
  RETENTION_NOT_DUE: '最新结项快照仍在保存期内，请等待到期。',
  RETENTION_CROSS_TASK_REFERENCE: '其他任务仍有 {p0} 处材料、审核或快照引用。',
  RETENTION_SHARED_FILE: '有 {p0} 个文件仍被其他任务或用途引用。',
  RETENTION_FILE_PATH_INVALID: '有 {p0} 个文件路径未通过安全检查，请联系部署管理员。',
  RETENTION_MAIL_IN_FLIGHT: '有 {p0} 封相关邮件正在发送，请稍后重新预览。',
  RETENTION_LEGACY_NOTICES: '有 {p0} 条旧通知缺少任务关联，需要管理员核查。'
}

export function retentionBlockers(blockers: readonly RetentionBlocker[]): RetentionBlocker[] {
  const counts = new Map<string, number>()
  for (const blocker of blockers) counts.set(blocker.code, (counts.get(blocker.code) ?? 0) + blocker.count)
  return [...counts].map(([code, count]) => ({ code, count }))
}

export function retentionBlockerLabel(blocker: RetentionBlocker): string {
  return msg(blockerMessages[blocker.code] ?? '仍有 {p0} 项删除阻碍，请刷新预览并联系管理员核查。', { p0: blocker.count })
}

export function retentionStatus(item: { eligible: boolean; blockers: readonly RetentionBlocker[] }): string {
  const codes = new Set(item.blockers.map(blocker => blocker.code))
  if (codes.has('RETENTION_TASK_OPEN')) return msg('任务尚未结项')
  if (codes.has('RETENTION_SNAPSHOT_MISSING')) return msg('缺少结项快照')
  if (codes.has('RETENTION_NOT_DUE')) return msg('未到保存期限')
  return msg(item.eligible && !item.blockers.length ? '可申请删除' : '存在阻碍，暂不可删除')
}
