<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed } from 'vue'
import type { MemberStatus, TaskStatus, UnifiedTaskStatus } from '@/mobile/types'
import { unifiedStatusMeta } from '@/mobile/utils/task'

const props = defineProps<{
  status: TaskStatus | MemberStatus
}>()

const meta = computed(() => {
  if (props.status === 'applied') {
    return { label: msg('待确认'), color: '#7C3AED', bgColor: '#EDE9FE' }
  }
  const key = props.status as UnifiedTaskStatus
  return (
    unifiedStatusMeta[key] || {
      label: props.status,
      color: '#64748B',
      bgColor: '#F1F5F9'
    }
  )
})
</script>

<template>
  <span class="unified-status-tag" :style="{ color: meta.color, backgroundColor: meta.bgColor }">
    <span class="status-indicator-dot" :style="{ backgroundColor: meta.color }" />
    {{ meta.label }}
  </span>
</template>
