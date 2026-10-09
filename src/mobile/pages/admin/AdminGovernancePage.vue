<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { showConfirmDialog } from 'vant'
import { RouterLink } from 'vue-router'
import { msg, formatNumber } from '@/mobile/i18n'
import { request } from '@/mobile/api'
import { useLoad, useMutation } from '@/mobile/api/ui'
import { formatTimestamp } from '@/mobile/utils/date'
import { retentionBlockers, retentionBlockerLabel } from '@/mobile/utils/retention'
import LoadState from '@/mobile/components/LoadState.vue'
import SettingsNavigation from '@/mobile/components/SettingsNavigation.vue'

interface RetentionItem { taskId: string; title: string; taskVersion: number; lastSnapshotAt: string; eligibleAt: string; eligible: boolean; counts: { participants: number; revisions: number; snapshots: number; files: number; fileBytes: number; notices: number }; blockers: Array<{ code: string; count: number }>; previewHash: string }
interface RetentionData { retentionDays: number; items: RetentionItem[]; pendingFileDeletions: number; page: number; pageSize: number; total: number; automaticDeletion: false; backupDeletionAutomatic: false }
interface MailData { enabled: boolean; counts: Record<'pending' | 'sending' | 'accepted' | 'failed', number>; items: Array<{ id: string; recipientName: string | null; status: 'pending' | 'sending' | 'accepted' | 'failed'; attempts: number; errorCode: string | null; updatedAt: string }> }
interface FileCleanup { processed: number; deleted: number; failed: number; pending: number }
const props = defineProps<{ section: 'notifications' | 'data' }>()
const retention = ref<RetentionData>(); const mail = ref<MailData>(); const page = ref(1)
const preview = ref<RetentionItem>(); const confirmation = ref(''); const previewOpen = ref(false); const needsRefresh = ref(false)
const cleanupResult = ref<{ purged: boolean; files: FileCleanup }>()
const { busy, error: mutationError, run } = useMutation()
const { loading, error, reload } = useLoad(async signal => {
  if (props.section === 'notifications') mail.value = (await request<MailData>('/admin/mail-deliveries', { signal })).data
  else {
    retention.value = (await request<RetentionData>('/admin/retention', { signal, query: { page: page.value } })).data
    const lastPage = Math.max(1, Math.ceil(retention.value.total / retention.value.pageSize))
    if (page.value > lastPage) page.value = lastPage
  }
}, [() => props.section, page])
watch(() => props.section, () => {
  mail.value = undefined; retention.value = undefined; preview.value = undefined; previewOpen.value = false
  confirmation.value = ''; cleanupResult.value = undefined; needsRefresh.value = false; mutationError.value = ''; page.value = 1
})
const canClean = (item: RetentionItem) => item.eligible && item.blockers.length === 0
const cleanableOnPage = computed(() => retention.value?.items.some(canClean) ?? false)
const pendingFiles = computed(() => Math.max(retention.value?.pendingFileDeletions ?? 0, cleanupResult.value?.files.pending ?? 0))
const incompleteCleanup = computed(() => !!cleanupResult.value && (cleanupResult.value.files.failed > 0 || cleanupResult.value.files.pending > 0))
const canConfirm = computed(() => !!preview.value && canClean(preview.value) && !needsRefresh.value && confirmation.value === preview.value.taskId)
const mailLabel = (status: MailData['items'][number]['status']) => msg(status === 'accepted' ? '已交给邮件服务' : status === 'sending' ? '发送中' : status === 'failed' ? '发送失败' : '等待发送')
const recordStatus = (item: RetentionItem) => msg(canClean(item) ? '可清理' : item.blockers.some(blocker => blocker.code === 'RETENTION_NOT_DUE') ? '保存中' : '暂不可清理')
const actionableBlockers = (item: RetentionItem) => retentionBlockers(item.blockers).filter(blocker => blocker.code !== 'RETENTION_NOT_DUE')
async function previewDeletion(id: string) {
  confirmation.value = ''; needsRefresh.value = true
  await run(() => request<RetentionItem>(`/admin/retention/tasks/${encodeURIComponent(id)}/preview`), result => {
    preview.value = result.data; previewOpen.value = true; needsRefresh.value = false
  })
}
async function purge() {
  const current = preview.value
  if (!current || !canConfirm.value || busy.value) return
  try { await showConfirmDialog({ title: msg('确认永久删除？'), message: `${current.title}\n${msg('永久删除任务及名单、材料、审核、快照和关联通知；账号保留。')}`, confirmButtonText: msg('永久删除'), confirmButtonColor: '#be123c' }) } catch { return }
  if (preview.value !== current || !canConfirm.value) return
  const succeeded = await run(() => request<{ purged: boolean; files: FileCleanup }>(`/admin/retention/tasks/${encodeURIComponent(current.taskId)}/purge`, {
    method: 'POST', body: { version: current.taskVersion, previewHash: current.previewHash, confirmation: confirmation.value }
  }), result => { cleanupResult.value = result.data; preview.value = undefined; confirmation.value = ''; previewOpen.value = false })
  if (!succeeded) { needsRefresh.value = true; confirmation.value = '' }
}
async function retryFiles() {
  await run(() => request<FileCleanup>('/admin/retention/files/retry', { method: 'POST', body: {} }), result => { cleanupResult.value = { purged: false, files: result.data } })
}
async function retryMail(item: MailData['items'][number]) {
  if (busy.value || !mail.value?.enabled || item.status !== 'failed') return
  if (item.errorCode === 'MAIL_OUTCOME_UNKNOWN') {
    try { await showConfirmDialog({ title: msg('重新发送'), message: msg('投递结果未知；重试可能重复发送。') }) } catch { return }
  }
  if (props.section !== 'notifications') return
  await run(() => request(`/admin/mail-deliveries/${encodeURIComponent(item.id)}/retry`, { method: 'POST', body: {} }), undefined, msg('已加入发送队列'))
}
</script>

