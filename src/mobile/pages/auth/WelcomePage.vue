<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSystemStore } from '@/mobile/stores/system'

const router = useRouter()
const system = useSystemStore()
const institutionInitial = computed(() => Array.from(system.school.name.trim())[0]?.toLocaleUpperCase() ?? '·')
const logoFailed = ref(false)
watch(() => system.school.logo, () => { logoFailed.value = false })
</script>

<template>
  <div
    class="auth-shell welcome-page"
    style="
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 100dvh;
      padding: calc(64px + env(safe-area-inset-top)) 24px calc(36px + env(safe-area-inset-bottom));
      background: #ffffff;
    "
  >
    <!-- 顶部留白与品牌核心 -->
    <div style="margin-top: 48px; text-align: center">
      <div
        style="
          width: 80px;
          height: 80px;
          margin: 0 auto 20px;
          border-radius: 16px;
          overflow: hidden;
          background: #ffffff;
          border: 1px solid var(--line);
          box-shadow: var(--shadow-card);
          display: grid;
          place-items: center;
        "
      >
        <img
          v-if="system.school.logo && !logoFailed"
          :src="system.school.logo"
          :alt="system.school.name"
          @error="logoFailed = true"
          style="width: 100%; height: 100%; object-fit: contain"
        />
        <span v-else class="institution-logo-fallback" aria-hidden="true">{{ institutionInitial }}</span>
      </div>

      <h1 style="margin: 0 0 8px; font-size: 26px; font-weight: 800; color: var(--text); letter-spacing: -0.4px">
        {{ system.school.name }}
      </h1>
    </div>

    <!-- 底部双主操作入口 -->
    <div>
      <div style="display: flex; flex-direction: column; gap: 12px">
        <van-button
          type="primary"
          block
          style="height: 48px; border-radius: 8px; font-size: 15px; font-weight: 700"
          @click="router.push('/login')"
        >{{ msg("校园账号登录") }}</van-button>
        <van-button
          block
          style="height: 48px; border-radius: 8px; font-size: 15px; font-weight: 600"
          @click="router.push('/register')"
        >{{ msg("注册账号") }}</van-button>
      </div>

      <div style="margin-top: 24px; text-align: center; font-size: 14px; color: var(--muted)">
        {{ system.school.platformName }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.institution-logo-fallback { display: grid; place-items: center; width: 100%; height: 100%; background: #eaf1f7; color: #315c7c; font-size: 38px; font-weight: 650; line-height: 1; }
</style>
