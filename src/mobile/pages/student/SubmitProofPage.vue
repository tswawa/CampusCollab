<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, onBeforeUnmount, ref } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useTaskStore } from '@/mobile/stores/tasks'
import { memberOf } from '@/mobile/utils/task'
import { errorMessage, isCancelled, request, uploadFile } from '@/mobile/api'
import { useLoad, useMutation } from '@/mobile/api/ui'
import { useEvidencePreview } from '@/mobile/composables/useEvidencePreview'
import LoadState from '@/mobile/components/LoadState.vue'
import type { TaskWorkflow, WorkflowParticipant } from '../../../../shared/workflow-contracts'

const route = useRoute()
const viewProofImages = useEvidencePreview()
const router = useRouter()
const auth = useAuthStore()
const taskStore = useTaskStore()
const task = computed(() => taskStore.taskById(String(route.params.id)))
const member = computed(() => (task.value ? memberOf(task.value, auth.currentUserId) : undefined))
const description = ref('')
const note = ref('')
const initialText = ref({ description: '', note: '' })
const version = ref(0)
const workflowParticipant = ref<WorkflowParticipant>()
const reportedMinutes = ref<number | ''>('')
let initialized = ''
interface ImageDraft {
  id: string
  url: string
  file?: File
  localUrl?: string
  uploading: boolean
  error: string
}
const images = ref<ImageDraft[]>([])
const uploadController = new AbortController()
const { busy: submitting, error: submitError, run } = useMutation()
const uploading = computed(() => images.value.some(image => image.uploading))
const canSubmit = computed(
  () =>
    task.value?.status !== 'cancelled' &&
    member.value &&
    ['in_progress', 'changes_requested'].includes(member.value.status)
)
const { loading, error, ready, reload } = useLoad(
  async signal => {
    const id = String(route.params.id)
    await taskStore.fetchTask(id, signal)
    const flow = (await request<TaskWorkflow>(`/tasks/${encodeURIComponent(id)}/workflow`, { signal })).data
    workflowParticipant.value = flow.participants.find(p => p.userId === auth.currentUserId)
    if (initialized !== id) {
      initialized = id
      version.value = workflowParticipant.value?.version ?? member.value?.version ?? 0
      reportedMinutes.value = workflowParticipant.value?.reportedMinutes ?? ''
      const revision = workflowParticipant.value?.revisions.find(
        item => item.id === workflowParticipant.value?.latestRevisionId
      )
      const proof = revision ?? member.value?.proof
      description.value = proof?.description ?? ''
      note.value = proof?.note ?? ''
      initialText.value = { description: description.value, note: note.value }
      images.value = (proof?.fileIds ?? []).map((fileId, index) => ({
        id: fileId,
        url: proof?.images[index] ?? '',
        uploading: false,
        error: ''
      }))
    }
  },
  [() => route.params.id]
)
async function refreshVersion() {
  await reload()
  if (!error.value) version.value = workflowParticipant.value?.version ?? member.value?.version ?? 0
}
const cameraInput = ref<HTMLInputElement | null>(null)
const albumInput = ref<HTMLInputElement | null>(null)
const showUploadSheet = ref(false)
const uploadActions = computed(() => [{ name: msg('拍摄现场照片') }, { name: msg('从手机相册选取') }])
function onSelectUploadAction(action: { name: string }) {
  showUploadSheet.value = false
  if (submitting.value || uploading.value) return
  if (action.name === msg('拍摄现场照片')) cameraInput.value?.click()
  else albumInput.value?.click()
}
async function upload(image: ImageDraft) {
  if (!image.file || image.uploading || submitting.value) return
  image.uploading = true
  image.error = ''
  try {
    const result = await uploadFile('proof', image.file, String(route.params.id), uploadController.signal)
    image.id = result.data.id
    image.url = result.data.url
  } catch (cause) {
    if (!isCancelled(cause)) image.error = errorMessage(cause)
  } finally {
    image.uploading = false
  }
}
async function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (uploading.value || submitting.value) return
  for (const file of files) {
    if (images.value.length >= 6) {
      showToast(msg('最多上传 6 张凭证图片'))
      break
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      showToast(msg('仅支持 JPEG、PNG、WebP，每张不超过 10MB'))
      continue
    }
    const localUrl = URL.createObjectURL(file)
    images.value.push({ id: '', url: localUrl, localUrl, file, uploading: false, error: '' })
    await upload(images.value[images.value.length - 1]!)
    if (uploadController.signal.aborted) break
  }
}
function previewImage(index: number) {
  viewProofImages(
    images.value.map(image => image.url),
    index
  )
}
async function removeImage(index: number) {
  if (submitting.value || uploading.value) return
  const image = images.value[index]
  if (!image) return
  if (image.file && image.id) {
    try {
      await request<null>(`/files/${encodeURIComponent(image.id)}`, { method: 'DELETE', body: {} })
    } catch (cause) {
      if (!isCancelled(cause)) showToast(errorMessage(cause))
      return
    }
  }
  images.value.splice(index, 1)
  if (image.localUrl) URL.revokeObjectURL(image.localUrl)
}
onBeforeUnmount(() => {
  uploadController.abort()
  images.value.forEach(image => {
    if (image.localUrl) URL.revokeObjectURL(image.localUrl)
  })
})
async function goBack() {
  if (
    description.value !== initialText.value.description ||
    note.value !== initialText.value.note ||
    images.value.some(image => image.file)
  ) {
    try {
      await showConfirmDialog({
        message: msg('离开后，本页填写的内容不会保存。确定离开吗？'),
        confirmButtonText: msg('离开'),
        cancelButtonText: msg('继续填写')
      })
    } catch {
      return
    }
  }
  router.back()
}
async function submit() {
  if (submitting.value || uploading.value || !task.value || !member.value || !canSubmit.value) return
  if (description.value.trim().length < 6) {
    showToast(msg('完成说明至少填写 6 个字'))
    return
  }
  if (images.value.some(image => !image.id)) {
    showToast(msg('请重试上传失败的图片，或移除后再提交'))
    return
  }
  if (task.value.proofTypes.includes('image') && !images.value.length) {
    showToast(msg('该任务要求现场图片凭证'))
    return
  }
  const id = task.value.id
  if (reportedMinutes.value !== '' && (!Number.isInteger(reportedMinutes.value) || reportedMinutes.value < 0)) {
    showToast(msg('分钟数必须为非负整数'))
    return
  }
  await run(
    () =>
      request<TaskWorkflow>(`/tasks/${encodeURIComponent(id)}/workflow/submit`, {
        method: 'POST',
        body: {
          participantId: workflowParticipant.value?.id,
          description: description.value.trim(),
          note: note.value.trim(),
          fileIds: images.value.map(image => image.id),
          version: version.value,
          reportedMinutes: reportedMinutes.value === '' ? null : reportedMinutes.value
        }
      }),
    () => {
      void router.replace(`/tasks/${id}`)
    },
    msg('已提交，等待老师验收')
  )
}
</script>

