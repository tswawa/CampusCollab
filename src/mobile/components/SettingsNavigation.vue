<script setup lang="ts">
import { useRoute } from 'vue-router'
import { msg } from '@/mobile/i18n'
const route = useRoute()
</script>
<template>
  <nav class="settings-navigation" :aria-label="msg('系统设置')">
    <RouterLink
      v-for="item in [
        { path: '/admin/settings', title: '基本设置' as const },
        { path: '/admin/settings/notifications', title: '通知设置' as const },
        { path: '/admin/settings/data', title: '数据管理' as const }
      ]"
      :key="item.path"
      :to="item.path"
      :aria-current="route.path === item.path ? 'page' : undefined"
      :class="{ selected: route.path === item.path }"
      >{{ msg(item.title) }}</RouterLink
    >
  </nav>
</template>
<style scoped>
.settings-navigation {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 24px;
  border-bottom: 1px solid #dce4ed;
}
.settings-navigation a {
  padding: 12px 18px;
  color: #52667b;
  text-decoration: none;
  font-size: 15px;
  border-bottom: 2px solid transparent;
}
.settings-navigation a.selected {
  color: #173f69;
  border-bottom-color: #173f69;
  font-weight: 650;
}
.settings-navigation a:focus-visible {
  outline: 2px solid #438bbd;
  outline-offset: 2px;
}
@media (max-width: 560px) {
  .settings-navigation {
    gap: 0;
    margin-bottom: 18px;
  }
  .settings-navigation a {
    flex: 1;
    padding: 12px 8px;
    text-align: center;
    font-size: 14px;
  }
}
</style>
