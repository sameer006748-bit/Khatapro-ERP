'use client'

import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'khatapro-install-dismissed'

/**
 * Registers the service worker on the client.
 * Shows:
 *   - Install prompt when available (beforeinstallprompt) and not dismissed.
 *   - Update notification when a new SW version is available.
 */
export function ServiceWorkerRegister() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  // Lazy init — detect standalone mode on mount without effect-setState.
  const [isStandalone] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(display-mode: standalone)').matches ||
           (window.navigator as any).standalone === true
  })
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Check if previously dismissed
    const dismissed = localStorage.getItem(DISMISS_KEY) === 'true'

    // beforeinstallprompt — Chrome/Edge/Android
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault()
      if (!dismissed && !isStandalone) {
        setInstallPrompt(e as BeforeInstallPromptEvent)
      }
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstall)

    // appinstalled — hide prompt after install
    const handleInstalled = () => {
      setIsInstalled(true)
      setInstallPrompt(null)
    }
    window.addEventListener('appinstalled', handleInstalled)

    // Register service worker (production only)
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      const register = async () => {
        try {
          const reg = await navigator.serviceWorker.register('/sw.js')
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing
            if (!newWorker) return
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setUpdateAvailable(true)
              }
            })
          })
          setInterval(() => reg.update(), 60 * 60 * 1000)
        } catch {
          // Silent fail
        }
      }
      register()
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  // Don't show install prompt if standalone, installed, or dismissed
  const showInstall = installPrompt && !isStandalone && !isInstalled

  async function handleInstall() {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'dismissed') {
      localStorage.setItem(DISMISS_KEY, 'true')
    }
    setInstallPrompt(null)
  }

  function handleDismissInstall() {
    localStorage.setItem(DISMISS_KEY, 'true')
    setInstallPrompt(null)
  }

  function handleUpdate() {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg?.waiting) reg.waiting.postMessage('SKIP_WAITING')
      window.location.reload()
    })
  }

  return (
    <>
      {/* Update notification */}
      {updateAvailable && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100%-2rem)]">
          <div className="card-3d p-3 flex items-center gap-3 border-emerald-200 bg-card shadow-lg">
            <div className="size-9 rounded-lg bg-emerald-50 grid place-items-center shrink-0">
              <svg viewBox="0 0 24 24" fill="none" className="size-5 text-emerald-600">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground">A new version is available</p>
              <p className="text-[10px] text-muted-foreground">Reload to apply the update.</p>
            </div>
            <button
              onClick={handleUpdate}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium press-sm whitespace-nowrap"
            >
              Reload
            </button>
          </div>
        </div>
      )}

      {/* Install prompt */}
      {showInstall && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100%-2rem)]" style={{ bottom: updateAvailable ? '5rem' : '1rem' }}>
          <div className="card-3d p-3 flex items-center gap-3 border-primary/30 bg-card shadow-lg">
            <div className="size-9 rounded-lg bg-primary/10 grid place-items-center shrink-0">
              <svg viewBox="0 0 24 24" fill="none" className="size-5 text-primary">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground">Install KhataPro ERP</p>
              <p className="text-[10px] text-muted-foreground">Add to home screen for quick access.</p>
            </div>
            <button
              onClick={handleDismissInstall}
              className="px-2 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted press-sm"
              aria-label="Dismiss"
            >
              ✕
            </button>
            <button
              onClick={handleInstall}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium press-sm whitespace-nowrap"
            >
              Install
            </button>
          </div>
        </div>
      )}
    </>
  )
}
