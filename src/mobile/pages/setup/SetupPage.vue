<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { errorMessage, request } from '@/mobile/api'
import { bootstrap } from '@/mobile/api/bootstrap'
import { locale, setLocale, type Locale } from '@/mobile/i18n'
import { useAuthStore } from '@/mobile/stores/auth'
import { useSystemStore } from '@/mobile/stores/system'
import type { InstallationResult } from '@/mobile/types'
import { setupCopy } from './setup-copy'
import { productNames } from '../../../../shared/brand'

const router = useRouter()
const system = useSystemStore()
const auth = useAuthStore()
const edition = ref<Locale>(locale.value)
const copy = computed(() => setupCopy[edition.value])
const step = ref(0)
const heading = ref<HTMLElement>()
const errorBox = ref<HTMLElement>()
const name = ref('')
const platformName = ref<string>(productNames[edition.value])
const timezone = ref('Asia/Shanghai')
const adminName = ref('')
const account = ref('')
const password = ref('')
const confirmPassword = ref('')
const setupToken = ref('')
const busy = ref(false)
const error = ref('')
const installed = ref(false)
const blocked = computed(() => system.installation?.status === 'blocked')
const unavailable = computed(() => !system.installation?.setupAvailable && !installed.value)
const zones = [
  'Asia/Shanghai',
  'Asia/Taipei',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC'
]
// Focus-driven session refresh must not reset the not-yet-saved edition choice.
watch([edition, locale, () => system.installation?.status], () => {
  if (system.installation?.status === 'required' && locale.value !== edition.value) setLocale(edition.value)
})

