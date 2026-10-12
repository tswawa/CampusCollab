import type {
  AppLocale,
  CampusTask,
  CampusUser,
  ContactMethodType,
  MemberStatus,
  ProofType,
  TaskStatus,
  UnifiedTaskStatus
} from '@/mobile/types'

import { formatDate } from './date'
import { msg } from '@/mobile/i18n'
export { formatDate } from './date'

// 仅供保留的静态视觉原型使用，业务页面统一读取 catalog Store。
export const taskCategories = ['全部', '活动协助', '场地协助', '资料整理', '设计制作', '设备协助']

// 统一7种状态：招募中、待开始、进行中、待验收、需修改、已完成、已撤销
export const unifiedStatusMeta: Record<UnifiedTaskStatus, { label: string; color: string; bgColor: string }> = {
  recruiting: {
    get label() {
      return msg('招募中')
    },
    color: '#1E60D5',
    bgColor: '#EBF2FE'
  },
  upcoming: {
    get label() {
      return msg('待开始')
    },
    color: '#0284C7',
    bgColor: '#E0F2FE'
  },
  in_progress: {
    get label() {
      return msg('进行中')
    },
    color: '#D97706',
    bgColor: '#FEF3C7'
  },
  review: {
    get label() {
      return msg('待审核')
    },
    color: '#7C3AED',
    bgColor: '#EDE9FE'
  },
  changes_requested: {
    get label() {
      return msg('待补正')
    },
    color: '#E11D48',
    bgColor: '#FFE4E6'
  },
  completed: {
    get label() {
      return msg('已完成')
    },
    color: '#059669',
    bgColor: '#D1FAE5'
  },
  cancelled: {
    get label() {
      return msg('已撤销')
    },
    color: '#64748B',
    bgColor: '#F1F5F9'
  }
}

export const taskStatusMeta: Record<TaskStatus, { label: string; color: string; bgColor: string }> = {
  ...unifiedStatusMeta,
  full: {
    get label() {
      return msg('已满员')
    },
    color: '#64748B',
    bgColor: '#F1F5F9'
  }
}

export const memberStatusMeta: Record<MemberStatus, { label: string; color: string; bgColor: string }> = {
  applied: {
    get label() {
      return msg('待确认')
    },
    color: '#7C3AED',
    bgColor: '#EDE9FE'
  },
  ...unifiedStatusMeta
}

// 联系方式元数据：支持微信、电话、邮箱、QQ、办公地点、站内消息、自定义
export const contactTypeMeta: Record<ContactMethodType, { label: string; icon: string; action: string }> = {
  wechat: {
    get label() {
      return msg('微信')
    },
    icon: 'chat-o',
    get action() {
      return msg('复制')
    }
  },
  phone: {
    get label() {
      return msg('电话')
    },
    icon: 'phone-o',
    get action() {
      return msg('呼叫')
    }
  },
  email: {
    get label() {
      return msg('邮箱')
    },
    icon: 'envelop-o',
    get action() {
      return msg('发邮件')
    }
  },
  qq: {
    label: 'QQ',
    icon: 'friends-o',
    get action() {
      return msg('复制')
    }
  },
  office: {
    get label() {
      return msg('办公地点')
    },
    icon: 'location-o',
    get action() {
      return msg('复制')
    }
  },
  chat: {
    get label() {
      return msg('站内消息')
    },
    icon: 'comment-o',
    get action() {
      return msg('联系')
    }
  },
  custom: {
    get label() {
      return msg('联系方式')
    },
    icon: 'contact-o',
    get action() {
      return msg('复制')
    }
  }
}

export const proofTypeLabels: Record<ProofType, string> = {
  get text() {
    return msg('文字说明')
  },
  get image() {
    return msg('现场图片')
  },
  get onsite() {
    return msg('现场核验')
  }
}

export function completionExportFilename(
  title: string,
  version: number,
  format: 'csv' | 'xlsx' | 'zip',
  locale: AppLocale
): string {
  const safeTitle = Array.from(title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g, ''))
    .slice(0, 60)
    .join('')
  return `${safeTitle}_${locale === 'en' ? 'result-v' : '结果版本'}${version}.${format}`
}

export function fullTaskTime(task: CampusTask): string {
  return `${formatDate(task.date)} ${task.startTime}–${task.endTime}`
}

export function formatTaskDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return ''
  return minutes >= 60
    ? msg('约 {p0} 小时', { p0: Math.round((minutes / 60) * 10) / 10 })
    : msg('约 {p0} 分钟', { p0: minutes })
}

export function isTaskVisible(task: CampusTask, user: CampusUser): boolean {
  if (user.role === 'teacher') return task.teacherId === user.id
  if (task.audienceScope === 'school') return true
  if (task.audienceScope === 'department') return task.audienceValue === user.department
  if (task.audienceScope === 'class') return task.audienceValue === user.className
  if (task.audienceScope === 'grade') return task.audienceValue === user.grade
  return false
}

export function audienceLabel(task: CampusTask): string {
  const labels: Record<string, string> = {
    school: msg('全校学生'),
    department: task.audienceValue,
    class: task.audienceValue,
    grade: task.audienceValue
  }
  return labels[task.audienceScope] || msg('全校学生')
}

export function memberOf(task: CampusTask, userId: string) {
  return task.members.find(member => member.userId === userId)
}

export function getOccupiedCount(task: CampusTask): number {
  return task.occupiedCount
}

export function getRemainingSeats(task: CampusTask): number {
  return task.remainingSeats
}

export function hasOpenSeat(task: CampusTask): boolean {
  return getRemainingSeats(task) > 0
}

export function getCampusBadge(place: string, campus?: string): string {
  if (campus) return campus
  if (place.includes('线上')) return '线上协助'
  if (place.includes('东校区')) return '东校区'
  if (place.includes('西校区')) return '西校区'
  return '主校区'
}