<template>
  <div class="admin-module-page maintenance-page">
    <SettingsNavigation />
    <LoadState :loading="loading" :error="error" @retry="reload" />
    <p v-if="mutationError" role="alert" class="maintenance-feedback is-warning">{{ mutationError }}</p>
    <template v-if="section === 'notifications' && mail">
      <section class="maintenance-card">
        <div class="maintenance-setting-row"><h2>{{ msg('站内通知') }}</h2><span class="maintenance-badge is-positive">{{ msg('使用中') }}</span></div>
        <div class="maintenance-setting-row"><h2>{{ msg('邮件通知') }}</h2><span class="maintenance-badge" :class="{ 'is-positive': mail.enabled }">{{ msg(mail.enabled ? '已启用' : '未启用') }}</span></div>
        <details v-if="!mail.enabled" class="maintenance-disclosure"><summary>{{ msg('如何启用邮件通知') }}</summary><p>{{ msg('请联系部署负责人配置邮件服务。') }}</p></details>
      </section>
      <section v-if="mail.counts.failed" class="maintenance-feedback is-warning" role="status">{{ msg('有 {p0} 封通知发送失败', { p0: mail.counts.failed }) }}</section>
      <section v-if="mail.enabled || mail.items.length" class="maintenance-card">
        <details class="maintenance-disclosure" :open="mail.counts.failed > 0">
          <summary>{{ msg('发送记录') }}</summary>
          <div class="mail-counts"><span v-for="(count, status) in mail.counts" :key="status">{{ mailLabel(status) }} <strong>{{ formatNumber(count) }}</strong></span></div>
          <p v-if="!mail.items.length" class="maintenance-empty">{{ msg('暂无发送记录') }}</p>
          <ul v-else class="maintenance-list"><li v-for="item in mail.items" :key="item.id" class="mail-record"><div><strong>{{ item.recipientName || msg('账号已移除') }}</strong><time>{{ formatTimestamp(item.updatedAt) }}</time></div><span class="maintenance-badge" :class="{ 'is-warning': item.status === 'failed' }">{{ mailLabel(item.status) }}</span><button v-if="item.status === 'failed'" type="button" :disabled="busy || !mail.enabled" @click="retryMail(item)">{{ msg('重新发送') }}</button></li></ul>

        </details>
      </section>
    </template>
    <template v-if="section === 'data' && retention">
      <section class="maintenance-card">
        <div class="maintenance-setting-row"><h2>{{ msg('结项资料保存期限') }}</h2><div class="maintenance-inline"><strong>{{ msg('{p0} 天', { p0: retention.retentionDays }) }}</strong><RouterLink to="/admin/settings#retention-settings">{{ msg('修改') }}</RouterLink></div></div>
        <div class="maintenance-setting-row"><span>{{ msg('到期处理') }}</span><span>{{ msg('管理员确认清理') }}</span></div>
      </section>
      <section v-if="cleanupResult" class="maintenance-feedback" :class="{ 'is-warning': incompleteCleanup }" :role="incompleteCleanup ? 'alert' : 'status'">
        <strong v-if="cleanupResult.purged">{{ msg(incompleteCleanup ? '任务记录已清理，部分附件仍待处理。' : '任务资料已清理。') }}</strong><p>{{ msg('已清理 {p0} 个附件', { p0: cleanupResult.files.deleted }) }}</p><p v-if="incompleteCleanup">{{ msg('部分附件未能清理，请重试。') }}</p>
      </section>
      <section v-if="pendingFiles || incompleteCleanup" class="maintenance-card maintenance-setting-row"><strong>{{ msg('有 {p0} 个附件待清理', { p0: pendingFiles }) }}</strong><button type="button" :disabled="busy" @click="retryFiles">{{ msg('重试清理') }}</button></section>
      <section class="maintenance-card">
        <details class="maintenance-disclosure" :open="cleanableOnPage">
          <summary>{{ msg('已结项任务') }} <span class="maintenance-count">{{ formatNumber(retention.total) }}</span></summary>
          <p v-if="!retention.items.length" class="maintenance-empty">{{ msg('暂无已结项任务') }}</p>
          <ul v-else class="maintenance-list retention-list"><li v-for="item in retention.items" :key="item.taskId" class="retention-record"><div class="retention-record-main"><strong>{{ item.title }}</strong><time>{{ msg('保留至 {p0}', { p0: formatTimestamp(item.eligibleAt) }) }}</time></div><span class="maintenance-badge" :class="{ 'is-positive': canClean(item) }">{{ recordStatus(item) }}</span><button v-if="canClean(item)" type="button" :disabled="busy" @click="previewDeletion(item.taskId)">{{ msg('查看清理范围') }}</button><details v-if="actionableBlockers(item).length" class="retention-reasons"><summary>{{ msg('查看原因') }}</summary><ul><li v-for="blocker in actionableBlockers(item)" :key="blocker.code">{{ retentionBlockerLabel(blocker) }}</li></ul></details></li></ul>
          <nav v-if="retention.total > retention.pageSize" class="maintenance-pagination" :aria-label="msg('分页')"><button :disabled="loading || page <= 1" @click="page--">{{ msg('上一页') }}</button><span>{{ msg('第 {p0} / {p1} 页', { p0: page, p1: Math.ceil(retention.total / retention.pageSize) }) }}</span><button :disabled="loading || page * retention.pageSize >= retention.total" @click="page++">{{ msg('下一页') }}</button></nav>
        </details>
      </section>
    </template>
    <van-popup v-model:show="previewOpen" position="right" :close-on-click-overlay="!busy" :close-on-popstate="!busy" :style="{ width: 'min(100vw, 560px)', height: '100%' }" :aria-label="msg('清理确认')">
      <section v-if="preview" class="cleanup-preview">
        <header><h2>{{ msg('清理确认') }}</h2><button type="button" :disabled="busy" :aria-label="msg('关闭')" @click="previewOpen = false">×</button></header>
        <h3>{{ preview.title }}</h3><p>{{ msg('永久删除任务及名单、材料、审核、快照和关联通知；账号保留。') }}</p><p>{{ msg('此操作无法撤销，历史备份保留。') }}</p>
        <dl class="cleanup-counts"><div><dt>{{ msg('名单人数') }}</dt><dd>{{ formatNumber(preview.counts.participants) }}</dd></div><div><dt>{{ msg('提交版本数') }}</dt><dd>{{ formatNumber(preview.counts.revisions) }}</dd></div><div><dt>{{ msg('快照数') }}</dt><dd>{{ formatNumber(preview.counts.snapshots) }}</dd></div><div><dt>{{ msg('附件') }}</dt><dd>{{ formatNumber(preview.counts.files) }}</dd></div><div><dt>{{ msg('通知数') }}</dt><dd>{{ formatNumber(preview.counts.notices) }}</dd></div></dl>
        <p v-if="needsRefresh" role="alert" class="maintenance-feedback is-warning">{{ msg('请重新核对清理范围后再确认。') }}</p><ul v-if="preview.blockers.length" role="alert"><li v-for="blocker in retentionBlockers(preview.blockers)" :key="blocker.code">{{ retentionBlockerLabel(blocker) }}</li></ul>
        <label v-if="canClean(preview)" class="cleanup-confirmation"><span>{{ msg('输入下方任务编号确认清理') }}</span><code>{{ preview.taskId }}</code><input v-model="confirmation" :disabled="busy || needsRefresh" autocomplete="off" spellcheck="false" /></label>
        <footer><button type="button" :disabled="busy" @click="previewDeletion(preview.taskId)">{{ msg('重新检查') }}</button><van-button type="danger" :loading="busy" :disabled="!canConfirm" @click="purge">{{ msg('永久删除') }}</van-button></footer>
      </section>
    </van-popup>
  </div>
