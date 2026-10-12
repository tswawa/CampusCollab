<script setup lang="ts">
import { msg } from '@/mobile/i18n'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { showConfirmDialog, showToast } from 'vant'
import { useSystemStore } from '@/mobile/stores/system'
import { errorMessage, isCancelled, uploadFile } from '@/mobile/api'
import { useLoad, useMutation } from '@/mobile/api/ui'
import LoadState from '@/mobile/components/LoadState.vue'
import SettingsNavigation from '@/mobile/components/SettingsNavigation.vue'
const system = useSystemStore()
const logoInput = ref<HTMLInputElement | null>(null)
const form = reactive({ ...system.school })
const institutionInitial = computed(() => Array.from(form.name.trim())[0]?.toLocaleUpperCase() ?? '·')
const logoFailed = ref(false)
watch(
  () => form.logo,
  () => {
    logoFailed.value = false
  }
)
const logoFileId = ref<string>()
const logoFile = ref<File>()
const logoError = ref('')
const uploading = ref(false)
const { busy: exportBusy, run: runExport } = useMutation()
const { busy, error: saveError, run } = useMutation()
const { loading, error, reload } = useLoad(signal => system.fetchSchool(signal))
const uploadController = new AbortController()
let previewUrl = ''
onBeforeUnmount(() => {
  uploadController.abort()
  if (previewUrl) URL.revokeObjectURL(previewUrl)
})
async function uploadLogo() {
  if (!logoFile.value || uploading.value || busy.value) return
  uploading.value = true
  logoError.value = ''
  try {
    const result = await uploadFile('logo', logoFile.value, undefined, uploadController.signal)
    logoFileId.value = result.data.id
    form.logo = result.data.url
  } catch (cause) {
    if (!isCancelled(cause)) logoError.value = errorMessage(cause)
  } finally {
    uploading.value = false
  }
}
async function handleLogoChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || uploading.value || busy.value) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
    showToast(msg('Logo 仅支持 JPEG、PNG、WebP，不超过 2MB'))
    return
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  previewUrl = URL.createObjectURL(file)
  form.logo = previewUrl
  logoFile.value = file
  logoFileId.value = undefined
  await uploadLogo()
}
async function refreshVersion() {
  await reload()
  if (!error.value) form.version = system.school.version
}
async function saveSettings() {
  if (busy.value || uploading.value) return
  if (!form.name.trim() || !form.platformName.trim()) {
    showToast(msg('请填写学校和平台名称'))
    return
  }
  if (!/^#[0-9a-f]{6}$/i.test(form.primaryColor)) {
    showToast(msg('品牌色须为六位十六进制颜色'))
    return
  }
  if (logoFile.value && !logoFileId.value) {
    showToast(msg('Logo 尚未上传成功，请先重试'))
    return
  }
  await run(
    () =>
      system.updateSchool({
        ...form,
        name: form.name.trim(),
        platformName: form.platformName.trim(),
        badge: form.badge.trim(),
        announcement: form.announcement.trim(),
        primaryColor: form.primaryColor,
        version: form.version,
        logoFileId: logoFileId.value
      }),
    result => {
      Object.assign(form, result.data)
      logoFileId.value = undefined
      logoFile.value = undefined
    },
    msg('已保存')
  )
}
async function exportData() {
  if (exportBusy.value) return
  try {
    await showConfirmDialog({
      title: msg('导出业务数据？'),
      message: msg('导出文件包含账号和任务资料，请妥善保管。'),
      confirmButtonText: msg('导出')
    })
  } catch {
    return
  }
  await runExport(
    () => system.exportData(),
    result => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `campus-business-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    msg('已导出业务数据')
  )
}
</script>
<template>
  <div class="admin-module-page admin-settings-page">
    <SettingsNavigation />
    <LoadState :loading="loading" :error="error" @retry="reload" />
    <div class="admin-settings-grid">
      <div class="admin-settings-main">
        <section class="admin-table-card admin-settings-card">
          <div class="admin-card-heading">
            <h2>{{ msg('学校品牌') }}</h2>
          </div>
          <div class="admin-logo-row admin-settings-logo-row">
            <div class="admin-logo-preview is-large">
              <img v-if="form.logo && !logoFailed" :src="form.logo" :alt="form.name" @error="logoFailed = true" /><span
                v-else
                class="institution-logo-fallback"
                aria-hidden="true"
                >{{ institutionInitial }}</span
              >
            </div>
            <div>
              <strong>{{ msg('学校 Logo') }}</strong>
              <p>{{ msg('PNG、JPG 或 WebP，最大 2MB') }}</p>
              <van-button
                size="small"
                plain
                type="primary"
                :disabled="busy || uploading"
                :loading="uploading"
                @click="logoInput?.click()"
                >{{ msg('更换 Logo') }}</van-button
              ><input
                ref="logoInput"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                class="admin-file-input"
                @change="handleLogoChange"
              />
              <p v-if="logoError" role="alert">
                {{ logoError }}
                <van-button size="small" :disabled="uploading || busy" @click="uploadLogo">{{
                  msg('重试上传')
                }}</van-button>
              </p>
            </div>
          </div>
          <div class="admin-settings-form">
            <label class="admin-field-label"
              ><span>{{ msg('学校名称') }}</span
              ><input v-model="form.name" :disabled="busy" class="admin-input-control"
            /></label>
            <label class="admin-field-label"
              ><span>{{ msg('平台名称') }}</span
              ><input v-model="form.platformName" :disabled="busy" class="admin-input-control"
            /></label>
            <label class="admin-field-label"
              ><span>{{ msg('学校简称') }}</span
              ><input v-model="form.badge" :disabled="busy" class="admin-input-control" maxlength="8"
            /></label>
            <label class="admin-field-label"
              ><span>{{ msg('品牌主色') }}</span>
              <div class="admin-color-field">
                <input v-model="form.primaryColor" :disabled="busy" type="color" :aria-label="msg('品牌主色')" /><input
                  v-model="form.primaryColor"
                  :disabled="busy"
                  class="admin-input-control"
                  placeholder="#1E60D5"
                  :aria-label="msg('品牌主色')"
                /></div
            ></label>
            <label class="admin-field-label admin-field-full"
              ><span>{{ msg('校方公告') }}</span
              ><textarea
                v-model="form.announcement"
                :disabled="busy"
                rows="3"
                class="admin-input-control"
                maxlength="120"
                :placeholder="msg('留空则不显示公告')"
              />
            </label>
          </div>
        </section>

        <section class="admin-table-card admin-settings-card admin-language-settings">
          <fieldset class="admin-language-fieldset" :disabled="busy">
            <legend>{{ msg('系统语言版本') }}</legend>

            <div class="admin-language-editions">
              <label class="admin-language-edition" :class="{ 'is-selected': form.defaultLocale === 'zh-CN' }">
                <input
                  v-model="form.defaultLocale"
                  type="radio"
                  name="institution-language-edition"
                  value="zh-CN"
                  :aria-label="msg('中文版')"
                />
                <span class="edition-symbol" lang="zh-CN" aria-hidden="true">中</span
                ><span class="edition-copy"
                  ><strong>{{ msg('中文版') }}</strong
                  ><span lang="zh-CN">简体中文</span></span
                ><van-icon v-if="form.defaultLocale === 'zh-CN'" name="checked" aria-hidden="true" />
              </label>
              <label class="admin-language-edition" :class="{ 'is-selected': form.defaultLocale === 'en' }">
                <input
                  v-model="form.defaultLocale"
                  type="radio"
                  name="institution-language-edition"
                  value="en"
                  :aria-label="msg('英文版')"
                />
                <span class="edition-symbol" lang="en" aria-hidden="true">En</span
                ><span class="edition-copy"
                  ><strong>{{ msg('英文版') }}</strong
                  ><span lang="en">English</span></span
                ><van-icon v-if="form.defaultLocale === 'en'" name="checked" aria-hidden="true" />
              </label>
            </div>

            <p v-if="form.defaultLocale !== system.school.defaultLocale" class="admin-unsaved-note" role="status">
              {{ msg('未保存') }}
            </p>
          </fieldset>
        </section>

        <section class="admin-table-card admin-settings-card">
          <div class="admin-card-heading">
            <h2>{{ msg('新账号注册') }}</h2>
          </div>
          <div class="admin-registration-rules">
            <label class="admin-switch-row"
              ><span>{{ msg('开放注册') }}</span
              ><van-switch v-model="form.registrationEnabled" :disabled="busy" :aria-label="msg('开放注册')"
            /></label>
            <label class="admin-switch-row"
              ><span>{{ msg('学生注册需审核') }}</span
              ><van-switch
                v-model="form.studentApprovalRequired"
                :disabled="busy || !form.registrationEnabled"
                :aria-label="msg('学生注册需审核')"
            /></label>
            <label class="admin-switch-row"
              ><span>{{ msg('必须选择学院或部门') }}</span
              ><van-switch v-model="form.requireDepartment" :disabled="busy" :aria-label="msg('必须选择学院或部门')"
            /></label>
            <label class="admin-switch-row"
              ><span>{{ msg('必须选择年级') }}</span
              ><van-switch v-model="form.requireGrade" :disabled="busy" :aria-label="msg('必须选择年级')"
            /></label>
            <label class="admin-switch-row"
              ><span>{{ msg('必须选择班级') }}</span
              ><van-switch v-model="form.requireClass" :disabled="busy" :aria-label="msg('必须选择班级')"
            /></label>
            <label class="admin-switch-row"
              ><span>{{ msg('允许校外参与者') }}</span
              ><van-switch
                v-model="form.allowExternalParticipants"
                :disabled="busy"
                :aria-label="msg('允许校外参与者')"
            /></label>
          </div>
        </section>

        <section id="retention-settings" class="admin-table-card admin-settings-card">
          <div class="admin-card-heading">
            <h2>{{ msg('时间与保存策略') }}</h2>
          </div>
          <div class="admin-settings-form">
            <label class="admin-field-label"
              ><span>{{ msg('机构时区') }}</span
              ><input
                v-model="form.timezone"
                :disabled="busy"
                class="admin-input-control"
                placeholder="Europe/London" /></label
            ><label class="admin-field-label"
              ><span>{{ msg('结项后保存天数') }}</span
              ><input
                v-model.number="form.retentionDays"
                :disabled="busy"
                type="number"
                min="1"
                max="36500"
                class="admin-input-control"
            /></label>
          </div>
        </section>
      </div>
      <aside class="admin-settings-side">
        <section class="admin-table-card admin-maintenance-card">
          <div class="admin-card-heading">
            <h2>{{ msg('数据导出') }}</h2>
          </div>
          <button type="button" class="admin-maintenance-action" :disabled="exportBusy" @click="exportData">
            <van-icon name="down" aria-hidden="true" />
            <div>
              <strong>{{ exportBusy ? msg('正在导出…') : msg('导出业务数据') }}</strong>
            </div>
            <van-icon name="arrow" aria-hidden="true" />
          </button>
        </section>
      </aside>
    </div>
    <p v-if="saveError" class="admin-settings-error" role="alert">
      {{ saveError }}
      <van-button size="small" :disabled="busy || loading" @click="refreshVersion">{{
        msg('刷新并保留草稿')
      }}</van-button>
    </p>
    <footer class="admin-settings-savebar">
      <van-button type="primary" :loading="busy" :disabled="uploading || busy" @click="saveSettings">{{
        msg('保存设置')
      }}</van-button>
    </footer>
  </div>
</template>

<style scoped>
.institution-logo-fallback {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  background: #eaf1f7;
  color: #315c7c;
  font-size: 30px;
  font-weight: 650;
  line-height: 1;
}
</style>
