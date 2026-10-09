<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, watch } from 'vue'
const props = defineProps<{ page: number; pageSize: number; total: number; loading?: boolean }>()
const emit = defineEmits<{ 'update:page': [value: number] }>()
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
watch([() => props.page, pages, () => props.loading], () => {
  if (!props.loading && props.page > pages.value) emit('update:page', pages.value)
}, { immediate: true })
</script>
<template>
  <nav class="pagination-bar" :aria-label="msg('列表分页')">
    <van-button size="small" :disabled="loading || page <= 1" @click="emit('update:page', page - 1)">{{ msg("上一页") }}</van-button>
    <span>{{ msg("第 {p0} / {p1} 页 · 共 {p2} 项", { p0: page, p1: pages, p2: total }) }}</span>
    <van-button size="small" :disabled="loading || page >= pages" @click="emit('update:page', page + 1)">{{ msg("下一页") }}</van-button>
  </nav>
</template>
<style scoped>
.pagination-bar { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 12px; padding: 16px 0; font-size: 14px; color: var(--muted); }
</style>
