<script setup lang="ts">
import { locale, msg } from '@/mobile/i18n'
import { computed, reactive, ref, watch } from 'vue'
import { showToast } from 'vant'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useCatalogStore } from '@/mobile/stores/catalog'
import { useTaskStore } from '@/mobile/stores/tasks'
import { dateOffset, zonedLocalToInstant } from '@/mobile/utils/date'
import { useLoad, useMutation } from '@/mobile/api/ui'
import LoadState from '@/mobile/components/LoadState.vue'
import { request } from '@/mobile/api'
import { evidenceTemplates } from '../../../../shared/templates'
import type { ConfigureWorkflowInput, TaskWorkflow } from '../../../../shared/workflow-contracts'
import type {
  AudienceScope,
  ClaimMode,
  ContactItem,
  ContactMethodType,
  ProofType
} from '@/mobile/types'

const router = useRouter()
const route = useRoute()
const copyFrom = computed(() => typeof route.query.copy === 'string' ? route.query.copy : '')
const auth = useAuthStore()
const catalog = useCatalogStore()
const taskStore = useTaskStore()
const teacher = computed(() => auth.currentUser!)

const step = ref(1)
const { busy: publishing, error: publishError, run } = useMutation()
const validationError = ref('')
let copied = ''
const { loading, error, reload } = useLoad(async signal => {
  await catalog.fetchCatalog(signal)
  if (copyFrom.value && copied !== copyFrom.value) {
    const [source, flow] = await Promise.all([taskStore.fetchTask(copyFrom.value, signal), request<TaskWorkflow>(`/tasks/${encodeURIComponent(copyFrom.value)}/workflow`, { signal })])
    Object.assign(form, { title: source.title, category: source.categoryId, campus: source.campusId, place: source.location, description: source.description, duration: source.duration, capacity: source.capacity, audienceScope: source.audienceScope, audienceValue: source.audienceId ?? '', proofTypes: [...source.proofTypes], claimMode: source.claimMode, contacts: source.contacts.map(c => ({ ...c })) })
    const { templateId, templateVersion, mode, plannedMinutes, personalSubmissionRequired } = flow.data.config
    Object.assign(workflowConfig, { templateId, templateVersion, mode, plannedMinutes, personalSubmissionRequired, submissionDeadline: null })
    checklistText.value = source.checklist.join('\n'); requirementsText.value = source.requirements.join('\n'); copied = copyFrom.value
  }
}, [copyFrom])
const checklistText = ref('')
const requirementsText = ref('')
const submissionDeadlineLocal = ref('')
const workflowConfig = reactive<Omit<ConfigureWorkflowInput, 'version'>>({ templateId: 'generic-practice', templateVersion: 1, mode: 'individual', plannedMinutes: 120, submissionDeadline: null, personalSubmissionRequired: true })
const selectedTemplate = computed(() => evidenceTemplates.find(item => item.id === workflowConfig.templateId))

const form = reactive({
  title: '',
  category: catalog.activeTaskCategories[0]?.id ?? '',
  campus: catalog.activeCampuses[0]?.id ?? '',
  place: '',
  description: '',
  date: dateOffset(1),
  startTime: '14:00',
  endTime: '16:00',
  signupDeadline: `${dateOffset(1)}T12:00`,
  duration: msg("约 2 小时"),
  capacity: 2,
  audienceScope: 'department' as AudienceScope,
  audienceValue: teacher.value?.departmentId ?? catalog.activeDepartments[0]?.id ?? '',
  proofTypes: ['image', 'text'] as ProofType[],
  claimMode: 'direct' as ClaimMode,
  contacts: [] as ContactItem[]
})

const categories = computed(() => catalog.activeTaskCategories)
const campuses = computed(() => catalog.activeCampuses)
const audienceOptions = computed(() => {
  if (form.audienceScope === 'department') return catalog.activeDepartments
  if (form.audienceScope === 'class') return catalog.activeClasses
  if (form.audienceScope === 'grade') return catalog.activeGrades
  return [{ id: '', name: msg("全校学生") }]
})

watch(
  [categories, campuses, audienceOptions],
  () => {
    if (!categories.value.some((item) => item.id === form.category)) form.category = categories.value[0]?.id ?? ''
    if (!campuses.value.some((item) => item.id === form.campus)) form.campus = campuses.value[0]?.id ?? ''
    if (!audienceOptions.value.some((item) => item.id === form.audienceValue)) form.audienceValue = audienceOptions.value[0]?.id ?? ''
  },
  { immediate: true }
)

