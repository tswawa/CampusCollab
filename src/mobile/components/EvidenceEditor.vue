<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { msg } from '@/mobile/i18n'
import { errorMessage, isCancelled, uploadFile } from '@/mobile/api'
const props = defineProps<{ taskId: string; disabled?: boolean }>()
const description = defineModel<string>('description', { required: true })
const note = defineModel<string>('note', { required: true })
const files = defineModel<Array<{ id: string; url: string }>>('files', { required: true })
const uploading = ref(false); const uploadError = ref(''); const controller = new AbortController()
const unavailable = computed(() => props.disabled || uploading.value)
onBeforeUnmount(() => controller.abort())
async function select(event: Event) {
  const input = event.target as HTMLInputElement; const selected = Array.from(input.files ?? []); input.value = ''
  if (unavailable.value) return
  uploading.value = true; uploadError.value = ''
  try {
    for (const file of selected) {
      if (files.value.length >= 6) throw new Error(msg('最多上传 6 张凭证图片'))
      const result = await uploadFile('proof', file, props.taskId, controller.signal)
      files.value = [...files.value, result.data]
    }
  } catch (error) { if (!isCancelled(error)) uploadError.value = errorMessage(error) }
  finally { uploading.value = false }
}
defineExpose({ uploading })
</script>
<template>
  <div class="evidence-editor">
    <label class="workflow-field"><span>{{ msg('完成说明') }} *</span><textarea v-model="description" :disabled="disabled" rows="5" minlength="6" maxlength="4000" required /></label>
    <label class="workflow-field"><span>{{ msg('补充备注') }}</span><textarea v-model="note" :disabled="disabled" rows="2" maxlength="1000" /></label>
    <div class="evidence-files">
      <figure v-for="(file, index) in files" :key="file.id"><a :href="file.url" target="_blank" rel="noopener"><img :src="file.url" :alt="msg('凭证图片 {p0}', { p0: index + 1 })" /></a><button type="button" :disabled="unavailable" @click="files = files.filter(f => f.id !== file.id)">{{ msg('移除附件') }}</button></figure>
    </div>
    <label class="workflow-field"><span>{{ msg('选择图片') }}</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple :disabled="unavailable || files.length >= 6" @change="select" /></label>
    <p v-if="uploading" role="status">{{ msg('上传中…') }}</p><p v-if="uploadError" role="alert">{{ uploadError }}</p>
  </div>
</template>
