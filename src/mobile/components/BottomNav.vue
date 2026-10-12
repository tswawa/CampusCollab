<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed } from 'vue'
import { useAuthStore } from '@/mobile/stores/auth'

const auth = useAuthStore()

const items = computed(() => {
  if (auth.role === 'admin') {
    return [
      { label: msg('管理台'), icon: 'setting-o', to: '/admin/home' },
      { label: msg('个人中心'), icon: 'user-o', to: '/profile' }
    ]
  }
  if (auth.role === 'teacher') {
    return [
      { label: msg('工作台'), icon: 'wap-home-o', to: '/teacher/home' },
      { label: msg('任务管理'), icon: 'orders-o', to: '/teacher/tasks' },
      { label: msg('发布任务'), icon: 'plus', to: '/teacher/create', emphasis: true },
      { label: msg('个人中心'), icon: 'user-o', to: '/profile' }
    ]
  }
  return [
    { label: msg('首页'), icon: 'wap-home-o', to: '/student/home' },
    { label: msg('任务大厅'), icon: 'apps-o', to: '/student/tasks' },
    { label: msg('我的任务'), icon: 'todo-list-o', to: '/student/mine' },
    { label: msg('个人中心'), icon: 'user-o', to: '/profile' }
  ]
})
</script>

<template>
  <van-tabbar route fixed safe-area-inset-bottom class="bottom-tabbar" active-color="var(--brand)">
    <van-tabbar-item
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      :icon="item.icon"
      :class="{ 'tabbar-emphasis': item.emphasis }"
    >
      {{ item.label }}
    </van-tabbar-item>
  </van-tabbar>
</template>
