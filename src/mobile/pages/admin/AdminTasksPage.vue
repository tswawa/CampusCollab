<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, reactive, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useRoute, useRouter } from 'vue-router'
import { useCatalogStore } from '@/mobile/stores/catalog'
import { useTaskStore } from '@/mobile/stores/tasks'
import type { CampusTask, TaskStatus } from '@/mobile/types'
import { useLoad, useMutation, usePagination } from '@/mobile/api/ui'
import { useEvidencePreview } from '@/mobile/composables/useEvidencePreview'
import LoadState from '@/mobile/components/LoadState.vue'
import PaginationBar from '@/mobile/components/PaginationBar.vue'
import { audienceLabel, getOccupiedCount, memberStatusMeta, proofTypeLabels, taskStatusMeta } from '@/mobile/utils/task'

const router = useRouter()
const viewProofImages = useEvidencePreview()
const route = useRoute()
const catalog = useCatalogStore()
const taskStore = useTaskStore()
const keyword = ref('')
const statusFilter = ref<'all' | TaskStatus>('all')
const campusFilter = ref('all')
const categoryFilter = ref('all')
const showEditor = ref(false)
const editingId = ref('')
const detailTask = computed(() => taskStore.taskById(String(route.query.task ?? '')))
const detailProofDescription = computed(
  () => detailTask.value?.proofTypes.map(type => proofTypeLabels[type]).join(', ') ?? ''
)
const showDetail = computed({
  get: () => Boolean(route.query.task),
  set: (value: boolean) => {
    if (!value && !busy.value) router.replace({ query: { ...route.query, task: undefined } })
  }
})
watch(
  () => route.query.status,
  value => {
    statusFilter.value = typeof value === 'string' && value in taskStatusMeta ? (value as TaskStatus) : 'all'
  },
  { immediate: true }
)

const form = reactive({
  title: '',
  category: '',
  campus: '',
  place: '',
  date: '',
  startTime: '',
  endTime: '',
  signupDeadline: '',
  duration: '',
  capacity: 1,
  version: 0,
  status: 'recruiting' as TaskStatus,
  description: ''
})

const statusOptions: TaskStatus[] = [
  'recruiting',
  'upcoming',
  'full',
  'in_progress',
  'review',
  'changes_requested',
  'completed',
  'cancelled'
]

const filters = [keyword, statusFilter, campusFilter, categoryFilter]
const { page, pageSize } = usePagination(filters)
const { loading, error, ready, reload } = useLoad(
  signal =>
    taskStore.fetchTasks(
      {
        keyword: keyword.value.trim(),
        status: statusFilter.value === 'all' ? undefined : statusFilter.value,
        campusId: campusFilter.value === 'all' ? undefined : campusFilter.value,
        categoryId: categoryFilter.value === 'all' ? undefined : categoryFilter.value,
        page: page.value,
        pageSize
      },
      signal
    ),
  [...filters, page]
)
const {
  loading: detailLoading,
  error: detailError,
  reload: reloadDetail
} = useLoad(
  async signal => {
    if (typeof route.query.task === 'string') await taskStore.fetchTask(route.query.task, signal)
  },
  [() => route.query.task]
)
const { busy, error: saveError, run } = useMutation()
const filteredTasks = computed(() => taskStore.tasks)

function openEdit(task: CampusTask) {
  showDetail.value = false
  editingId.value = task.id
  Object.assign(form, {
    title: task.title,
    category: task.categoryId,
    campus: task.campusId,
    place: task.location,
    version: task.version,
    date: task.date,
    startTime: task.startTime,
    endTime: task.endTime,
    signupDeadline: task.signupDeadline.replace(' ', 'T'),
    duration: task.duration,
    capacity: task.capacity,
    status: task.status,
    description: task.description
  })
  showEditor.value = true
}

