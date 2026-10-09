import { onBeforeUnmount } from 'vue'
import { showImagePreview } from 'vant'
import { onSessionBoundary } from '@/mobile/api'

interface OwnedPreview {
  owner: symbol
  close: () => void
}

// Vant's function API reuses one body-mounted instance outside the page tree.
// Only its current owner may close it; an older page can unmount after a new one opens it.
let activePreview: OwnedPreview | undefined

export function useEvidencePreview() {
  const owner = Symbol('evidence-preview-page')
  let disposed = false
  function closeOwnedPreview() {
    if (activePreview?.owner !== owner) return
    const preview = activePreview
    activePreview = undefined
    preview.close()
  }
  const unsubscribe = onSessionBoundary(closeOwnedPreview)
  onBeforeUnmount(() => {
    disposed = true
    unsubscribe()
    closeOwnedPreview()
  })

  return (images: string[], startPosition = 0) => {
    if (disposed || images.length === 0) return
    const instance = showImagePreview({
      images: [...images],
      startPosition,
      closeable: true
    })
    // Keep ownership across manual close. A delayed close event from the singleton
    // must not erase ownership of a newer preview; closing twice is harmless.
    activePreview = { owner, close: () => instance?.close() }
  }
}