</template>
<style scoped>
.maintenance-page{max-width:1100px}.maintenance-card{background:#fff;border:1px solid #dce4ed;border-radius:10px;padding:24px;margin-bottom:20px;font-size:15px;color:#263f55}.maintenance-card.maintenance-setting-row{padding:20px 24px}
.maintenance-setting-row{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:18px 0}.maintenance-setting-row+.maintenance-setting-row{border-top:1px solid #edf1f5}.maintenance-setting-row:first-child{padding-top:0}.maintenance-setting-row:last-child{padding-bottom:0}.maintenance-setting-row h2{font-size:16px;margin:0}.maintenance-inline{display:flex;align-items:center;gap:24px}.maintenance-inline a{font-size:14px;color:#24567f}
.maintenance-badge{font-size:14px;color:#52667b;background:#f0f3f7;border-radius:5px;padding:5px 10px;white-space:nowrap}.maintenance-badge.is-positive{color:#216851;background:#edf7f2}.maintenance-badge.is-warning{color:#9a491d;background:#fff1e7}
.maintenance-disclosure>summary{cursor:pointer;font-size:16px;font-weight:600;padding:5px 0;line-height:1.5}.maintenance-disclosure[open]>summary{margin-bottom:20px}.maintenance-disclosure p{font-size:14px;line-height:1.8;color:#53687b}.maintenance-count{display:inline-block;margin-left:8px;font-size:14px;color:#53687b;font-weight:400}.maintenance-empty{padding:12px 0}
.maintenance-feedback{padding:16px 20px;margin-bottom:20px;border:1px solid #cde6d8;background:#f2faf5;color:#225d44;border-radius:8px;font-size:15px;line-height:1.7}.maintenance-feedback.is-warning{border-color:#ead4b3;background:#fffbf2;color:#835a22}.maintenance-feedback p{margin:5px 0 0}
.maintenance-list{list-style:none;margin:0;padding:0}.maintenance-list>li{border-top:1px solid #edf1f5;padding:18px 0}.maintenance-list>li:first-child{border-top:0}.maintenance-list strong{display:block;font-size:15px;line-height:1.6;overflow-wrap:anywhere}.maintenance-list time{display:block;font-size:14px;color:#53687b;margin-top:5px;line-height:1.6}.mail-record,.retention-record{display:flex;align-items:center;gap:18px;flex-wrap:wrap}.mail-record>div,.retention-record-main{flex:1;min-width:180px}.retention-reasons{flex-basis:100%;font-size:14px}.retention-reasons summary{cursor:pointer}.retention-reasons li{margin-top:8px;line-height:1.6}.mail-counts{display:flex;gap:16px;flex-wrap:wrap;font-size:14px;color:#53687b}.mail-counts strong{color:#263f55}
.maintenance-page button:not(.van-button){font:inherit;min-height:40px;border:1px solid #ccd9e6;background:white;color:#24567f;border-radius:6px;padding:8px 14px;cursor:pointer}.maintenance-page button:disabled{cursor:default;opacity:.5}.maintenance-page :is(button,input,summary,a):focus-visible{outline:3px solid #438bbd;outline-offset:3px}.maintenance-pagination{display:flex;justify-content:flex-end;gap:14px;align-items:center;margin-top:20px;font-size:14px}
.cleanup-preview{padding:28px;font-size:15px;line-height:1.7;color:#263f55}.cleanup-preview header{display:flex;align-items:center;justify-content:space-between;gap:16px}.cleanup-preview h2{font-size:22px;margin:0}.cleanup-preview h3{font-size:18px;margin:24px 0 12px}.cleanup-preview header button{font-size:24px;line-height:1}.cleanup-counts{padding:12px 16px;background:#f5f7fa;border-radius:8px}.cleanup-counts>div{display:flex;justify-content:space-between;gap:16px;padding:5px 0}.cleanup-counts dd{margin:0;font-weight:600}.cleanup-confirmation{display:grid;gap:10px;margin-top:24px}.cleanup-confirmation code{font-size:14px;overflow-wrap:anywhere;user-select:all;background:#f5f7fa;padding:10px;border-radius:5px}.cleanup-confirmation input{width:100%;box-sizing:border-box;border:1px solid #bcccdc;border-radius:6px;padding:11px;font-size:16px}.cleanup-preview footer{display:flex;gap:12px;justify-content:flex-end;margin-top:28px}
@media(max-width:560px){.maintenance-card{padding:18px}.maintenance-setting-row{gap:12px;flex-wrap:wrap}.maintenance-inline{gap:16px}.mail-record,.retention-record{gap:12px}.mail-record>div,.retention-record-main{flex-basis:100%}.cleanup-preview{padding:20px}.maintenance-pagination{justify-content:center;gap:8px}}
</style>