// 添加联系方式选项
const newContactType = ref<ContactMethodType>('email')
const newContactValue = ref('')

const availableContactTypes = computed<Array<{ type: ContactMethodType; label: string; placeholder: string }>>(() => [
  { type: 'wechat', label: msg("微信"), placeholder: msg("请输入微信号") },
  { type: 'phone', label: msg("电话"), placeholder: msg("请输入办公或手机号码") },
  { type: 'email', label: msg("邮箱"), placeholder: msg("请输入电子邮箱") },
  { type: 'qq', label: 'QQ', placeholder: msg("请输入QQ号或群号") },
  { type: 'office', label: msg("办公地点"), placeholder: msg("例如：信息楼 B302") },

  { type: 'custom', label: msg("自定义"), placeholder: msg("请输入联系方式内容") }
])

function addContactItem() {
  if (!newContactValue.value.trim()) {
    showToast(msg("请输入联系方式内容"))
    return
  }
  const typeObj = availableContactTypes.value.find((t) => t.type === newContactType.value)
  form.contacts.push({
    type: newContactType.value,
    label: typeObj?.label || msg("联系方式"),
    value: newContactValue.value.trim()
  })
  newContactValue.value = ''
  showToast(msg("已添加联系方式"))
}

function removeContactItem(index: number) {
  form.contacts.splice(index, 1)
}

function validateStep(currentStep = step.value): string {
  if (currentStep === 1) {
    if (!categories.value.some((item) => item.id === form.category)) return msg("请选择有效的任务分类")
    if (!campuses.value.some((item) => item.id === form.campus)) return msg("请选择有效的校区")
    if (form.title.trim().length < 4) return msg("任务名称至少填写 4 个字")
    if (!form.place.trim()) return msg("请填写任务地点")
    if (form.description.trim().length < 8) return msg("任务说明至少填写 8 个字")
  }
  if (currentStep === 2) {
    if (!audienceOptions.value.some((item) => item.id === form.audienceValue)) return msg("请选择有效的任务面向范围")
    if (!form.date) return msg("请选择任务日期")
    if (!form.startTime || !form.endTime || form.endTime <= form.startTime) {
      return msg("结束时间必须晚于开始时间")
    }
    if (!form.signupDeadline || form.signupDeadline > `${form.date}T${form.startTime}`) {
      return msg("报名截止不得晚于任务开始时间")
    }
    if (!Number.isInteger(form.capacity) || form.capacity < 1 || form.capacity > 10000) return msg("招募人数须为 1 至 10000 的整数")
    if (form.proofTypes.length === 0) return msg("请至少选择一种验收凭证")
  }
  return ''
}

