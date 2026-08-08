'use client'

import { useEffect } from 'react'

// Registers the service worker (offline shell + data caching) after load.
// Production only: a caching SW in front of the Turbopack dev server serves
// stale build assets and breaks HMR.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    const onLoad = () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) }
    // Hydration normally finishes *after* window.load has already fired, and a
    // listener added at that point never runs — which left the SW permanently
    // unregistered. Only wait for the event if the page is still loading.
    if (document.readyState === 'complete') {
      onLoad()
      return
    }
    window.addEventListener('load', onLoad, { once: true })
    return () => window.removeEventListener('load', onLoad)
  }, [])
  return null
}
