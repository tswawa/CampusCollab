<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { useAuthStore } from '@/mobile/stores/auth'
import { useCatalogStore } from '@/mobile/stores/catalog'
import { useSystemStore } from '@/mobile/stores/system'
import { useLoad, useMutation, usePagination } from '@/mobile/api/ui'
import LoadState from '@/mobile/components/LoadState.vue'
import PaginationBar from '@/mobile/components/PaginationBar.vue'
import type { AdminAccountPayload, ApprovalStatus, CampusUser, UserRole } from '@/mobile/types'
const auth = useAuthStore()
const catalog = useCatalogStore()
const system = useSystemStore()
const keyword = ref('')
const roleFilter = ref<'all' | UserRole>('all')
const statusFilter = ref<'all' | ApprovalStatus>('all')
const route = useRoute()
watch(
  () => route.query,
  query => {
    roleFilter.value = ['student', 'teacher', 'admin'].includes(String(query.role)) ? (query.role as UserRole) : 'all'
    statusFilter.value = ['approved', 'pending', 'disabled'].includes(String(query.approval))
      ? (query.approval as ApprovalStatus)
      : 'all'
    keyword.value = typeof query.keyword === 'string' ? query.keyword : ''
  },
  { immediate: true }
)
const showEditor = ref(false)
const editingId = ref('')
const { page, pageSize } = usePagination([keyword, roleFilter, statusFilter])
const { loading, error, ready, reload } = useLoad(
  signal =>
    Promise.all([
      auth.fetchAccounts(
        {
          keyword: keyword.value.trim(),
          role: roleFilter.value === 'all' ? undefined : roleFilter.value,
          approval: statusFilter.value === 'all' ? undefined : statusFilter.value,
          page: page.value,
          pageSize
        },
        signal
      ),
      catalog.fetchCatalog(signal)
    ]),
  [keyword, roleFilter, statusFilter, page]
)
const { busy, error: saveError, run } = useMutation()
const blankForm = (): AdminAccountPayload => ({
  role: 'student',
  account: '',
  name: '',
  departmentId: '',
  classId: '',
  gradeId: '',
  password: '',
  approval: 'approved',
  version: undefined,
  isExternal: false
})
const form = reactive<AdminAccountPayload>(blankForm())
const original = ref<CampusUser>()
const roleOptions = computed<Array<{ value: UserRole; label: string }>>(() => [
  { value: 'student', label: msg('学生') },
  { value: 'teacher', label: msg('教师') },
  { value: 'admin', label: msg('管理员') }
])
const statusOptions = computed<Array<{ value: ApprovalStatus; label: string }>>(() => [
  { value: 'approved', label: msg('正常') },
  { value: 'pending', label: msg('待审核') },
  { value: 'disabled', label: msg('已停用') }
])
const departmentOptions = computed(() =>
  catalog.departments.filter(item => item.enabled || item.id === original.value?.departmentId)
)
const gradeOptions = computed(() => catalog.grades.filter(item => item.enabled || item.id === original.value?.gradeId))
const classOptions = computed(() =>
  catalog.classes.filter(
    item =>
      item.departmentId === form.departmentId &&
      item.gradeId === form.gradeId &&
      (item.enabled || item.id === original.value?.classId)
  )
)
watch([() => form.departmentId, () => form.gradeId, () => form.role], () => {
  if (form.role !== 'student') {
    form.classId = undefined
    form.gradeId = undefined
    return
  }
  if (!classOptions.value.some(item => item.id === form.classId)) form.classId = ''
})
const filteredUsers = computed(() => auth.accounts.items)
const pendingUsers = computed(() => filteredUsers.value.filter(user => user.approval === 'pending'))
const roleLabel = (role: UserRole) => roleOptions.value.find(item => item.value === role)?.label ?? role
const statusLabel = (status: ApprovalStatus) => statusOptions.value.find(item => item.value === status)?.label ?? status
function openCreate() {
  editingId.value = ''
  original.value = undefined
  Object.assign(form, blankForm())
  showEditor.value = true
}
function openEdit(user: CampusUser) {
  editingId.value = user.id
  original.value = user
  Object.assign(form, {
    role: user.role,
    account: user.account,
    name: user.name,
    departmentId: user.departmentId,
    classId: user.classId,
    gradeId: user.gradeId,
    password: '',
    approval: user.approval,
    version: user.version,
    isExternal: user.isExternal ?? false
  })
  showEditor.value = true
}
async function refreshVersion() {
  await reload()
  if (error.value) return
  const current = auth.accounts.items.find(item => item.id === editingId.value)
  if (current) {
    form.version = current.version
    original.value = current
  } else showToast(msg('当前筛选中已无此账号，请确认账号是否存在或调整筛选'))
}
async function saveAccount() {
  if (
    !form.account.trim() ||
    !form.name.trim() ||
    (!form.isExternal && system.school.requireDepartment && !form.departmentId)
  ) {
    showToast(msg('请填写完整账号信息'))
    return
  }
  if (
    form.role === 'student' &&
    !form.isExternal &&
    ((system.school.requireGrade && !form.gradeId) || (system.school.requireClass && !form.classId))
  ) {
    showToast(msg('请选择年级和班级'))
    return
  }
  if ((!editingId.value && !form.password) || (form.password && form.password.length < 8)) {
    showToast(msg('密码至少 8 位'))
    return
  }
  const payload: AdminAccountPayload = {
    ...form,
    account: form.account.trim(),
    name: form.name.trim(),
    password: form.password || undefined,
    departmentId: form.departmentId || undefined,
    gradeId: form.gradeId || undefined,
    classId: form.classId || undefined
  }
  await run(
    () => (editingId.value ? auth.updateAccount(editingId.value, payload) : auth.createAccount(payload)),
    () => {
      showEditor.value = false
    },
    msg('账号已保存')
  )
}
function setStatus(user: CampusUser, approval: ApprovalStatus) {
  void run(() => auth.setAccountStatus(user.id, approval, user.version), undefined, msg('账号状态已更新'))
}
async function approvePage() {
  if (busy.value || loading.value || !ready.value || statusFilter.value !== 'pending') return
  const users = pendingUsers.value.slice()
  if (!users.length) return
  try {
    await showConfirmDialog({
      title: msg('通过本页全部待审核账号'),
      message: msg('将通过本页 {p0} 个待审核账号。', { p0: users.length }),
      confirmButtonText: msg('通过')
    })
  } catch {
    return
  }
  const approved = await run(
    async () => {
      for (const user of users) await auth.setAccountStatus(user.id, 'approved', user.version)
    },
    undefined,
    msg('已通过 {p0} 个账号', { p0: users.length })
  )
  if (!approved) await reload()
}
async function removeAccount(user: CampusUser) {
  if (busy.value) return
  try {
    await showConfirmDialog({
      title: msg('删除账号？'),
      message: msg('{p0}（{p1}）将无法继续登录；已有业务关联时请改为停用。', { p0: user.name, p1: user.account }),
      confirmButtonText: msg('删除'),
      confirmButtonColor: '#E11D48'
    })
  } catch {
    return
  }
  await run(() => auth.deleteAccount(user.id, user.version), undefined, msg('账号已删除'))
}
</script>
<template>
  <div class="admin-module-page">
    <LoadState :loading="loading" :error="error" @retry="reload" />
    <section class="admin-toolbar">
      <div class="admin-search-box">
        <van-icon name="search" aria-hidden="true" /><input
          v-model="keyword"
          type="search"
          :aria-label="msg('搜索姓名、账号、学院或班级')"
          :placeholder="msg('搜索姓名、账号、学院或班级')"
        />
      </div>
      <select v-model="roleFilter" class="admin-select-control" :aria-label="msg('按角色筛选')">
        <option value="all">{{ msg('全部角色') }}</option>
        <option v-for="item in roleOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
      <select v-model="statusFilter" class="admin-select-control" :aria-label="msg('按状态筛选')">
        <option value="all">{{ msg('全部状态') }}</option>
        <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
      <van-button
        v-if="statusFilter === 'pending' && ready && !error && pendingUsers.length"
        type="primary"
        :disabled="busy || loading"
        :loading="busy"
        @click="approvePage"
      >
        {{ msg('通过本页全部待审核账号') }}
      </van-button>
      <van-button type="primary" icon="plus" :disabled="busy || loading || !ready" @click="openCreate">{{
        msg('新建账号')
      }}</van-button>
    </section>
    <section v-if="ready && !error" class="admin-table-card">
      <div class="admin-table-header admin-account-grid">
        <span>{{ msg('账号信息') }}</span
        ><span>{{ msg('角色') }}</span
        ><span>{{ msg('组织归属') }}</span
        ><span>{{ msg('状态') }}</span
        ><span>{{ msg('操作') }}</span>
      </div>
      <div v-if="filteredUsers.length === 0" class="admin-table-empty">{{ msg('暂无符合条件的账号') }}</div>
      <div v-for="user in filteredUsers" :key="user.id" class="admin-table-row admin-account-grid">
        <div class="admin-user-cell">
          <div class="admin-list-avatar">{{ user.name.slice(0, 1) }}</div>
          <div>
            <strong>{{ user.name }}</strong
            ><span>{{ user.account }}</span>
          </div>
        </div>
        <span>{{ roleLabel(user.role) }}</span>
        <div class="admin-organization-cell">
          <strong>{{ user.department || '—' }}</strong
          ><span v-if="user.className">{{ user.grade }} · {{ user.className }}</span>
        </div>
        <span class="admin-status-pill" :class="`is-${user.approval}`">{{ statusLabel(user.approval) }}</span>
        <div class="admin-row-actions">
          <button type="button" :disabled="busy" @click="openEdit(user)">{{ msg('编辑') }}</button>
          <button
            v-if="user.approval === 'pending'"
            type="button"
            class="is-primary"
            :disabled="busy"
            @click="setStatus(user, 'approved')"
          >
            {{ msg('通过') }}
          </button>
          <button
            v-else-if="user.approval === 'disabled'"
            type="button"
            class="is-primary"
            :disabled="busy"
            @click="setStatus(user, 'approved')"
          >
            {{ msg('启用') }}
          </button>
          <button
            v-else
            type="button"
            :disabled="busy || user.id === auth.currentUserId"
            @click="setStatus(user, 'disabled')"
          >
            {{ msg('停用') }}
          </button>
          <button
            type="button"
            class="is-danger"
            :disabled="busy || user.id === auth.currentUserId"
            @click="removeAccount(user)"
          >
            {{ msg('删除') }}
          </button>
        </div>
      </div>
      <PaginationBar
        v-model:page="page"
        :page-size="pageSize"
        :total="auth.accounts.total"
        :loading="loading || busy"
      />
    </section>
    <van-popup
      v-model:show="showEditor"
      :aria-label="editingId ? msg('编辑账号') : msg('新建账号')"
      position="right"
      :close-on-click-overlay="!busy"
      :style="{ width: 'min(92vw, 460px)', height: '100%' }"
    >
      <div class="admin-editor-panel">
        <header class="admin-editor-header">
          <div>
            <h2>{{ editingId ? msg('编辑账号') : msg('新建账号') }}</h2>
          </div>
          <button type="button" :disabled="busy" :aria-label="msg('关闭')" @click="showEditor = false">×</button>
        </header>
        <div class="admin-editor-body">
          <p v-if="saveError" role="alert">
            {{ saveError }}
            <van-button v-if="editingId" size="small" :disabled="busy || loading" @click="refreshVersion">{{
              msg('刷新并保留草稿')
            }}</van-button>
          </p>
          <label class="admin-field-label"
            ><span>{{ msg('角色') }}</span
            ><select v-model="form.role" :disabled="busy" class="admin-input-control">
              <option v-for="item in roleOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select></label
          >
          <label class="admin-field-label"
            ><span>{{ msg('姓名') }}</span
            ><input v-model="form.name" :disabled="busy" class="admin-input-control" :placeholder="msg('请输入姓名')"
          /></label>
          <label class="admin-field-label"
            ><span>{{ msg('登录账号') }}</span
            ><input
              v-model="form.account"
              :disabled="busy"
              class="admin-input-control"
              :placeholder="msg('请输入学号、工号或管理账号')"
          /></label>
          <label class="admin-field-label"
            ><span>{{ editingId ? msg('重置密码（选填）') : msg('初始密码') }}</span
            ><input
              v-model="form.password"
              :disabled="busy"
              type="password"
              autocomplete="new-password"
              class="admin-input-control"
              :placeholder="msg('至少 8 位')"
          /></label>
          <p style="margin: -8px 0 14px; font-size: 12px; color: var(--muted)">
            {{ msg('用户首次登录时需要修改这个密码。') }}
          </p>
          <label class="admin-field-label"
            ><span>{{ msg('所属学院 / 部门') }}</span
            ><select v-model="form.departmentId" :disabled="busy" class="admin-input-control">
              <option value="" disabled>{{ msg('请选择') }}</option>
              <option v-for="item in departmentOptions" :key="item.id" :value="item.id">
                {{ item.name }}{{ !item.enabled ? msg('（停用）') : '' }}
              </option>
            </select></label
          >
          <template v-if="form.role === 'student'">
            <label class="admin-field-label"
              ><span>{{ msg('年级') }}</span
              ><select v-model="form.gradeId" :disabled="busy" class="admin-input-control">
                <option value="" disabled>{{ msg('请选择') }}</option>
                <option v-for="item in gradeOptions" :key="item.id" :value="item.id">
                  {{ item.name }}{{ !item.enabled ? msg('（停用）') : '' }}
                </option>
              </select></label
            >
            <label class="admin-field-label"
              ><span>{{ msg('班级') }}</span
              ><select
                v-model="form.classId"
                :disabled="busy || !form.departmentId || !form.gradeId"
                class="admin-input-control"
              >
                <option value="" disabled>{{ msg('请选择') }}</option>
                <option v-for="item in classOptions" :key="item.id" :value="item.id">
                  {{ item.name }}{{ !item.enabled ? msg('（停用）') : '' }}
                </option>
              </select></label
            >
          </template>
          <label class="admin-field-label"
            ><span>{{ msg('账号状态') }}</span
            ><select v-model="form.approval" :disabled="busy" class="admin-input-control">
              <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select></label
          >
        </div>
        <footer class="admin-editor-footer">
          <van-button :disabled="busy" @click="showEditor = false">{{ msg('取消') }}</van-button
          ><van-button type="primary" :loading="busy" @click="saveAccount">{{ msg('保存账号') }}</van-button>
        </footer>
      </div>
    </van-popup>
  </div>
</template>
