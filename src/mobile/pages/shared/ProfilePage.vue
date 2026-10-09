<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, ref } from 'vue'
import { errorMessage, isCancelled } from '@/mobile/api'
import { showConfirmDialog, showToast } from 'vant'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'
import { useTaskStore } from '@/mobile/stores/tasks'
import { useSystemStore } from '@/mobile/stores/system'

const router = useRouter()
const auth = useAuthStore()
const taskStore = useTaskStore()
const system = useSystemStore()
const user = computed(() => auth.currentUser)
const busy = ref(false)

async function logout() {
  try {
    await showConfirmDialog({
      title: msg("确认退出登录？"),
      message: msg("退出后需要重新输入学号或工号登录。"),
      confirmButtonText: msg("退出登录"),
      confirmButtonColor: '#E11D48'
    })
  } catch {
    return
  }
  if (busy.value) return
  busy.value = true
  try { await auth.logout(); await router.replace('/login') }
  catch (error) { if (!isCancelled(error)) showToast(errorMessage(error)) }
  finally { busy.value = false }
}
</script>

<template>
  <div v-if="user" class="profile-page page-wrap">
    <!-- 用户个人头部卡片 -->
    <section class="surface-card" style="padding: 20px 16px; margin-bottom: 16px; background: #ffffff">
      <div style="display: flex; align-items: center; gap: 14px">
        <div
          style="
            width: 52px;
            height: 52px;
            border-radius: 12px;
            background: var(--brand);
            color: #ffffff;
            font-size: 20px;
            font-weight: 700;
            display: grid;
            place-items: center;
          "
        >
          {{ user.name.slice(0, 1) }}
        </div>
        <div style="flex: 1">
          <div style="display: flex; align-items: center; gap: 8px">
            <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: var(--text)">
              {{ user.name }}
            </h2>
            <span class="user-role-badge">
              {{ user.role === 'student' ? msg("在籍学生") : user.role === 'teacher' ? msg("教师身份") : msg("管理员") }}
            </span>
          </div>
          <p style="margin: 4px 0 0; font-size: 14px; color: var(--muted)">
            {{ user.role === 'student' ? msg("学号：{p0}", { p0: user.account }) : user.role === 'teacher' ? msg("工号：{p0}", { p0: user.account }) : msg("管理员账号：{p0}", { p0: user.account }) }} · {{ system.school.name }}
          </p>
        </div>
      </div>
    </section>

    <!-- 身份学籍/岗位资料 -->
    <div style="font-size: 14px; font-weight: 700; color: #475569; margin: 0 4px 8px">{{ msg("校园身份资料") }}</div>
    <div class="surface-card" style="overflow: hidden; margin-bottom: 16px">
      <van-cell :title="msg('姓名')" :value="user.name" />
      <van-cell :title="msg('账号用户 ID')" :value="user.id" />
      <van-cell :title="user.role === 'student' ? msg('学号') : user.role === 'teacher' ? msg('教工号') : msg('管理员账号')" :value="user.account" />
      <van-cell :title="msg('所属院系')" :value="user.department" />
      <van-cell v-if="user.className" :title="msg('行政班级')" :value="user.className" />
      <van-cell v-if="user.grade" :title="msg('入学年级')" :value="user.grade" />
      <van-cell :title="msg('账号状态')" :value="msg('已启用')" value-class="text-brand" />
    </div>

    <!-- 系统与安全设置 -->
    <div style="font-size: 14px; font-weight: 700; color: #475569; margin: 0 4px 8px">{{ msg("平台选项") }}</div>
    <div class="surface-card" style="overflow: hidden; margin-bottom: 24px">
      <van-cell :title="msg('消息通知')" is-link to="/notifications" />

    </div>

    <!-- 退出登录 -->
    <van-button
      block
      plain
      type="danger"
      style="height: 48px; border-radius: 8px; font-size: 15px; font-weight: 600"
      :loading="busy"
      :disabled="busy"
      @click="logout"
    >{{ msg("退出登录") }}</van-button>
  </div>
</template>
