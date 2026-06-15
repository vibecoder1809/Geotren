'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { Train, Stop, Alert, Route, Theme } from '@/types'
import { LINE_COLORS } from '@/lib/constants'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { DetailPanel } from './DetailPanel'
import { StopPanel } from './StopPanel'
import { MobileLayout } from './MobileLayout'
import { useInterpolatedTrains } from '@/lib/interpolate'

const MapView = dynamic(() => import('./MapView'), { ssr: false })

export function App() {
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
  const [dailyPunctuality, setDailyPunctuality] = useState<Record<string, { onTime: number; total: number }>>({})
  const [isMobile, setIsMobile]           = useState(false)

  const tallyRef = useRef<{ date: string; data: Record<string, { onTime: number; total: number }> }>({
    date: new Date().toDateString(),
    data: {},
  })
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

      const today = new Date().toDateString()
      if (tallyRef.current.date !== today) {
        tallyRef.current = { date: today, data: {} }
      }
      const tally = tallyRef.current.data
      for (const train of data) {
        if (!tally[train.line]) tally[train.line] = { onTime: 0, total: 0 }
        tally[train.line].total++
        if (train.delayMinutes === 0) tally[train.line].onTime++
      }
      setDailyPunctuality({ ...tally })
    } catch (e) {
      console.error('Failed to fetch trains:', e)
      setApiError("No es pot connectar amb l'API de trens")
    } finally {
      if (showLoader) setRefreshing(false)
    }
  }, [])

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
    const interval = setInterval(() => fetchTrains(false), 20_000)
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
        <div style={{ gridColumn: '1 / -1', background: 'rgba(234,179,8,0.1)', borderBottom: '1px solid rgba(234,179,8,0.2)', color: 'var(--yellow)', padding: '6px 20px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
          <span style={{ background: 'var(--yellow)', color: '#000', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>ALERTA</span>
          {alerts[0].header}
          {alerts.length > 1 && <span style={{ color: 'var(--muted)', fontSize: 10, marginLeft: 4 }}>+{alerts.length - 1} més</span>}
        </div>
      )}

      <Sidebar
        trains={filteredTrains}
        stops={stops}
        lines={lines}
        lineColors={lineColors}
        activeLines={activeLines}
        selectedTrain={selectedTrain}
        selectedStop={selectedStop}
        dailyPunctuality={dailyPunctuality}
        onToggleLine={toggleLine}
        onSelectTrain={handleSelectTrain}
        onSelectStop={handleSelectStop}
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
          theme={theme}
        />
        <DetailPanel train={selectedTrain} lineColors={lineColors} onClose={handleCloseTrain} />
        <StopPanel stop={selectedStop} onClose={handleCloseStop} />
      </div>
    </div>
  )
}
