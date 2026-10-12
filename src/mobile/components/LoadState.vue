<script setup lang="ts">
import { msg } from '@/mobile/i18n'
defineProps<{ loading?: boolean; error?: string }>()
defineEmits<{ retry: [] }>()
</script>
<template>
  <div v-if="loading || error" class="api-load-state surface-card" role="status" aria-live="polite">
    <span v-if="loading">{{ msg('加载中…') }}</span>
    <template v-else
      ><span>{{ error }}</span
      ><van-button size="small" plain type="primary" @click="$emit('retry')">{{ msg('重试') }}</van-button></template
    >
  </div>
</template>
<style scoped>
.api-load-state {
  margin: 12px 0;
  padding: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--muted);
  font-size: 14px;
}
</style>
