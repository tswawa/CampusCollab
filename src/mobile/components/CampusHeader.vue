<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useTaskStore } from '@/mobile/stores/tasks'
import { useSystemStore } from '@/mobile/stores/system'

const router = useRouter()
const auth = useAuthStore()
const taskStore = useTaskStore()
const system = useSystemStore()

const showAnnouncement = ref(true)
const unread = computed(() => (auth.currentUser ? taskStore.unreadCount : 0))
const user = computed(() => auth.currentUser)
</script>

<template>
  <header class="school-brand-header">
    <div class="school-brand-row">
      <div class="school-brand-left">
        <div
          class="school-emblem"
          :aria-label="msg('校标')"
          style="overflow: hidden; background: #fff; border: 1px solid var(--line)"
        >
          <img
            :src="system.school.logo"
            :alt="system.school.name"
            style="width: 100%; height: 100%; object-fit: contain; border-radius: 6px"
          />
        </div>
        <div class="school-meta">
          <h1>{{ system.school.name }}</h1>
          <p>{{ system.school.platformName }}</p>
        </div>
      </div>
      <div class="school-brand-right">
        <button class="notice-icon-btn" :aria-label="msg('消息通知')" @click="router.push('/notifications')">
          <van-badge :content="unread || undefined" :max="9">
            <van-icon name="bell" size="22" />
          </van-badge>
        </button>
      </div>
    </div>

    <div v-if="showAnnouncement && system.school.announcement" class="campus-announcement">
      <van-icon name="volume-o" size="16" />
      <p>{{ system.school.announcement }}</p>
      <button class="campus-announcement-close" :aria-label="msg('关闭公告')" @click="showAnnouncement = false">
        ×
      </button>
    </div>

    <div
      v-if="user"
      class="campus-user-banner"
      style="margin-top: 12px; border-radius: 8px; border: 1px solid var(--line); padding: 10px 12px"
    >
      <div class="user-banner-info">
        <strong>
          {{ user.name }}{{ user.role === 'teacher' ? msg(' 老师') : user.role === 'student' ? msg(' 同学') : '' }}
        </strong>
        <span>
          {{ user.department }} ·
          {{
            user.role === 'student'
              ? user.className
              : user.role === 'teacher'
                ? msg('工号 {p0}', { p0: user.account })
                : msg('账号 {p0}', { p0: user.account })
          }}
        </span>
      </div>
      <span class="user-role-badge">
        {{ user.role === 'student' ? msg('在籍学生') : user.role === 'teacher' ? msg('教师身份') : msg('管理员') }}
      </span>
    </div>
  </header>
</template>