async function refreshEditVersion() {
  await run(async () => {
    form.version = (await taskStore.fetchTask(editingId.value)).version
  })
}
async function saveTask() {
  if (!editingId.value) return
  if (!form.title.trim() || !form.place.trim() || !form.description.trim()) {
    showToast(msg('请填写任务名称、地点和说明'))
    return
  }
  if (
    !catalog.taskCategories.some(item => item.id === form.category) ||
    !catalog.campuses.some(item => item.id === form.campus)
  ) {
    showToast(msg('请选择有效的分类和校区'))
    return
  }
  await run(
    () =>
      taskStore.updateTask(editingId.value, {
        title: form.title.trim(),
        version: form.version,
        categoryId: form.category,
        campusId: form.campus,
        place: form.place.trim(),
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        signupDeadline: form.signupDeadline.replace('T', ' '),
        duration: form.duration.trim(),
        capacity: Number(form.capacity),
        description: form.description.trim()
      }),
    () => {
      showEditor.value = false
    },
    msg('任务已更新')
  )
}

async function cancelTask(task: CampusTask) {
  try {
    await showConfirmDialog({
      title: msg('撤销任务？'),
      message: msg('任务将下架，并通知已参与学生。'),
      confirmButtonText: msg('撤销'),
      confirmButtonColor: '#E11D48'
    })
  } catch {
    return
  }
  await run(() => taskStore.cancelTask(task.id, task.version), undefined, msg('已撤销'))
}

function restoreTask(task: CampusTask) {
  void run(() => taskStore.restoreTask(task.id, task.version), undefined, msg('已恢复'))
}

function statusLabel(status: TaskStatus) {
  return taskStatusMeta[status]?.label ?? status
}
</script>

