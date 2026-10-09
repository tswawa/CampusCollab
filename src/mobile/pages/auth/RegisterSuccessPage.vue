<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/mobile/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const isTeacher = computed(() => route.query.role === 'teacher')
const pendingApproval = computed(() => isTeacher.value || route.query.pending === '1')
const confirmed = computed(() => auth.registrationRole === (isTeacher.value ? 'teacher' : 'student'))
</script>

<template>
  <div class="auth-shell" style="justify-content: center; padding: 20px">
    <section class="surface-card" style="padding: 36px 20px; text-align: center">
      <div
        style="
          width: 64px;
          height: 64px;
          margin: 0 auto 16px;
          border-radius: 50%;
          background: #ECFDF5;
          color: #059669;
          display: grid;
          place-items: center;
        "
      >
        <van-icon name="passed" size="32" />
      </div>

      <h1 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: var(--text)">
        {{ confirmed ? (pendingApproval ? msg("登记申请已提交") : msg("学生账号登记成功")) : msg("请确认注册结果") }}
      </h1>

      <p v-if="!confirmed || pendingApproval" style="margin: 0 0 24px; font-size: 14px; color: var(--muted); line-height: 1.6">
        {{
          !confirmed ? msg("注册结果未确认，请尝试登录。")
            : msg("请等待管理员审核，审核通过后可登录。")
        }}
      </p>

      <van-button
        type="primary"
        block
        style="height: 46px; margin-top: 16px; border-radius: 8px; font-weight: 600"
        @click="router.replace('/login')"
      >{{ msg("前往登录") }}</van-button>
    </section>
  </div>
</template>