function chooseEdition(value: Locale) {
  if (!platformName.value.trim() || platformName.value === productNames[edition.value])
    platformName.value = productNames[value]
  edition.value = value
  setLocale(value)
}
async function showError(value: string) {
  error.value = value
  await nextTick()
  errorBox.value?.focus()
}
async function moveTo(value: number) {
  error.value = ''
  step.value = value
  await nextTick()
  heading.value?.focus()
}
async function advance() {
  if (busy.value) return
  if (step.value === 1) {
    try {
      if (/^[+-]/.test(timezone.value.trim())) throw new Error('offset')
      new Intl.DateTimeFormat('en', { timeZone: timezone.value.trim() }).format()
    } catch {
      await showError(copy.value.invalidZone)
      return
    }
  }
  if (step.value < 2) {
    await moveTo(step.value + 1)
    return
  }
  if (installed.value) {
    await enterConsole()
    return
  }
  if (password.value !== confirmPassword.value) {
    await showError(copy.value.mismatch)
    return
  }
  const groups = [/[a-zA-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(rule => rule.test(password.value)).length
  if (password.value.length < 8 || password.value.length > 128 || groups < 2) {
    await showError(copy.value.invalidPassword)
    return
  }
  busy.value = true
  error.value = ''
  setLocale(edition.value)
  try {
    const result = await request<InstallationResult>('/installation', {
      method: 'POST',
      body: {
        locale: edition.value,
        name: name.value.trim(),
        platformName: platformName.value.trim(),
        timezone: timezone.value.trim(),
        setupToken: setupToken.value,
        admin: { account: account.value.trim(), name: adminName.value.trim(), password: password.value }
      }
    })
    installed.value = true
    password.value = ''
    confirmPassword.value = ''
    setupToken.value = ''
    system.installation = result.data.installation
    auth.acceptSession(result.data.session)
    await enterConsole()
  } catch (cause) {
    await showError(errorMessage(cause))
  } finally {
    busy.value = false
  }
}
async function enterConsole() {
  if (await bootstrap(true)) await router.replace('/admin/home')
  else await showError(copy.value.saved)
}
async function retry() {
  busy.value = true
  try {
    await system.fetchInstallation()
    if (system.installation?.status === 'configured') await router.replace('/login')
  } catch (cause) {
    await showError(errorMessage(cause))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main id="main-content" class="setup-page" tabindex="-1">
    <header class="setup-brand">
      <span class="setup-mark" aria-hidden="true">C</span><span>{{ copy.brand }}</span>
    </header>
    <div class="setup-grid">
      <aside class="setup-intro">
        <h1>{{ copy.title }}</h1>
      </aside>
      <section class="setup-card" aria-labelledby="setup-heading">
        <ol class="setup-progress" :aria-label="copy.brand">
          <li
            v-for="(label, index) in copy.steps"
            :key="index"
            :class="{ current: index === step, complete: index < step }"
            :aria-current="index === step ? 'step' : undefined"
          >
            <span>{{ index + 1 }}</span
            >{{ label }}
          </li>
        </ol>
        <p v-if="error" ref="errorBox" role="alert" tabindex="-1" class="setup-error">{{ error }}</p>
        <template v-if="blocked || unavailable">
          <h2 id="setup-heading" ref="heading" tabindex="-1">{{ blocked ? copy.blocked : copy.unavailable }}</h2>
          <p class="setup-hint">{{ blocked ? copy.blockedHint : copy.unavailableHint }}</p>
          <div class="setup-actions">
            <RouterLink v-if="blocked" to="/login">{{ copy.login }}</RouterLink
            ><button type="button" class="setup-primary" :disabled="busy" @click="retry">{{ copy.retry }}</button>
          </div>
        </template>
        <form v-else @submit.prevent="advance">
          <h2 id="setup-heading" ref="heading" tabindex="-1">
            {{ step === 0 ? copy.editionTitle : step === 1 ? copy.institutionTitle : copy.adminTitle }}
          </h2>

          <fieldset v-if="step === 0" class="setup-editions" :disabled="busy">
            <legend class="sr-only">{{ copy.editionTitle }}</legend>
            <label :class="{ selected: edition === 'zh-CN' }"
              ><input
                type="radio"
                name="edition"
                value="zh-CN"
                :checked="edition === 'zh-CN'"
                @change="chooseEdition('zh-CN')"
              /><span class="edition-glyph" aria-hidden="true">中</span><strong>{{ copy.chinese }}</strong></label
            >
            <label :class="{ selected: edition === 'en' }"
              ><input
                type="radio"
                name="edition"
                value="en"
                :checked="edition === 'en'"
                @change="chooseEdition('en')"
              /><span class="edition-glyph" aria-hidden="true">En</span><strong>{{ copy.english }}</strong></label
            >
          </fieldset>
          <div v-else-if="step === 1" class="setup-fields">
            <label for="setup-school"
              >{{ copy.school
              }}<input
                id="setup-school"
                v-model="name"
                required
                maxlength="64"
                :placeholder="copy.schoolPlaceholder"
                autocomplete="organization"
            /></label>
            <label for="setup-platform"
              >{{ copy.platform
              }}<input
                id="setup-platform"
                v-model="platformName"
                required
                maxlength="64"
                :placeholder="copy.platformPlaceholder"
            /></label>
            <label for="setup-timezone"
              >{{ copy.timezone
              }}<input id="setup-timezone" v-model="timezone" required maxlength="100" list="setup-zones"
            /></label>
            <datalist id="setup-zones"><option v-for="zone in zones" :key="zone" :value="zone" /></datalist>
          </div>
          <div v-else-if="!installed" class="setup-fields">
            <div class="setup-review">
              <strong>{{ name }}</strong
              ><span>{{ edition === 'en' ? 'English' : '简体中文' }} · {{ timezone }}</span>
            </div>
            <div class="setup-field-pair">
              <label for="setup-admin-name"
                >{{ copy.name
                }}<input
                  id="setup-admin-name"
                  v-model="adminName"
                  required
                  maxlength="100"
                  autocomplete="name" /></label
              ><label for="setup-account"
                >{{ copy.account
                }}<input
                  id="setup-account"
                  v-model="account"
                  required
                  minlength="4"
                  maxlength="254"
                  autocomplete="username"
                  :title="copy.accountHint"
              /></label>
            </div>
            <div class="setup-field-pair">
              <label for="setup-password"
                >{{ copy.password
                }}<input
                  id="setup-password"
                  v-model="password"
                  type="password"
                  required
                  minlength="8"
                  maxlength="128"
                  autocomplete="new-password"
                  aria-describedby="setup-password-hint" /></label
              ><label for="setup-confirm"
                >{{ copy.confirmPassword
                }}<input
                  id="setup-confirm"
                  v-model="confirmPassword"
                  type="password"
                  required
                  minlength="8"
                  maxlength="128"
                  autocomplete="new-password"
              /></label>
            </div>
            <small id="setup-password-hint" class="setup-password-hint">{{ copy.passwordHint }}</small>
            <label for="setup-token"
              >{{ copy.token
              }}<input
                id="setup-token"
                v-model="setupToken"
                type="password"
                required
                maxlength="256"
                autocomplete="off"
                spellcheck="false"
                aria-describedby="setup-token-hint"
              /><small id="setup-token-hint">{{ copy.tokenHint }}</small></label
            >
          </div>
          <p v-else class="setup-hint" role="status">{{ copy.saved }}</p>
          <div class="setup-actions">
            <button
              v-if="step > 0 && !installed"
              type="button"
              class="setup-secondary"
              :disabled="busy"
              @click="moveTo(step - 1)"
            >
              {{ copy.back }}</button
            ><span v-else /><button type="submit" class="setup-primary" :disabled="busy">
              {{ busy ? copy.submitting : installed ? copy.retry : step === 2 ? copy.submit : copy.next
              }}<span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  </main>
</template>

<style scoped>
.setup-page {
  max-width: 1140px;
  margin: 0 auto;
  padding: 32px 40px 60px;
  color: #182b43;
}
.setup-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  font-weight: 650;
}
.setup-mark {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  background: #173f69;
  color: white;
  border-radius: 10px;
  font:
    700 22px Georgia,
    serif;
}
.setup-badge {
  margin-left: auto;
  font-size: 14px;
  letter-spacing: 1.6px;
  color: #728294;
}
.setup-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.86fr) minmax(0, 1.14fr);
  gap: 64px;
  align-items: start;
  margin-top: 64px;
}
.setup-eyebrow {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #437478;
  margin: 0 0 18px;
}
.setup-intro h1 {
  font-size: 36px;
  line-height: 1.3;
  letter-spacing: -1px;
  margin: 0 0 20px;
  max-width: 360px;
}
.setup-lead {
  font-size: 15px;
  line-height: 1.8;
  color: #617187;
  max-width: 350px;
}
.setup-points {
  display: grid;
  gap: 28px;
  margin-top: 42px;
}
.setup-points > div {
  display: flex;
  gap: 14px;
}
.setup-points > div > span {
  padding-top: 3px;
  color: #79928e;
  font-size: 14px;
  font-weight: 700;
}
.setup-points h2 {
  font-size: 14px;
  margin: 0 0 6px;
}
.setup-points p {
  margin: 0;
  font-size: 14px;
  line-height: 1.8;
  color: #68788a;
}
.setup-card {
  background: #fff;
  border: 1px solid #dce4ed;
  border-radius: 16px;
  padding: 30px;
  box-shadow: 0 10px 32px #18395208;
}
.setup-progress {
  list-style: none;
  display: flex;
  gap: 16px;
  padding: 0;
  margin: 0 0 32px;
  font-size: 14px;
  color: #748296;
}
.setup-progress li {
  display: flex;
  align-items: center;
  gap: 7px;
}
.setup-progress li > span {
  display: grid;
  place-items: center;
  border: 1px solid #dbe3eb;
  border-radius: 50%;
  width: 23px;
  height: 23px;
  flex: none;
}
.setup-progress .current {
  color: #173f69;
  font-weight: 700;
}
.setup-progress .current > span {
  background: #173f69;
  color: white;
  border-color: #173f69;
}
.setup-progress .complete > span {
  background: #ecf4f1;
  color: #32665c;
  border-color: #d7e8e1;
}
.setup-card h2 {
  font-size: 22px;
  line-height: 1.4;
  margin: 0 0 10px;
  outline-offset: 5px;
}
.setup-hint {
  font-size: 14px;
  color: #67788b;
  line-height: 1.8;
  margin: 0 0 28px;
}
.setup-editions {
  border: 0;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  min-width: 0;
}
.setup-editions label {
  position: relative;
  border: 1px solid #dbe3eb;
  border-radius: 10px;
  padding: 20px 16px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}
.setup-editions label.selected {
  border-color: #225f94;
  background: #f5f9fd;
  box-shadow: inset 0 0 0 1px #225f94;
}
.setup-editions input {
  position: absolute;
  right: 14px;
  top: 16px;
  accent-color: #225f94;
}
.edition-glyph {
  font-size: 28px;
  font-weight: 650;
  margin-bottom: 7px;
  color: #275980;
}
.setup-editions strong {
  font-size: 15px;
}
.setup-editions small {
  font-size: 14px;
  color: #728196;
  line-height: 1.7;
}
.setup-editions label:focus-within {
  outline: 2px solid #6793b9;
  outline-offset: 3px;
}
.setup-fields {
  display: grid;
  gap: 20px;
}
.setup-fields label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
  font-weight: 650;
  min-width: 0;
}
.setup-fields input {
  box-sizing: border-box;
  width: 100%;
  height: 42px;
  border: 1px solid #ccd8e4;
  border-radius: 6px;
  padding: 0 12px;
  color: #21364e;
  font: 400 14px inherit;
  background: #fff;
}
.setup-fields input:focus {
  outline: 2px solid #76a5ca;
  outline-offset: 1px;
}
.setup-fields small,
.setup-password-hint {
  font-size: 14px;
  line-height: 1.65;
  color: #718194;
  font-weight: 400;
}
.setup-field-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.setup-password-hint {
  margin-top: -12px;
}
.setup-review {
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: #f4f7fa;
  border-radius: 8px;
  padding: 14px;
  font-size: 14px;
}
.setup-review span {
  color: #526b83;
}
.setup-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 30px;
  padding-top: 22px;
  border-top: 1px solid #edf1f5;
}
.setup-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  min-height: 42px;
  padding: 10px 18px;
  border-radius: 7px;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
}
.setup-primary {
  color: #fff;
  background: #173f69;
  border: 1px solid #173f69;
}
.setup-primary:disabled {
  opacity: 0.6;
  cursor: wait;
}
.setup-secondary {
  background: #fff;
  color: #52667b;
  border: 1px solid #d9e1e9;
}
.setup-actions a {
  font-size: 14px;
  color: #225f94;
}
.setup-error {
  background: #fff3f1;
  border: 1px solid #f2d4cf;
  border-radius: 7px;
  color: #a03629;
  padding: 12px;
  font-size: 14px;
  line-height: 1.7;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.setup-fields input {
  font-family: inherit;
  font-size: 14px;
  font-weight: 400;
}
.setup-grid {
  display: block;
  max-width: 620px;
  margin: 40px auto 0;
}
.setup-intro h1 {
  max-width: none;
  font-size: 28px;
  margin: 0 0 24px;
}
.setup-points {
  display: none;
}
@media (max-width: 680px) {
  .setup-progress li {
    flex: 1;
    flex-direction: column;
    text-align: center;
    min-width: 0;
  }
  .setup-progress li > span {
    margin-bottom: 4px;
  }
}
@media (max-width: 900px) {
  .setup-grid {
    gap: 30px;
    grid-template-columns: 0.8fr 1.2fr;
  }
  .setup-page {
    padding: 26px;
  }
  .setup-intro h1 {
    font-size: 30px;
  }
  .setup-card {
    padding: 24px;
  }
  .setup-progress {
    gap: 10px;
  }
}
@media (max-width: 680px) {
  .setup-page {
    padding: 20px 18px 40px;
  }
  .setup-grid {
    grid-template-columns: 1fr;
    margin-top: 32px;
    gap: 24px;
  }
  .setup-intro h1 {
    font-size: 27px;
    max-width: none;
    margin-bottom: 12px;
  }
  .setup-lead {
    max-width: none;
    margin: 0;
  }
  .setup-points,
  .setup-eyebrow {
    display: none;
  }
  .setup-card {
    padding: 22px 18px;
  }
  .setup-progress {
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 24px;
  }
  .setup-progress li {
    gap: 5px;
    font-size: 14px;
  }
  .setup-card h2 {
    font-size: 20px;
  }
  .setup-field-pair {
    grid-template-columns: 1fr;
  }
  .setup-brand {
    font-size: 14px;
  }
  .setup-badge {
    font-size: 9px;
  }
  .setup-fields input {
    font-size: 16px;
  }
  .setup-editions label {
    padding: 20px 12px;
  }
}
</style>
