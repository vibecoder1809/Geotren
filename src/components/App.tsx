'use client'

import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react'
import dynamic from 'next/dynamic'
import type { Train, Stop, Alert, Route, Theme, Journey } from '@/types'
import { LINE_COLORS } from '@/lib/constants'
import { buildJourneyPath } from '@/lib/journeyPath'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { DetailPanel } from './DetailPanel'
import { StopPanel } from './StopPanel'
import { MobileLayout } from './MobileLayout'
import { useInterpolatedTrains } from '@/lib/interpolate'
import { I18nProvider, useI18n } from '@/lib/i18n'

const MapView = dynamic(() => import('./MapView'), { ssr: false })

const ROTATION_MS = 7_000
const PREVIEW_COUNT = 5
const EXPANDED_COUNT = 10

function AlertBanner({ alerts }: { alerts: Alert[] }) {
  const { t } = useI18n()
  const preview = alerts.slice(0, PREVIEW_COUNT)
  const [idx, setIdx]           = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [fade, setFade]         = useState(true)
  const timerRef                = useRef<ReturnType<typeof setTimeout> | null>(null)

  const rotate = useCallback(() => {
    setFade(false)
    setTimeout(() => {
      setIdx(i => (i + 1) % preview.length)
      setFade(true)
    }, 250)
  }, [preview.length])

  useEffect(() => {
    if (expanded || preview.length <= 1) return
    timerRef.current = setInterval(rotate, ROTATION_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [expanded, preview.length, rotate])

  // reset index when alerts change
  useLayoutEffect(() => { setIdx(0) }, [alerts])

  const visible = preview[idx]

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        gridColumn: '1 / -1',
        background: 'rgba(234,179,8,0.1)',
        borderBottom: '1px solid rgba(234,179,8,0.2)',
        color: 'var(--yellow)',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {/* rotating single-line preview */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 20px',
        opacity: fade ? 1 : 0, transition: 'opacity 0.25s',
      }}>
        <span style={{ background: 'var(--yellow)', color: '#000', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{t('alert')}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{visible?.header}</span>
        {preview.length > 1 && (
          <span style={{ color: 'var(--muted)', fontSize: 10, flexShrink: 0 }}>
            {idx + 1}/{preview.length} {expanded ? '▲' : '▼'}
          </span>
        )}
      </div>

      {/* expanded list */}
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(234,179,8,0.15)', padding: '4px 20px 8px' }}>
          {alerts.slice(0, EXPANDED_COUNT).map((a, i) => (
            <div key={i} style={{ padding: '4px 0', borderBottom: i < Math.min(alerts.length, EXPANDED_COUNT) - 1 ? '1px solid rgba(234,179,8,0.1)' : 'none', fontSize: 11, lineHeight: 1.4 }}>
              <span style={{ fontWeight: 700 }}>{a.header}</span>
              {a.description && (
                <div style={{ color: 'var(--muted)', marginTop: 2, fontWeight: 400 }}>{a.description}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function App() {
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  )
}

function AppInner() {
  const { t } = useI18n()
  const [trains, setTrains]               = useState<Train[]>([])
  const [stops, setStops]                 = useState<Stop[]>([])
  const [routes, setRoutes]               = useState<Route[]>([])
  const [alerts, setAlerts]               = useState<Alert[]>([])
  const [selectedTrain, setSelectedTrain] = useState<Train | null>(null)
  const [selectedStop, setSelectedStop]   = useState<Stop | null>(null)
  const [activeLines, setActiveLines]     = useState<Set<string>>(new Set(['ALL']))
  const [theme, setTheme]                 = useState<Theme>('dark')
  const [refreshing, setRefreshing]       = useState(false)
  const [lastUpdate, setLastUpdate]       = useState<Date | null>(null)
  const [apiError, setApiError]           = useState<string | null>(null)
  const [isMobile, setIsMobile]           = useState(false)
  // Journey whose path is drawn on the map (from the Plan tab). Null = none.
  const [selectedJourney, setSelectedJourney] = useState<Journey | null>(null)

  const prevDataRef = useRef<string>('')

  const lineColors = useMemo<Record<string, string>>(
    () => routes.length > 0
      ? routes.reduce((acc, r) => ({ ...acc, [r.shortName]: r.color }), {} as Record<string, string>)
      : LINE_COLORS,
    [routes],
  )

  const lines = useMemo(
    () => [...new Set(routes.map(r => r.shortName))].sort(),
    [routes],
  )

  const interpolatedTrains = useInterpolatedTrains(trains, routes, stops)

  // Drawable path for the selected journey, recomputed when the journey or the
  // underlying route/stop data changes.
  const journeyPath = useMemo(
    () => selectedJourney && stops.length > 0
      ? buildJourneyPath(selectedJourney, routes, stops, lineColors)
      : null,
    [selectedJourney, routes, stops, lineColors],
  )

  const filteredTrains = useMemo(
    () => activeLines.has('ALL') ? interpolatedTrains : interpolatedTrains.filter(t => activeLines.has(t.line)),
    [interpolatedTrains, activeLines],
  )

  const fetchTrains = useCallback(async (showLoader = false) => {
    if (showLoader) setRefreshing(true)
    try {
      const res = await fetch('/api/trains')
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        setApiError(err.error ?? `Error ${res.status}`)
        return
      }
      const data: Train[] = await res.json()
      setApiError(null)
      setTrains(data)
      const fingerprint = JSON.stringify(data.map(t => ({ id: t.id, lat: t.lat, lng: t.lng, delay: t.delayMinutes })))
      if (fingerprint !== prevDataRef.current) {
        prevDataRef.current = fingerprint
        setLastUpdate(new Date())
      }
    } catch (e) {
      console.error('Failed to fetch trains:', e)
      setApiError(t('apiConnectError'))
    } finally {
      if (showLoader) setRefreshing(false)
    }
  }, [t])

  const handleSelectTrain = useCallback((t: Train) => {
    setSelectedTrain(t)
    setSelectedStop(null)
  }, [])

  const handleSelectStop = useCallback((s: Stop) => {
    setSelectedStop({ ...s })
    setSelectedTrain(null)
  }, [])

  const handleCloseTrain = useCallback(() => setSelectedTrain(null), [])
  const handleCloseStop  = useCallback(() => setSelectedStop(null), [])
  const handleRefresh    = useCallback(() => fetchTrains(true), [fetchTrains])

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', next)
      return next
    })
  }, [])

  const toggleLine = useCallback((line: string) => {
    setActiveLines(prev => {
      const next = new Set(prev)
      if (line === 'ALL') return new Set(['ALL'])
      next.delete('ALL')
      if (next.has(line)) {
        next.delete(line)
        if (next.size === 0) return new Set(['ALL'])
      } else {
        next.add(line)
      }
      return next
    })
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    fetchTrains(true)
    const interval = setInterval(() => fetchTrains(false), 10_000)
    return () => clearInterval(interval)
  }, [fetchTrains])

  useEffect(() => {
    fetch('/api/stops').then(r => r.json()).then(setStops).catch(console.error)
    fetch('/api/routes').then(r => r.json()).then(setRoutes).catch(console.error)
    fetch('/api/alerts').then(r => r.json()).then(setAlerts).catch(console.error)
    const alertInterval = setInterval(() => {
      fetch('/api/alerts').then(r => r.json()).then(setAlerts).catch(console.error)
    }, 300_000)
    return () => clearInterval(alertInterval)
  }, [])

  const lineCount = useMemo(() => new Set(trains.map(t => t.line)).size, [trains])

  if (isMobile) {
    return (
      <div data-theme={theme}>
        <MobileLayout
          trains={trains}
          stops={stops}
          routes={routes}
          alerts={alerts}
          lines={lines}
          lineColors={lineColors}
          activeLines={activeLines}
          selectedTrain={selectedTrain}
          selectedStop={selectedStop}
          refreshing={refreshing}
          lastUpdate={lastUpdate}
          apiError={apiError}
          theme={theme}
          onToggleLine={toggleLine}
          onSelectTrain={handleSelectTrain}
          onSelectStop={handleSelectStop}
          onCloseTrain={handleCloseTrain}
          onCloseStop={handleCloseStop}
          onRefresh={handleRefresh}
          onThemeToggle={toggleTheme}
        />
      </div>
    )
  }

  return (
    <div
      data-theme={theme}
      style={{
        display: 'grid',
        gridTemplateRows: '56px auto 1fr',
        gridTemplateColumns: '360px 1fr',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--bg)',
        color: 'var(--text)',
      }}
    >
      <Header
        trainCount={trains.length}
        lineCount={lineCount}
        lastUpdate={lastUpdate}
        refreshing={refreshing}
        onThemeToggle={toggleTheme}
        onRefresh={handleRefresh}
      />

      {apiError && (
        <div style={{ gridColumn: '1 / -1', background: 'rgba(239,68,68,0.1)', borderBottom: '1px solid rgba(239,68,68,0.2)', color: 'var(--red)', padding: '6px 20px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
          <span style={{ background: 'var(--red)', color: '#fff', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>ERROR</span>
          {apiError}
        </div>
      )}

      {!apiError && alerts.length > 0 && (
        <AlertBanner alerts={alerts} />
      )}

      <Sidebar
        trains={filteredTrains}
        stops={stops}
        lines={lines}
        lineColors={lineColors}
        activeLines={activeLines}
        selectedTrain={selectedTrain}
        selectedStop={selectedStop}
        onToggleLine={toggleLine}
        onSelectTrain={handleSelectTrain}
        onSelectStop={handleSelectStop}
        selectedJourney={selectedJourney}
        onSelectJourney={setSelectedJourney}
      />

      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <MapView
          trains={filteredTrains}
          stops={stops}
          routes={routes}
          lineColors={lineColors}
          selectedTrain={selectedTrain}
          selectedStop={selectedStop}
          onSelectTrain={handleSelectTrain}
          onSelectStop={handleSelectStop}
          journeyPath={journeyPath}
          theme={theme}
        />
        <DetailPanel train={selectedTrain} lineColors={lineColors} onClose={handleCloseTrain} />
        <StopPanel stop={selectedStop} onClose={handleCloseStop} lineColors={lineColors} />
      </div>
    </div>
  )
}
