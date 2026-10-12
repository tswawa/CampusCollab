export type TemplateLocale = 'zh-CN' | 'en'

export interface EvidenceTemplate {
  id: string
  version: number
  name: Record<TemplateLocale, string>
  description: Record<TemplateLocale, string>
  items: Array<{
    id: string
    kind: 'text' | 'image'
    label: Record<TemplateLocale, string>
    required: boolean
    maxLength?: number
    minFiles?: number
  }>
  source: {
    kind: 'generic' | 'institutional'
    url?: string
    compatibility: 'generic' | 'unverified' | 'verified'
  }
}

// Published template versions are immutable. Change requirements by adding a version.
export const evidenceTemplates: readonly EvidenceTemplate[] = [
  {
    id: 'generic-practice',
    version: 1,
    name: { 'zh-CN': '通用实践任务', en: 'Practical activity' },
    description: {
      'zh-CN': '完成说明与补充图片。',
      en: 'Work completed and supporting images.'
    },
    items: [
      {
        id: 'description',
        kind: 'text',
        label: { 'zh-CN': '实际完成情况', en: 'Work completed' },
        required: true,
        maxLength: 4000
      },
      {
        id: 'images',
        kind: 'image',
        label: { 'zh-CN': '补充图片', en: 'Supporting images' },
        required: false,
        minFiles: 0
      }
    ],
    source: { kind: 'generic', compatibility: 'generic' }
  },
  {
    id: 'community-garden',
    version: 1,
    name: { 'zh-CN': '校园花园志愿活动', en: 'Campus community garden' },
    description: {
      'zh-CN': '工作与参与记录、活动图片。',
      en: 'Work and participation records, with activity images.'
    },
    items: [
      {
        id: 'description',
        kind: 'text',
        label: { 'zh-CN': '工作与参与记录', en: 'Work and participation record' },
        required: true,
        maxLength: 4000
      },
      {
        id: 'images',
        kind: 'image',
        label: { 'zh-CN': '活动图片', en: 'Activity images' },
        required: false,
        minFiles: 0
      }
    ],
    source: { kind: 'generic', compatibility: 'generic' }
  }
]

export function getEvidenceTemplate(id: string, version?: number): EvidenceTemplate | undefined {
  const matches = evidenceTemplates.filter(
    template => template.id === id && (version === undefined || template.version === version)
  )
  const template = matches.sort((a, b) => b.version - a.version)[0]
  return template ? structuredClone(template) : undefined
}