function next() {
  const err = validateStep()
  validationError.value = err
  if (err) {
    showToast(err)
    return
  }
  step.value = Math.min(step.value + 1, 4)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function prev() {
  step.value = Math.max(step.value - 1, 1)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function publish() {
  if (publishing.value) return
  const error = validateStep(1) || validateStep(2)
  validationError.value = error
  if (error) {
    showToast(error)
    return
  }
  if (!auth.isLoggedIn || auth.role !== 'teacher') {
    showToast(msg("请使用有效教师账号登录"))
    return
  }
  const deadlineStr = form.signupDeadline.replace('T', ' ')
  await run(() => taskStore.createTask(
    {
      title: form.title.trim(),
      categoryId: form.category,
      campusId: form.campus,
      description: form.description.trim(),
      checklist: checklistText.value
        .split('\n')
        .map((i) => i.trim())
        .filter(Boolean),
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime,
      signupDeadline: deadlineStr,
      place: form.place.trim(),
      duration: form.duration.trim() || msg("以实际安排为准"),
      capacity: form.capacity,
      audienceScope: form.audienceScope,
      audienceId: form.audienceScope === 'school' ? undefined : form.audienceValue,
      requirements: requirementsText.value
        .split('\n')
        .map((i) => i.trim())
        .filter(Boolean),
      proofTypes: form.proofTypes,
      claimMode: form.claimMode,
      contacts: form.contacts,
      workflow: { ...workflowConfig, plannedMinutes: workflowConfig.plannedMinutes === null || String(workflowConfig.plannedMinutes) === '' ? null : Number(workflowConfig.plannedMinutes), submissionDeadline: zonedLocalToInstant(submissionDeadlineLocal.value, auth.timezone) }
    }, copyFrom.value || undefined
  ), (task) => { void router.replace(`/tasks/${task.id}/workflow`) }, msg("任务发布成功"))
}
</script>

<template>
  <div class="create-task-page page-wrap">
    <LoadState :loading="loading" :error="error" @retry="reload" />
    <p v-if="validationError || publishError" class="workflow-error" role="alert">{{ validationError || publishError }}</p>
    <!-- 步骤指示 -->
    <section class="surface-card" style="padding: 14px 16px; margin-bottom: 14px">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
        <strong style="font-size: 15px">
          {{ [msg("基本信息"), msg("时间地点与凭证"), msg("配置联系方式"), msg("发布预览")][step - 1] }}
        </strong>
        <span style="font-size: 14px; color: var(--muted)">{{ msg("第 {p0} / 4 步", { p0: step }) }}</span>
      </div>
      <van-progress :percentage="step * 25" :show-pivot="false" stroke-width="4" color="var(--brand)" />
    </section>

    <!-- 步骤 1：基本内容 -->
    <section v-if="step === 1" class="surface-card" style="overflow: hidden; margin-bottom: 16px">
      <div class="workflow-section">
        <label class="workflow-field"><span>{{ msg('模板与要求') }}</span><select v-model="workflowConfig.templateId"><option v-for="item in evidenceTemplates" :key="item.id" :value="item.id">{{ item.name[locale] }}</option></select></label>
        <ul><li v-for="item in selectedTemplate?.items" :key="item.id">{{ item.label[locale] }} · {{ msg(item.required ? '必填' : '选填') }}</li></ul>
        <label class="workflow-field"><span>{{ msg('任务模式') }}</span><select v-model="workflowConfig.mode"><option value="individual">{{ msg('个人任务') }}</option><option value="group">{{ msg('集体活动') }}</option></select></label>
        <label class="workflow-field"><span>{{ msg('计划时长（分钟）') }}</span><input v-model.number="workflowConfig.plannedMinutes" type="number" min="0" step="1" /></label>
        <label class="workflow-field"><span>{{ msg('材料截止时间') }} ({{ auth.timezone }})</span><input v-model="submissionDeadlineLocal" type="datetime-local" /></label>
        <label v-if="workflowConfig.mode === 'group'"><input v-model="workflowConfig.personalSubmissionRequired" type="checkbox" /> {{ msg('要求个人补充') }}</label>
      </div>
      <van-field
        v-model="form.title"
        :label="msg('任务名称')"
        :placeholder="msg('例如：嵌入式实验室设备清点与登记')"
        maxlength="36"
        show-word-limit
        required
      />

      <div style="padding: 12px 16px; border-bottom: 1px solid var(--line)">
        <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px">{{ msg("任务分类") }}</label>
        <select v-model="form.category" :aria-label="msg('任务分类')"  style="width: 100%; height: 42px; border: 1px solid var(--line); border-radius: 6px; padding: 0 10px; background: #fff">
          <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
        </select>
      </div>

      <div style="padding: 12px 16px; border-bottom: 1px solid var(--line)">
        <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px">{{ msg("所在校区") }}</label>
        <select v-model="form.campus" :aria-label="msg('所在校区')"  style="width: 100%; height: 42px; border: 1px solid var(--line); border-radius: 6px; padding: 0 10px; background: #fff">
          <option v-for="camp in campuses" :key="camp.id" :value="camp.id">{{ camp.name }}</option>
        </select>
      </div>

      <van-field
        v-model="form.place"
        :label="msg('具体地点')"
        :placeholder="msg('例如：实验实训楼 B302 实验室')"
        required
      />

      <van-field
        v-model="form.description"
        :label="msg('任务说明')"
        type="textarea"
        :placeholder="msg('说明该校内任务的背景、具体事项与目标')"
        rows="3"
        autosize
        maxlength="400"
        show-word-limit
        required
      />

      <van-field
        v-model="checklistText"
        :label="msg('工作清单')"
        type="textarea"
        :placeholder="msg('每行一项，例如：\n在实验室签到并领取清单\n核对设备固定资产编号\n整理现场并拍照确认')"
        rows="3"
        autosize
      />
    </section>

    <!-- 步骤 2：时间、人数与凭证 -->
    <section v-else-if="step === 2" class="surface-card" style="overflow: hidden; margin-bottom: 16px">
      <div style="padding: 12px 16px; border-bottom: 1px solid var(--line)">
        <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px">{{ msg("任务日期") }} ({{ auth.timezone }})</label>
        <input v-model="form.date" :aria-label="msg('任务日期')"  type="date" style="width: 100%; height: 42px; border: 1px solid var(--line); border-radius: 6px; padding: 0 10px; background: #fff" />
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--line)">
        <div style="padding: 12px 16px; border-right: 1px solid var(--line)">
          <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px">{{ msg("开始时间") }}</label>
          <input v-model="form.startTime" :aria-label="msg('开始时间')"  type="time" style="width: 100%; height: 42px; border: 1px solid var(--line); border-radius: 6px; padding: 0 10px; background: #fff" />
        </div>
        <div style="padding: 12px 16px">
          <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px">{{ msg("结束时间") }}</label>
          <input v-model="form.endTime" :aria-label="msg('结束时间')"  type="time" style="width: 100%; height: 42px; border: 1px solid var(--line); border-radius: 6px; padding: 0 10px; background: #fff" />
        </div>
      </div>

      <div style="padding: 12px 16px; border-bottom: 1px solid var(--line)">
        <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px">{{ msg("报名截止") }}</label>
        <input v-model="form.signupDeadline" :aria-label="msg('报名截止')"  type="datetime-local" style="width: 100%; height: 42px; border: 1px solid var(--line); border-radius: 6px; padding: 0 10px; background: #fff" />
      </div>

      <van-field v-model="form.duration" :label="msg('预计耗时')" :placeholder="msg('例如：约 2 小时')" />

      <div style="padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line)">
        <span style="font-size: 14px; font-weight: 600">{{ msg("招募名额 (人)") }}</span>
        <van-stepper v-model="form.capacity" min="1" max="10000" integer :aria-label="msg('招募人数')" />
      </div>

      <div style="padding: 12px 16px; border-bottom: 1px solid var(--line)">
        <span style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 8px">{{ msg("面向范围") }}</span>
        <van-radio-group v-model="form.audienceScope" direction="horizontal">
          <van-radio name="department" style="margin-right: 12px">{{ msg("指定学院") }}</van-radio>
          <van-radio name="grade" style="margin-right: 12px">{{ msg("指定年级") }}</van-radio>
          <van-radio name="class" style="margin-right: 12px">{{ msg("指定班级") }}</van-radio>
          <van-radio name="school">{{ msg("全校学生") }}</van-radio>
        </van-radio-group>
      </div>

      <div v-if="form.audienceScope !== 'school'" style="padding: 12px 16px; border-bottom: 1px solid var(--line)">
        <label style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 6px">{{ msg("具体范围") }}</label>
        <select v-model="form.audienceValue" :aria-label="msg('具体范围')"  style="width: 100%; height: 42px; border: 1px solid var(--line); border-radius: 6px; padding: 0 10px; background: #fff">
          <option v-for="item in audienceOptions" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
      </div>

      <div style="padding: 12px 16px; border-bottom: 1px solid var(--line)">
        <span style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 8px">{{ msg("完成验收凭证要求") }}</span>
        <van-checkbox-group v-model="form.proofTypes" direction="horizontal">
          <van-checkbox name="image" style="margin-right: 14px">{{ msg("现场图片") }}</van-checkbox>
          <van-checkbox name="text" style="margin-right: 14px">{{ msg("文字说明") }}</van-checkbox>
          <van-checkbox name="onsite">{{ msg("现场核验") }}</van-checkbox>
        </van-checkbox-group>
      </div>

      <div style="padding: 12px 16px">
        <span style="display: block; font-size: 14px; font-weight: 600; margin-bottom: 8px">{{ msg("接单模式") }}</span>
        <van-radio-group v-model="form.claimMode" direction="horizontal">
          <van-radio name="direct" style="margin-right: 16px">{{ msg("直接接取（先到先得）") }}</van-radio>
          <van-radio name="application">{{ msg("审核申请") }}</van-radio>
        </van-radio-group>
      </div>
    </section>

    <!-- 步骤 3：配置联系方式 (可扩展模型，绝无硬编码兜底) -->
    <section v-else-if="step === 3" class="surface-card" style="padding: 16px; margin-bottom: 16px">
      <div class="section-heading">
        <div>
          <h3>{{ msg("联系方式（接单后可见）") }}</h3>
        </div>
      </div>

      <!-- 已添加列表 -->
      <div v-if="form.contacts.length > 0" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px">
        <div
          v-for="(c, idx) in form.contacts"
          :key="idx"
          style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            background: #f8fafc;
            border: 1px solid var(--line);
            border-radius: 6px;
          "
        >
          <div>
            <strong style="font-size: 14px">{{ c.label }}</strong>
            <span style="margin-left: 8px; font-size: 14px; color: var(--muted)">{{ c.value }}</span>
          </div>
          <button
            class="text-link"
            style="color: var(--danger); font-size: 14px"
            @click="removeContactItem(idx)"
          >{{ msg("删除") }}</button>
        </div>
      </div>
      <div v-else style="padding: 12px 0; color: var(--muted); font-size: 14px">{{ msg("未配置联系方式") }}</div>

      <!-- 添加新联系方式表单 -->
      <div style="padding-top: 14px; border-top: 1px dashed var(--line)">
        <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px">{{ msg("添加联系方式") }}</div>
        <div style="display: flex; gap: 8px; margin-bottom: 8px">
          <select
            v-model="newContactType"
            style="height: 44px; border: 1px solid var(--line); border-radius: 6px; padding: 0 8px; background: #fff; flex: 0 0 110px"
          >
            <option v-for="t in availableContactTypes" :key="t.type" :value="t.type">{{ t.label }}</option>
          </select>
          <input
            v-model="newContactValue"
            type="text"
            style="height: 44px; border: 1px solid var(--line); border-radius: 6px; padding: 0 12px; background: #fff; flex: 1"
            :placeholder="availableContactTypes.find(t => t.type === newContactType)?.placeholder"
          />
        </div>
        <van-button size="small" type="primary" plain block style="height: 40px; border-radius: 6px" @click="addContactItem">{{ msg("+ 添加该联系项") }}</van-button>
      </div>
    </section>

    <!-- 步骤 4：发布预览 -->
    <section v-else class="surface-card" style="padding: 18px; margin-bottom: 16px">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px">
        <span class="card-category-pill">{{ categories.find(item => item.id === form.category)?.name }}</span>
        <span class="unified-status-tag" style="color: var(--recruiting); background: #EBF2FE">{{ msg("招募中") }}</span>
      </div>

      <h2 style="margin: 0 0 8px; font-size: 18px; font-weight: 700">{{ form.title }}</h2>
      <p style="margin: 0 0 14px; color: var(--muted); font-size: 14px">{{ form.description }}</p>

      <div class="card-meta-list">
        <div class="meta-row">
          <van-icon name="clock-o" />
          <span>{{ form.date }} {{ form.startTime }}–{{ form.endTime }} ({{ auth.timezone }})</span>
        </div>
        <div class="meta-row">
          <van-icon name="location-o" />
          <span>{{ campuses.find(item => item.id === form.campus)?.name }} · {{ form.place }}</span>
        </div>
        <div class="meta-row">
          <van-icon name="friends-o" />
          <span>{{ msg("招募人数：{p0} 人", { p0: form.capacity }) }}</span>
        </div>
        <div class="meta-row">
          <van-icon name="manager-o" />
          <span>{{ msg("发布人：{p0} · {p1}", { p0: teacher?.name, p1: teacher?.department }) }}</span>
        </div>
      </div>

      <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 14px; color: var(--muted)">{{ msg("已配置 {p0} 项联系方式 · 凭证要求：{p1}", { p0: form.contacts.length, p1: form.proofTypes.map(p => p === 'image' ? msg("图片") : p === 'text' ? msg("文字") : msg("现场")).join('、') }) }}
      </div>
    </section>

    <!-- 底部步骤切换按钮 -->
    <div style="display: flex; gap: 12px">
      <van-button v-if="step > 1" :disabled="publishing" block style="height: 46px; border-radius: 8px; font-weight: 600" @click="prev">{{ msg("上一步") }}</van-button>
      <van-button v-else block style="height: 46px; border-radius: 8px; font-weight: 600" @click="router.back()">{{ msg("取消") }}</van-button>

      <van-button
        v-if="step < 4"
        type="primary"
        block
        style="height: 46px; border-radius: 8px; font-weight: 600"
        @click="next"
      >{{ msg("下一步") }}</van-button>
      <van-button
        v-else
        type="primary"
        block
        :loading="publishing"
        style="height: 46px; border-radius: 8px; font-weight: 700"
        @click="publish"
      >{{ msg("确认发布任务") }}</van-button>
    </div>
  </div>
</template>