<template>
  <div class="admin-module-page">
    <LoadState :loading="loading" :error="error" @retry="reload" />
    <section class="admin-toolbar">
      <div class="admin-search-box">
        <van-icon name="search" />
        <input
          v-model="keyword"
          type="search"
          :aria-label="msg('搜索任务、发布人、学院或地点')"
          :placeholder="msg('搜索任务、发布人、学院或地点')"
        />
      </div>
      <select v-model="statusFilter" class="admin-select-control" :aria-label="msg('按状态筛选')">
        <option value="all">{{ msg('全部状态') }}</option>
        <option v-for="status in statusOptions" :key="status" :value="status">{{ statusLabel(status) }}</option>
      </select>
      <select v-model="campusFilter" class="admin-select-control" :aria-label="msg('校区')">
        <option value="all">{{ msg('全部校区') }}</option>
        <option v-for="item in catalog.campuses" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
      <select v-model="categoryFilter" class="admin-select-control" :aria-label="msg('任务分类')">
        <option value="all">{{ msg('全部分类') }}</option>
        <option v-for="item in catalog.taskCategories" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
    </section>

    <section v-if="ready && !error" class="admin-table-card">
      <div class="admin-table-header admin-task-grid">
        <span>{{ msg('任务') }}</span>
        <span>{{ msg('发布信息') }}</span>
        <span>{{ msg('时间地点') }}</span>
        <span>{{ msg('进度') }}</span>
        <span>{{ msg('状态') }}</span>
        <span>{{ msg('操作') }}</span>
      </div>
      <div v-if="filteredTasks.length === 0" class="admin-table-empty">{{ msg('暂无符合条件的任务') }}</div>
      <div v-for="task in filteredTasks" :key="task.id" class="admin-table-row admin-task-grid">
        <div class="admin-row-main">
          <strong>{{ task.title }}</strong>
          <span>{{ task.category }}</span>
        </div>
        <div class="admin-organization-cell">
          <strong>{{ task.teacherName }}</strong>
          <span>{{ task.department }}</span>
        </div>
        <div class="admin-organization-cell">
          <strong>{{ task.date }} {{ task.startTime }}–{{ task.endTime }}</strong>
          <span>{{ task.place }}</span>
        </div>
        <span>{{ msg('{p0}/{p1} 人', { p0: task.occupiedCount, p1: task.capacity }) }}</span>
        <span class="admin-task-status" :style="{ color: taskStatusMeta[task.status]?.color }">
          {{ statusLabel(task.status) }}
        </span>
        <div class="admin-row-actions">
          <button type="button" :disabled="busy" @click="router.push({ query: { ...route.query, task: task.id } })">
            {{ msg('查看') }}
          </button>
          <button type="button" :disabled="busy" @click="openEdit(task)">{{ msg('编辑') }}</button>
          <button
            v-if="task.status === 'cancelled'"
            :disabled="busy"
            type="button"
            class="is-primary"
            @click="restoreTask(task)"
          >
            {{ msg('上架') }}
          </button>
          <button v-else type="button" :disabled="busy" class="is-danger" @click="cancelTask(task)">
            {{ msg('撤销') }}
          </button>
        </div>
      </div>
    </section>
    <PaginationBar
      v-model:page="page"
      :page-size="pageSize"
      :total="taskStore.taskPage.total"
      :loading="loading || busy"
    />

    <van-popup
      v-model:show="showDetail"
      :aria-label="msg('任务详情')"
      position="right"
      :style="{ width: 'min(94vw, 680px)', height: '100%' }"
    >
      <LoadState :loading="detailLoading" :error="detailError" @retry="reloadDetail" />
      <div v-if="detailTask && !detailLoading && !detailError" class="admin-editor-panel">
        <header class="admin-editor-header">
          <div>
            <h2>{{ msg('任务详情') }}</h2>
            <p>{{ statusLabel(detailTask.status) }}</p>
          </div>
          <button type="button" :disabled="busy" :aria-label="msg('关闭任务详情')" @click="showDetail = false">
            ×
          </button>
        </header>
        <div class="admin-editor-body">
          <h2>{{ detailTask.title }}</h2>
          <van-button type="primary" @click="router.push(`/tasks/${detailTask.id}/workflow`)">{{
            msg('名单与结项')
          }}</van-button>
          <p style="white-space: pre-wrap">{{ detailTask.description }}</p>
          <div class="admin-editor-grid">
            <div class="admin-field-label">
              <span>{{ msg('发布人') }}</span
              ><strong>{{ detailTask.teacherName }} · {{ detailTask.department }}</strong>
            </div>
            <div class="admin-field-label">
              <span>{{ msg('分类 / 范围') }}</span
              ><strong>{{ detailTask.category }} · {{ audienceLabel(detailTask) }}</strong>
            </div>
            <div class="admin-field-label">
              <span>{{ msg('时间地点') }}</span
              ><strong>{{ detailTask.date }} {{ detailTask.startTime }}–{{ detailTask.endTime }}</strong
              ><span>{{ detailTask.place }}</span>
            </div>
            <div class="admin-field-label">
              <span>{{ msg('报名与名额') }}</span
              ><strong>{{ msg('{p0} 截止', { p0: detailTask.signupDeadline }) }}</strong
              ><span>{{
                msg('已录取 {p0} / {p1} 人', { p0: getOccupiedCount(detailTask), p1: detailTask.capacity })
              }}</span>
            </div>
          </div>
          <section v-if="detailTask.checklist.length">
            <h3>{{ msg('工作清单') }}</h3>
            <ul>
              <li v-for="item in detailTask.checklist" :key="item">{{ item }}</li>
            </ul>
          </section>
          <section v-if="detailTask.requirements.length">
            <h3>{{ msg('参与要求') }}</h3>
            <ul>
              <li v-for="item in detailTask.requirements" :key="item">{{ item }}</li>
            </ul>
          </section>
          <section>
            <h3>{{ msg('联系方式') }}</h3>
            <p v-for="(contact, index) in detailTask.contacts" :key="index">{{ contact.label }}：{{ contact.value }}</p>
            <p v-if="!detailTask.contacts?.length">{{ msg('未配置联系方式') }}</p>
          </section>
          <section>
            <h3>{{ msg('参与学生与凭证') }}</h3>
            <p>{{ msg('验收要求：{p0}', { p0: detailProofDescription }) }}</p>

            <div v-for="member in detailTask.members" :key="member.userId" class="admin-dashboard-panel surface-card">
              <strong>{{ member.name }} · {{ member.account }}</strong>
              <p>{{ member.department }} · {{ member.className }} · {{ memberStatusMeta[member.status]?.label }}</p>
              <template v-if="member.proof">
                <p style="white-space: pre-wrap">{{ member.proof.description }}</p>
                <p v-if="member.proof.note">{{ member.proof.note }}</p>
                <p>{{ member.proof.submittedAt }}</p>
                <button
                  v-if="member.proof.images.length"
                  type="button"
                  class="admin-inline-link"
                  @click="viewProofImages(member.proof.images)"
                >
                  {{ msg('查看 {p0} 张凭证图片', { p0: member.proof.images.length }) }}
                </button>
              </template>
              <p v-if="member.feedback">{{ msg('验收反馈：{p0}', { p0: member.feedback }) }}</p>
            </div>
          </section>
        </div>
        <footer class="admin-editor-footer">
          <van-button @click="showDetail = false">{{ msg('关闭') }}</van-button>
          <van-button type="primary" @click="openEdit(detailTask)">{{ msg('编辑任务') }}</van-button>
        </footer>
      </div>
    </van-popup>

    <van-popup
      :close-on-click-overlay="!busy"
      v-model:show="showEditor"
      :aria-label="msg('编辑任务')"
      position="right"
      :style="{ width: 'min(94vw, 520px)', height: '100%' }"
    >
      <div class="admin-editor-panel">
        <header class="admin-editor-header">
          <div>
            <h2>{{ msg('编辑任务') }}</h2>
          </div>
          <button type="button" :disabled="busy" :aria-label="msg('关闭')" @click="showEditor = false">×</button>
        </header>

        <div class="admin-editor-body admin-editor-grid">
          <p v-if="saveError" role="alert">
            {{ saveError }}
            <van-button size="small" :disabled="busy" @click="refreshEditVersion">{{
              msg('刷新并保留草稿')
            }}</van-button>
          </p>
          <label class="admin-field-label admin-field-full">
            <span>{{ msg('任务名称') }}</span>
            <input v-model="form.title" :disabled="busy" class="admin-input-control" />
          </label>
          <label class="admin-field-label">
            <span>{{ msg('分类') }}</span>
            <select v-model="form.category" :disabled="busy" class="admin-input-control">
              <option v-for="item in catalog.taskCategories" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </label>
          <label class="admin-field-label">
            <span>{{ msg('校区') }}</span>
            <select v-model="form.campus" :disabled="busy" class="admin-input-control">
              <option v-for="item in catalog.campuses" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </label>
          <label class="admin-field-label admin-field-full">
            <span>{{ msg('具体地点') }}</span>
            <input v-model="form.place" :disabled="busy" class="admin-input-control" />
          </label>
          <label class="admin-field-label">
            <span>{{ msg('日期') }}</span>
            <input v-model="form.date" type="date" :disabled="busy" class="admin-input-control" />
          </label>
          <label class="admin-field-label">
            <span>{{ msg('报名截止') }}</span>
            <input v-model="form.signupDeadline" type="datetime-local" :disabled="busy" class="admin-input-control" />
          </label>
          <label class="admin-field-label">
            <span>{{ msg('开始时间') }}</span>
            <input v-model="form.startTime" type="time" :disabled="busy" class="admin-input-control" />
          </label>
          <label class="admin-field-label">
            <span>{{ msg('结束时间') }}</span>
            <input v-model="form.endTime" type="time" :disabled="busy" class="admin-input-control" />
          </label>
          <label class="admin-field-label">
            <span>{{ msg('预计耗时') }}</span>
            <input v-model="form.duration" :disabled="busy" class="admin-input-control" />
          </label>
          <label class="admin-field-label">
            <span>{{ msg('招募人数') }}</span>
            <input v-model.number="form.capacity" type="number" min="1" :disabled="busy" class="admin-input-control" />
          </label>
          <div class="admin-field-label">
            <span>{{ msg('当前状态') }}</span>
            <strong>{{ statusLabel(form.status) }}</strong>
          </div>
          <label class="admin-field-label admin-field-full">
            <span>{{ msg('任务说明') }}</span>
            <textarea v-model="form.description" rows="5" :disabled="busy" class="admin-input-control" />
          </label>
        </div>

        <footer class="admin-editor-footer">
          <van-button :disabled="busy" @click="showEditor = false">{{ msg('取消') }}</van-button>
          <van-button type="primary" :loading="busy" :disabled="busy" @click="saveTask">{{
            msg('保存任务')
          }}</van-button>
        </footer>
      </div>
    </van-popup>
  </div>
</template>
