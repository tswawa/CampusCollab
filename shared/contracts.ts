export type UserRole = 'student' | 'teacher' | 'admin'
export type ApprovalStatus = 'approved' | 'pending' | 'disabled'
export type UnifiedTaskStatus =
  'recruiting' | 'upcoming' | 'in_progress' | 'review' | 'changes_requested' | 'completed' | 'cancelled'
export type TaskStatus = UnifiedTaskStatus | 'full'
export type MemberStatus = UnifiedTaskStatus | 'applied'
export type AudienceScope = 'school' | 'department' | 'class' | 'grade'
export type ClaimMode = 'direct' | 'application'
export type ProofType = 'text' | 'image' | 'onsite'
export type ContactMethodType = 'wechat' | 'phone' | 'email' | 'qq' | 'office' | 'chat' | 'custom'
export type CatalogKind = 'departments' | 'grades' | 'classes' | 'campuses' | 'categories'
export interface CatalogItem {
  id: string
  name: string
  enabled: boolean
  version: number
}
export interface DepartmentItem extends CatalogItem {
  code: string
}
export interface GradeItem extends CatalogItem {}
export interface ClassItem extends CatalogItem {
  departmentId: string
  gradeId: string
}
export interface CampusItem extends CatalogItem {}
export interface TaskCategoryItem extends CatalogItem {}
export interface CatalogData {
  departments: DepartmentItem[]
  grades: GradeItem[]
  classes: ClassItem[]
  campuses: CampusItem[]
  taskCategories: TaskCategoryItem[]
}
export type AppLocale = 'zh-CN' | 'en'
export interface SchoolProfile {
  name: string
  platformName: string
  logo: string
  badge: string
  announcement: string
  primaryColor: string
  version: number
  timezone: string
  defaultLocale: AppLocale
  registrationEnabled: boolean
  requireDepartment: boolean
  requireGrade: boolean
  requireClass: boolean
  allowExternalParticipants: boolean
  retentionDays: number
}
// 仅服务端持有密码哈希，任何响应 DTO 均不含密码或会话 ID。
export interface CampusUser {
  id: string
  role: UserRole
  account: string
  name: string
  departmentId?: string
  department: string
  classId?: string
  className?: string
  gradeId?: string
  grade?: string
  approval: ApprovalStatus
  skills: string[]
  version: number
  locale?: AppLocale
  email?: string
  externalId?: string
  isExternal?: boolean
  mustChangePassword?: boolean
}
export interface AdminAccountPayload {
  role: UserRole
  account: string
  name: string
  departmentId?: string
  classId?: string
  gradeId?: string
  password?: string
  approval: ApprovalStatus
  version?: number
  locale?: AppLocale
  email?: string
  externalId?: string
  isExternal?: boolean
}
export interface RegistrationPayload {
  role: 'student' | 'teacher'
  account: string
  name: string
  departmentId?: string
  classId?: string
  gradeId?: string
  password: string
  locale?: AppLocale
  email?: string
  externalId?: string
  isExternal?: boolean
}
export interface ContactItem {
  id?: string
  type: ContactMethodType
  label: string
  value: string
}
export interface TaskProof {
  description: string
  note: string
  images: string[]
  fileIds: string[]
  submittedAt: string
}
export interface TaskMember {
  userId: string
  name: string
  account: string
  department: string
  className?: string
  status: MemberStatus
  statusBeforeCancel?: MemberStatus
  claimedAt: string
  startedAt?: string
  proof?: TaskProof
  feedback?: string
  version: number
}
export interface CreateTaskPayload {
  title: string
  categoryId: string
  campusId: string
  description: string
  checklist: string[]
  date: string
  startTime: string
  endTime: string
  signupDeadline: string
  place: string
  duration: string
  capacity: number
  audienceScope: AudienceScope
  audienceId?: string
  requirements: string[]
  proofTypes: ProofType[]
  claimMode: ClaimMode
  contacts: ContactItem[]
  workflow?: Omit<import('./workflow-contracts.js').ConfigureWorkflowInput, 'version'>
}
export interface CampusTask extends CreateTaskPayload {
  id: string
  category: string
  campus: string
  location: string
  audienceValue: string
  teacherId: string
  teacherName: string
  department: string
  status: TaskStatus
  statusBeforeCancel?: TaskStatus
  members: TaskMember[]
  createdAt: string
  distance: string
  featured?: boolean
  occupiedCount: number
  remainingSeats: number
  canClaim: boolean
  version: number
  workflowStatus?: 'open' | 'closed'
}
export interface AppNotice {
  id: string
  userId: string
  title: string
  content: string
  createdAt: string
  read: boolean
  type: 'task' | 'review' | 'system'
  eventType?: string
  eventParams?: Record<string, string | number | boolean | null>
  target?: { kind: 'task' | 'accounts'; id: string }
}
export interface PageData<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
export interface NoticePage extends PageData<AppNotice> {
  unreadCount: number
}
export interface ReviewItem {
  task: CampusTask
  member: TaskMember
  proof: TaskProof
}
export interface DashboardData {
  stats: Record<string, number>
  recentTasks: CampusTask[]
  activeTask: CampusTask | null
  pendingTeachers: CampusUser[]
  organizationStats: Record<string, number>
}
export interface SessionData {
  user: CampusUser | null
  csrfToken: string
  timezone: string
  locale: AppLocale
}
export interface InstallationStatus {
  status: 'required' | 'configured' | 'blocked'
  locale: AppLocale
  setupAvailable: boolean
}
export interface InstallationInput {
  setupToken: string
  locale: AppLocale
  name: string
  platformName: string
  timezone: string
  admin: { account: string; name: string; password: string }
}
export interface InstallationResult {
  installation: InstallationStatus
  school: SchoolProfile
  session: SessionData
}
export interface UploadData {
  id: string
  url: string
}
export interface ApiSuccess<T> {
  ok: true
  message: string
  data: T
  code?: string
  params?: Record<string, string | number | boolean | null>
}
export interface ApiFailure {
  ok: false
  message: string
  code: string
  params?: Record<string, string | number | boolean | null>
}
export type ApiResult<T> = ApiSuccess<T> | ApiFailure