<template>
  <div>
    <LoadState :loading="loading" :error="error" @retry="reload" />
    <div v-if="ready && !error && task && member" class="proof-form-container">
      <van-notice-bar
        v-if="member.status === 'changes_requested'"
        left-icon="warning-o"
        color="#E11D48"
        background="#FFF1F2"
        wrapable
        :scrollable="false"
        :text="msg('退回意见：{p0}', { p0: member.feedback || msg('请完善说明并补充清晰照片。') })"
        style="margin-bottom: 12px; border-radius: 8px"
      />
      <section class="proof-header-card">
        <h2>{{ task.title }}</h2>
        <p>{{ msg('指导老师：{p0} · {p1}', { p0: task.teacherName, p1: task.place }) }}</p>
      </section>
      <section class="proof-field-card">
        <label class="workflow-field" style="padding: 0 16px"
          ><span>{{ msg('自报分钟数') }}</span
          ><input v-model.number="reportedMinutes" type="number" min="0" step="1" :disabled="submitting"
        /></label>
        <van-field
          v-model="description"
          :disabled="submitting"
          type="textarea"
          :label="msg('完成说明')"
          :placeholder="msg('请简要说明工作内容和结果')"
          rows="4"
          autosize
          maxlength="4000"
          show-word-limit
          required
        />
        <van-field
          v-model="note"
          :disabled="submitting"
          type="textarea"
          :label="msg('补充备注')"
          :placeholder="msg('交接细节或异常情况（选填）')"
          rows="2"
          autosize
          maxlength="1000"
        />
      </section>
      <section class="proof-upload-section">
        <div class="upload-section-title">
          <strong>{{ msg('现场照片凭证') }}</strong
          ><span>{{ msg('{p0}/6 张', { p0: images.length }) }}</span>
        </div>
        <div class="proof-images-grid">
          <div v-for="(image, index) in images" :key="image.localUrl || image.id" class="proof-img-thumb">
            <img :src="image.url" :alt="msg('凭证图片 {p0}', { p0: index + 1 })" @click="previewImage(index)" />
            <button
              class="thumb-delete-btn"
              :disabled="submitting || uploading"
              :aria-label="msg('删除图片')"
              @click.stop="removeImage(index)"
            >
              ×
            </button>
          </div>
          <button
            v-if="images.length < 6"
            type="button"
            class="proof-upload-add"
            :disabled="submitting || uploading || !canSubmit"
            @click="showUploadSheet = true"
          >
            <van-icon name="photograph" /><span>{{ uploading ? msg('上传中…') : msg('上传照片') }}</span>
          </button>
        </div>
        <div v-for="(image, index) in images" :key="index">
          <p v-if="image.uploading">{{ msg('第 {p0} 张正在上传…', { p0: index + 1 }) }}</p>
          <p v-if="image.error" role="alert">
            {{ msg('第 {p0} 张：{p1}', { p0: index + 1, p1: image.error })
            }}<van-button size="small" :disabled="submitting || uploading" @click="upload(image)">{{
              msg('重试上传')
            }}</van-button>
          </p>
        </div>
        <input
          ref="cameraInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          style="display: none"
          @change="handleFileSelect"
        />
        <input
          ref="albumInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          style="display: none"
          @change="handleFileSelect"
        />
        <van-action-sheet
          v-model:show="showUploadSheet"
          :actions="uploadActions"
          :cancel-text="msg('取消')"
          close-on-click-action
          @select="onSelectUploadAction"
        />
      </section>
      <p v-if="submitError" role="alert">
        {{ submitError }}
        <van-button size="small" :disabled="submitting || loading" @click="refreshVersion">{{
          msg('刷新并保留草稿')
        }}</van-button>
      </p>
      <p v-if="!canSubmit">{{ msg('当前无法提交，请查看任务进度。') }}</p>
      <div style="display: flex; gap: 12px">
        <van-button
          block
          :disabled="submitting || uploading"
          style="height: 48px; border-radius: 8px; font-weight: 600"
          @click="goBack"
          >{{ msg('返回') }}</van-button
        >
        <van-button
          type="primary"
          block
          :loading="submitting"
          :disabled="submitting || uploading || !canSubmit"
          style="height: 48px; border-radius: 8px; font-weight: 700"
          @click="submit"
          >{{ msg('提交完成凭证') }}</van-button
        >
      </div>
    </div>
    <div v-else-if="ready && !error" class="campus-empty surface-card" style="margin: 20px 16px">
      <van-icon name="warning-o" />
      <h4>{{ msg('任务不可提交') }}</h4>
      <p>{{ msg('任务不存在，或当前账号未加入该任务。') }}</p>
    </div>
  </div>
</template>
