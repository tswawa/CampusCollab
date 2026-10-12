<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, reactive, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useCatalogStore } from '@/mobile/stores/catalog'
import { useLoad, useMutation } from '@/mobile/api/ui'
import LoadState from '@/mobile/components/LoadState.vue'
import type { CatalogItem, CatalogKind } from '@/mobile/types'
const catalog = useCatalogStore()
const activeSection = ref<CatalogKind>('departments')
const showEditor = ref(false)
const { loading, error, ready, reload } = useLoad(signal => catalog.fetchCatalog(signal))
const { busy, error: saveError, run } = useMutation()
const sections = computed<Array<{ value: CatalogKind; label: string }>>(() => [
  { value: 'departments', label: msg('学院与部门') },
  { value: 'grades', label: msg('年级') },
  { value: 'classes', label: msg('班级') },
  { value: 'campuses', label: msg('校区') },
  { value: 'categories', label: msg('任务分类') }
])
type OrganizationItem = CatalogItem & { code?: string; departmentId?: string; gradeId?: string }
const form = reactive({ id: '', name: '', code: '', departmentId: '', gradeId: '', enabled: true, version: 0 })
const currentItems = computed<OrganizationItem[]>(() =>
  activeSection.value === 'categories' ? catalog.taskCategories : catalog[activeSection.value]
)
const sectionTitle = () => sections.value.find(item => item.value === activeSection.value)?.label ?? ''
function openCreate() {
  Object.assign(form, {
    id: '',
    name: '',
    code: '',
    departmentId: catalog.activeDepartments[0]?.id ?? '',
    gradeId: catalog.activeGrades[0]?.id ?? '',
    enabled: true,
    version: 0
  })
  showEditor.value = true
}
function openEdit(item: OrganizationItem) {
  Object.assign(form, {
    id: item.id,
    name: item.name,
    code: item.code ?? '',
    departmentId: item.departmentId ?? '',
    gradeId: item.gradeId ?? '',
    enabled: item.enabled,
    version: item.version
  })
  showEditor.value = true
}
async function refreshVersion() {
  await reload()
  if (error.value) return
  const current = currentItems.value.find(item => item.id === form.id)
  if (current) form.version = current.version
  else showToast(msg('该选项已不存在，请关闭后重新检查'))
}
async function saveItem() {
  if (!form.name.trim()) {
    showToast(msg('请输入名称'))
    return
  }
  const kind = activeSection.value
  if (kind === 'departments' && !form.code.trim()) {
    showToast(msg('请输入学院代码'))
    return
  }
  if (kind === 'classes' && (!form.departmentId || !form.gradeId)) {
    showToast(msg('请选择学院和年级'))
    return
  }
  const payload = {
    name: form.name.trim(),
    ...(kind === 'departments' ? { code: form.code.trim() } : {}),
    ...(kind === 'classes' ? { departmentId: form.departmentId, gradeId: form.gradeId } : {}),
    ...(form.id ? { enabled: form.enabled, version: form.version } : {})
  }
  await run(
    () => catalog.saveItem(kind, payload, form.id || undefined),
    () => {
      showEditor.value = false
    },
    form.id ? msg('已更新') : msg('已添加')
  )
}
async function removeItem(item: OrganizationItem) {
  if (busy.value) return
  const kind = activeSection.value
  try {
    await showConfirmDialog({
      title: msg('删除{p0}？', { p0: item.name }),
      message: msg('有关联的记录无法删除，可改为停用。'),
      confirmButtonText: msg('删除'),
      confirmButtonColor: '#E11D48'
    })
  } catch {
    return
  }
  await run(() => catalog.removeItem(kind, item.id, item.version), undefined, msg('已删除'))
}
function toggleItem(item: OrganizationItem) {
  const kind = activeSection.value
  void run(
    () => catalog.saveItem(kind, { enabled: !item.enabled, version: item.version }, item.id),
    undefined,
    item.enabled ? msg('已停用') : msg('已启用')
  )
}
function itemSubtitle(item: OrganizationItem) {
  if (activeSection.value === 'departments') return msg('代码：{p0}', { p0: item.code ?? '' })
  if (activeSection.value === 'classes')
    return `${catalog.departmentNameById(item.departmentId ?? '')} · ${catalog.gradeNameById(item.gradeId ?? '')}`
  return ''
}
</script>
<template>
  <div class="admin-module-page">
    <LoadState :loading="loading" :error="error" @retry="reload" />
    <section class="admin-segment-tabs">
      <button
        v-for="section in sections"
        :key="section.value"
        type="button"
        :disabled="busy || showEditor"
        :class="{ 'is-active': activeSection === section.value }"
        :aria-pressed="activeSection === section.value"
        @click="activeSection = section.value"
      >
        {{ section.label }}
      </button>
    </section>
    <section class="admin-toolbar admin-toolbar-compact">
      <div>
        <strong>{{ sectionTitle() }}</strong
        ><span>{{ msg('共 {p0} 项', { p0: currentItems.length }) }}</span>
      </div>
      <van-button type="primary" icon="plus" :disabled="busy || loading || !ready" @click="openCreate">{{
        msg('新增')
      }}</van-button>
    </section>
    <section v-if="ready && !error" class="admin-table-card">
      <div class="admin-table-header admin-org-grid">
        <span>{{ msg('名称') }}</span
        ><span>{{ msg('关联信息') }}</span
        ><span>{{ msg('状态') }}</span
        ><span>{{ msg('操作') }}</span>
      </div>
      <div v-for="item in currentItems" :key="item.id" class="admin-table-row admin-org-grid">
        <strong>{{ item.name }}</strong
        ><span>{{ itemSubtitle(item) || '—' }}</span
        ><span class="admin-status-pill" :class="item.enabled ? 'is-approved' : 'is-disabled'">{{
          item.enabled ? msg('启用') : msg('停用')
        }}</span>
        <div class="admin-row-actions">
          <button type="button" :disabled="busy" @click="openEdit(item)">{{ msg('编辑') }}</button
          ><button type="button" :disabled="busy" @click="toggleItem(item)">
            {{ item.enabled ? msg('停用') : msg('启用') }}</button
          ><button type="button" class="is-danger" :disabled="busy" @click="removeItem(item)">{{ msg('删除') }}</button>
        </div>
      </div>
    </section>
    <van-popup
      v-model:show="showEditor"
      :aria-label="(form.id ? msg('编辑') : msg('新增')) + sectionTitle()"
      position="right"
      :close-on-click-overlay="!busy"
      :style="{ width: 'min(92vw, 440px)', height: '100%' }"
    >
      <div class="admin-editor-panel">
        <header class="admin-editor-header">
          <div>
            <h2>{{ form.id ? msg('编辑') : msg('新增') }}{{ sectionTitle() }}</h2>
          </div>
          <button type="button" :disabled="busy" :aria-label="msg('关闭')" @click="showEditor = false">×</button>
        </header>
        <div class="admin-editor-body">
          <p v-if="saveError" role="alert">
            {{ saveError }}
            <van-button v-if="form.id" size="small" :disabled="busy || loading" @click="refreshVersion">{{
              msg('刷新并保留草稿')
            }}</van-button>
          </p>
          <label class="admin-field-label"
            ><span>{{ msg('名称') }}</span
            ><input v-model="form.name" :disabled="busy" class="admin-input-control" :placeholder="msg('请输入名称')"
          /></label>
          <label v-if="activeSection === 'departments'" class="admin-field-label"
            ><span>{{ msg('学院代码') }}</span
            ><input
              v-model="form.code"
              :disabled="busy"
              class="admin-input-control"
              :placeholder="msg('例如 CS')"
              maxlength="12"
          /></label>
          <template v-if="activeSection === 'classes'">
            <label class="admin-field-label"
              ><span>{{ msg('所属学院') }}</span
              ><select v-model="form.departmentId" :disabled="busy" class="admin-input-control">
                <option
                  v-for="item in catalog.departments"
                  :key="item.id"
                  :value="item.id"
                  :disabled="!item.enabled && item.id !== form.departmentId"
                >
                  {{ item.name }}{{ !item.enabled ? msg('（停用）') : '' }}
                </option>
              </select></label
            >
            <label class="admin-field-label"
              ><span>{{ msg('所属年级') }}</span
              ><select v-model="form.gradeId" :disabled="busy" class="admin-input-control">
                <option
                  v-for="item in catalog.grades"
                  :key="item.id"
                  :value="item.id"
                  :disabled="!item.enabled && item.id !== form.gradeId"
                >
                  {{ item.name }}{{ !item.enabled ? msg('（停用）') : '' }}
                </option>
              </select></label
            >
          </template>
          <label v-if="form.id" class="admin-switch-row"
            ><span>{{ msg('启用') }}</span
            ><van-switch v-model="form.enabled" :disabled="busy" size="22"
          /></label>
        </div>
        <footer class="admin-editor-footer">
          <van-button :disabled="busy" @click="showEditor = false">{{ msg('取消') }}</van-button
          ><van-button type="primary" :loading="busy" @click="saveItem">{{ msg('保存') }}</van-button>
        </footer>
      </div>
    </van-popup>
  </div>
</template>
