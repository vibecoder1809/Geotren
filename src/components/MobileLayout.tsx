'use client'

import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { Train, Stop, Alert, Route, Theme, Journey } from '@/types'
import { LINE_COLORS } from '@/lib/constants'
import { buildJourneyPath } from '@/lib/journeyPath'
import { TrainCard } from './TrainCard'
import { DetailPanel } from './DetailPanel'
import { StopPanel } from './StopPanel'
import { TripPlanner } from './TripPlanner'
import { LanguagePicker } from './Header'
import { useI18n, type TransKey } from '@/lib/i18n'

const LINE_GROUPS: { key: string; labelKey: TransKey; prefix: RegExp }[] = [
  { key: 'L', labelKey: 'groupUrbanShort',    prefix: /^L/ },
  { key: 'S', labelKey: 'groupVallesShort',   prefix: /^S/ },
  { key: 'R', labelKey: 'groupRegionalShort', prefix: /^R/ },
  { key: 'Other', labelKey: 'groupOther',     prefix: /^(?!L|S|R)/ },
]

function useRelativeTime(lastUpdate: Date | null): string {
  const { t } = useI18n()
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  if (!lastUpdate) return '—'
  const secs = Math.round((Date.now() - lastUpdate.getTime()) / 1000)
  if (secs < 5) return t('justNow')
  if (secs < 60) return t('secsAgo', secs)
  const mins = Math.floor(secs / 60)
  return t('minsAgo', mins)
}

const MapView = dynamic(() => import('./MapView'), { ssr: false })

interface MobileLayoutProps {
  trains: Train[]
  stops: Stop[]
  routes: Route[]
  alerts: Alert[]
  lines: string[]
  lineColors: Record<string, string>
  activeLines: Set<string>
  selectedTrain: Train | null
  selectedStop: Stop | null
  refreshing: boolean
  lastUpdate: Date | null
  apiError: string | null
  theme: Theme
  onToggleLine: (line: string) => void
  onSelectTrain: (train: Train) => void
  onSelectStop: (stop: Stop) => void
  onCloseTrain: () => void
  onCloseStop: () => void
  onRefresh: () => void
  onThemeToggle: () => void
}

// ── Bottom-sheet drag ────────────────────────────────────────────────────
// Sheet snap positions as a fraction of viewport height (from the bottom).
const SNAP_PEEK = 0.16  // handle + tabs + one card peeking
const SNAP_HALF = 0.48  // roughly half screen
const SNAP_FULL = 0.9   // almost full
const SNAPS = [SNAP_PEEK, SNAP_HALF, SNAP_FULL]

// Velocity-aware snap: a fast flick jumps a step in its direction, otherwise we
// settle to the nearest snap point. `velocity` is in ratio-units per second
// (positive = expanding upward).
function resolveSnap(ratio: number, velocity: number): number {
  const FLICK = 0.6
  const nearestIdx = SNAPS.reduce(
    (best, _, i) => (Math.abs(SNAPS[i] - ratio) < Math.abs(SNAPS[best] - ratio) ? i : best),
    0,
  )
  if (velocity > FLICK && nearestIdx < SNAPS.length - 1) return SNAPS[nearestIdx + 1]
  if (velocity < -FLICK && nearestIdx > 0) return SNAPS[nearestIdx - 1]
  return SNAPS[nearestIdx]
}

// Generic vertical drag tracker that binds move/end listeners to the window
// (not the handle element), so a fast swipe never "loses" the pointer. Reports
// the live drag delta in px and a velocity estimate on release.
function useVerticalDrag(onMove: (deltaY: number) => void, onEnd: (deltaY: number, velocityPxPerS: number) => void) {
  const state = useRef<{ startY: number; lastY: number; lastT: number; vel: number } | null>(null)

  const begin = useCallback((clientY: number) => {
    state.current = { startY: clientY, lastY: clientY, lastT: performance.now(), vel: 0 }
  }, [])

  useEffect(() => {
    const move = (clientY: number) => {
      const s = state.current
      if (!s) return
      const now = performance.now()
      const dt = now - s.lastT
      if (dt > 0) s.vel = (clientY - s.lastY) / dt * 1000 // px/s
      s.lastY = clientY
      s.lastT = now
      onMove(clientY - s.startY)
    }
    const end = () => {
      const s = state.current
      if (!s) return
      state.current = null
      onEnd(s.lastY - s.startY, s.vel)
    }
    const mm = (e: MouseEvent) => move(e.clientY)
    const tm = (e: TouchEvent) => { if (state.current) { e.preventDefault(); move(e.touches[0].clientY) } }
    window.addEventListener('mousemove', mm)
    window.addEventListener('mouseup', end)
    window.addEventListener('touchmove', tm, { passive: false })
    window.addEventListener('touchend', end)
    return () => {
      window.removeEventListener('mousemove', mm)
      window.removeEventListener('mouseup', end)
      window.removeEventListener('touchmove', tm)
      window.removeEventListener('touchend', end)
    }
  }, [onMove, onEnd])

  return begin
}

const ROTATION_MS   = 7_000
const PREVIEW_COUNT = 5
const EXPANDED_COUNT = 10

function MobileAlertBanner({ alerts, top }: { alerts: Alert[]; top: number }) {
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

  useLayoutEffect(() => { setIdx(0) }, [alerts])

  const visible = preview[idx]

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        position: 'absolute', top, left: 10, right: 10, zIndex: 20,
        background: 'rgba(234,179,8,0.95)',
        color: '#000',
        borderRadius: 12,
        boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
        cursor: 'pointer',
        userSelect: 'none',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
        fontSize: 11.5, fontWeight: 600,
        opacity: fade ? 1 : 0, transition: 'opacity 0.25s',
      }}>
        <span style={{ fontWeight: 800, flexShrink: 0, fontSize: 10, letterSpacing: '0.5px' }}>⚠ {t('alert')}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{visible?.header}</span>
        {preview.length > 1 && (
          <span style={{ fontSize: 10, flexShrink: 0, opacity: 0.7 }}>
            {idx + 1}/{preview.length} {expanded ? '▲' : '▼'}
          </span>
        )}
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.15)', padding: '4px 14px 10px', maxHeight: 220, overflowY: 'auto' }}>
          {alerts.slice(0, EXPANDED_COUNT).map((a, i) => (
            <div key={i} style={{
              padding: '5px 0',
              borderBottom: i < Math.min(alerts.length, EXPANDED_COUNT) - 1 ? '1px solid rgba(0,0,0,0.12)' : 'none',
              fontSize: 11, lineHeight: 1.4,
            }}>
              <span style={{ fontWeight: 700 }}>{a.header}</span>
              {a.description && (
                <div style={{ opacity: 0.75, marginTop: 2, fontWeight: 400 }}>{a.description}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Swipe-down-to-dismiss detail sheet (train / stop) ────────────────────
function DetailSheet({ open, onClose, maxHeight, children }: {
  open: boolean
  onClose: () => void
  maxHeight: string
  children: React.ReactNode
}) {
  // Live drag offset (px) while the user pulls the sheet down.
  const [drag, setDrag] = useState(0)

  const handleMove = useCallback((deltaY: number) => {
    setDrag(Math.max(0, deltaY)) // only allow pulling downward
  }, [])

  const handleEnd = useCallback((deltaY: number, velocity: number) => {
    // Dismiss on a decent pull or a downward flick; otherwise spring back.
    if (deltaY > 110 || velocity > 650) onClose()
    setDrag(0)
  }, [onClose])

  const beginDrag = useVerticalDrag(handleMove, handleEnd)

  // Reset any residual drag offset when reopened.
  useEffect(() => { if (open) setDrag(0) }, [open])

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, zIndex: 25,
          background: 'rgba(0,0,0,0.5)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.3s',
        }}
      />
      {/* Sheet */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30,
        maxHeight, overflowY: 'auto',
        background: 'var(--bg2)',
        borderRadius: '20px 20px 0 0',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.55)',
        transform: open ? `translateY(${drag}px)` : 'translateY(100%)',
        transition: drag > 0 ? 'none' : 'transform 0.36s cubic-bezier(0.32,1.4,0.5,1)',
        pointerEvents: open ? 'auto' : 'none',
        willChange: 'transform',
        overscrollBehavior: 'contain',
      }}>
        {/* Grabbable handle row — drag down to dismiss, tap to close */}
        <div
          style={{ padding: '12px 0 6px', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
          onMouseDown={e => beginDrag(e.clientY)}
          onTouchStart={e => beginDrag(e.touches[0].clientY)}
          onClick={onClose}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border2)', margin: '0 auto' }} />
        </div>
        {children}
      </div>
    </>
  )
}

export function MobileLayout({
  trains, stops, routes, alerts, lines, lineColors,
  activeLines, selectedTrain, selectedStop,
  refreshing, lastUpdate, apiError, theme,
  onToggleLine, onSelectTrain, onSelectStop,
  onCloseTrain, onCloseStop, onRefresh, onThemeToggle,
}: MobileLayoutProps) {
  const { t } = useI18n()
  const [sheetRatio, setSheetRatio]     = useState(SNAP_PEEK)
  const [activeTab, setActiveTab]       = useState<'trains' | 'stations' | 'plan'>('trains')
  const [selectedJourney, setSelectedJourney] = useState<Journey | null>(null)

  const journeyPath = useMemo(
    () => selectedJourney && stops.length > 0
      ? buildJourneyPath(selectedJourney, routes, stops, lineColors)
      : null,
    [selectedJourney, routes, stops, lineColors],
  )
  const [stationQuery, setStationQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  // The sheet height the current drag started from (so deltas are absolute).
  const dragBase = useRef(SNAP_PEEK)

  const relativeTime = useRelativeTime(lastUpdate)

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])

  const lineGroups = LINE_GROUPS.map(g => ({
    ...g,
    members: lines.filter(l => g.prefix.test(l)),
  })).filter(g => g.members.length > 0)

  const filteredTrains = activeLines.has('ALL')
    ? trains
    : trains.filter(t => activeLines.has(t.line))

  const filteredStops = stationQuery
    ? Array.from(
        new Map(
          stops
            .filter(s => s.name.toLowerCase().includes(stationQuery.toLowerCase()))
            .map(s => [s.name, s]),
        ).values(),
      ).slice(0, 12)
    : []

  // ── Sheet drag (handle + tab row are both grab targets) ──
  const onSheetMove = useCallback((deltaY: number) => {
    const vh = window.innerHeight
    // Dragging up (negative deltaY) raises the sheet.
    const next = Math.max(SNAP_PEEK - 0.03, Math.min(SNAP_FULL + 0.03, dragBase.current - deltaY / vh))
    setSheetRatio(next)
  }, [])

  const onSheetEnd = useCallback((deltaY: number, velocityPxPerS: number) => {
    const vh = window.innerHeight
    const ratioVel = -velocityPxPerS / vh // up = positive (expanding)
    const landed = dragBase.current - deltaY / vh
    setSheetRatio(resolveSnap(landed, ratioVel))
  }, [])

  const beginSheetDrag = useVerticalDrag(onSheetMove, onSheetEnd)
  const startSheetDrag = useCallback((clientY: number) => {
    dragBase.current = sheetRatio
    beginSheetDrag(clientY)
  }, [sheetRatio, beginSheetDrag])

  const expandSheet = useCallback(() => {
    setSheetRatio(r => (r < SNAP_HALF ? SNAP_HALF : r))
  }, [])

  const sheetHeight = `${(sheetRatio * 100).toFixed(2)}vh`

  const TABS = [
    { key: 'trains'   as const, label: `${t('tabTrains')}` },
    { key: 'stations' as const, label: t('tabStations') },
    { key: 'plan'     as const, label: t('tabPlan') },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Floating top bar ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 12px 18px',
        background: 'linear-gradient(to bottom, var(--bg) 45%, transparent)',
        pointerEvents: 'none',
      }}>
        <div style={{
          pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 7,
          background: 'var(--bg2)', border: '1px solid var(--border)',
          padding: '6px 12px 6px 10px', borderRadius: 22,
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        }}>
          <img src="/logo.svg" alt="" style={{ width: 22, height: 22, borderRadius: 5 }} />
          <span style={{ fontFamily: 'var(--font-space-grotesk), sans-serif', fontSize: 15, fontWeight: 700 }}>Geotren</span>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', marginLeft: 1, animation: 'pulse-dot 1.6s infinite' }} />
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 7, pointerEvents: 'auto' }}>
          <LanguagePicker compact />
          <button
            onClick={onThemeToggle}
            aria-label={t('theme')}
            style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--muted)', width: 38, height: 38, borderRadius: 12, cursor: 'pointer', fontSize: 15, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={t('refresh')}
            style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: refreshing ? 'var(--accent)' : 'var(--muted)', height: 38, padding: '0 12px', borderRadius: 12, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5, boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}
          >
            <span style={{ display: 'inline-block', fontSize: 13, animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }}>↻</span>
            {!refreshing && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{relativeTime}</span>}
          </button>
        </div>
      </div>

      {/* ── Alert / error banner ── */}
      {apiError && (
        <div style={{
          position: 'absolute', top: 58, left: 10, right: 10, zIndex: 20,
          background: 'rgba(239,68,68,0.95)', borderRadius: 12,
          color: '#fff', fontSize: 11.5, fontWeight: 600, padding: '8px 14px',
          display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
        }}>
          <span style={{ fontWeight: 800, fontSize: 10 }}>ERROR</span>
          {apiError}
        </div>
      )}
      {!apiError && alerts.length > 0 && (
        <MobileAlertBanner alerts={alerts} top={58} />
      )}

      {/* ── Full-screen map ── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapView
          trains={filteredTrains}
          stops={stops}
          routes={routes}
          lineColors={lineColors}
          selectedTrain={selectedTrain}
          selectedStop={selectedStop}
          onSelectTrain={t => { onSelectTrain(t); setSheetRatio(SNAP_PEEK) }}
          onSelectStop={s => { onSelectStop(s); setSheetRatio(SNAP_PEEK) }}
          onCloseStop={onCloseStop}
          journeyPath={journeyPath}
          theme={theme}
        />
      </div>

      {/* ── Bottom sheet ── */}
      <div
        style={{
          position: 'absolute',
          left: 0, right: 0, bottom: 0,
          height: sheetHeight,
          background: 'var(--bg2)',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -6px 34px rgba(0,0,0,0.4)',
          border: '1px solid var(--border)',
          borderBottom: 'none',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10,
          transition: 'height 0.32s cubic-bezier(0.32,1.2,0.5,1)',
          willChange: 'height',
        }}
      >
        {/* Grab zone: handle + segmented tabs both initiate a drag */}
        <div
          style={{ flexShrink: 0, touchAction: 'none', cursor: 'grab', paddingTop: 8 }}
          onMouseDown={e => startSheetDrag(e.clientY)}
          onTouchStart={e => startSheetDrag(e.touches[0].clientY)}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border2)', margin: '0 auto 8px' }} />

          {/* Segmented tab control */}
          <div style={{ display: 'flex', gap: 4, margin: '0 12px 8px', padding: 3, background: 'var(--bg3)', borderRadius: 12 }}>
            {TABS.map(tab => {
              const active = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  // Don't start a drag from the tap that switches tabs.
                  onMouseDown={e => e.stopPropagation()}
                  onTouchStart={e => e.stopPropagation()}
                  onClick={() => { setActiveTab(tab.key); expandSheet(); if (tab.key === 'trains') setStationQuery('') }}
                  style={{
                    flex: 1, padding: '8px 0', border: 'none', borderRadius: 9, cursor: 'pointer',
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#fff' : 'var(--muted)',
                    fontWeight: 700, fontSize: 12, fontFamily: 'inherit',
                    letterSpacing: '0.2px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {tab.label}
                  {tab.key === 'trains' && (
                    <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.85, background: active ? 'rgba(255,255,255,0.22)' : 'var(--bg2)', padding: '1px 6px', borderRadius: 8 }}>
                      {filteredTrains.length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Line filter — grouped by family (hidden on the planner tab) */}
        {activeTab !== 'plan' && (
          <div style={{ padding: '2px 12px 6px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
            <div style={{ overflowX: 'auto', display: 'flex', gap: 6, paddingBottom: expandedGroups.size ? 6 : 0, scrollbarWidth: 'none' }}>
              <span
                onClick={() => onToggleLine('ALL')}
                style={{ flexShrink: 0, padding: '5px 13px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${activeLines.has('ALL') ? 'var(--text)' : 'transparent'}`, background: 'var(--bg3)', color: 'var(--text)', opacity: activeLines.has('ALL') ? 1 : 0.5, fontFamily: 'var(--font-space-grotesk), sans-serif' }}
              >
                {t('all')}
              </span>
              {lineGroups.map(g => {
                const expanded = expandedGroups.has(g.key)
                const anyActive = !activeLines.has('ALL') && g.members.some(l => activeLines.has(l))
                return (
                  <span
                    key={g.key}
                    onClick={() => toggleGroup(g.key)}
                    style={{ flexShrink: 0, padding: '5px 11px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${anyActive ? 'var(--accent)' : expanded ? 'var(--border2)' : 'transparent'}`, background: anyActive ? 'rgba(59,130,246,0.14)' : 'var(--bg3)', color: anyActive ? 'var(--accent)' : 'var(--muted)', fontFamily: 'var(--font-space-grotesk), sans-serif' }}
                  >
                    {t(g.labelKey)} {expanded ? '▲' : '▼'}
                  </span>
                )
              })}
            </div>
            {lineGroups.filter(g => expandedGroups.has(g.key)).map(g => (
              <div key={g.key} style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingTop: 2, paddingBottom: 4 }}>
                {g.members.map(l => {
                  const active = activeLines.has(l)
                  const color = lineColors[l] || LINE_COLORS[l] || '#7a82a0'
                  return (
                    <span
                      key={l}
                      onClick={() => onToggleLine(l)}
                      style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${active ? color : 'transparent'}`, background: `${color}20`, color, opacity: active ? 1 : 0.5, fontFamily: 'var(--font-space-grotesk), sans-serif' }}
                    >
                      {l}
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: activeTab === 'plan' ? 'hidden' : 'auto', display: activeTab === 'plan' ? 'flex' : 'block', flexDirection: 'column', padding: activeTab === 'plan' ? 0 : '8px 12px 28px', overscrollBehavior: 'contain' }}>
          {activeTab === 'plan' ? (
            <TripPlanner
              lineColors={lineColors}
              selectedJourney={selectedJourney}
              onSelectJourney={j => { setSelectedJourney(j); if (j) setSheetRatio(SNAP_HALF) }}
            />
          ) : activeTab === 'trains' ? (
            filteredTrains.length === 0
              ? <p style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 12 }}>{t('noActiveTrains')}</p>
              : filteredTrains.map(t => (
                  <TrainCard
                    key={t.id}
                    train={t}
                    selected={selectedTrain?.id === t.id}
                    onClick={() => { onSelectTrain(t); setSheetRatio(SNAP_PEEK); setStationQuery('') }}
                    lineColors={lineColors}
                  />
                ))
          ) : (
            <div>
              <input
                type="text"
                value={stationQuery}
                onChange={e => setStationQuery(e.target.value)}
                placeholder={t('searchStationShort')}
                style={{ width: '100%', padding: '11px 13px', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 10, color: 'var(--text)', fontFamily: 'inherit', fontSize: 14, outline: 'none', marginBottom: 8 }}
              />
              {filteredStops.map(s => (
                <div
                  key={s.stopId}
                  onClick={() => { onSelectStop(s); setStationQuery(s.name); setSheetRatio(SNAP_PEEK) }}
                  style={{ padding: '12px 13px', borderRadius: 10, marginBottom: 5, cursor: 'pointer', background: 'var(--bg3)', fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span>{s.name}</span>
                  {s.wheelchairBoarding && <span style={{ fontSize: 13, color: 'var(--accent)' }}>♿</span>}
                </div>
              ))}
              {stationQuery && filteredStops.length === 0 && (
                <p style={{ color: 'var(--muted)', fontSize: 13, padding: '8px 2px' }}>{t('noStationFound')}</p>
              )}
              {!stationQuery && (
                <p style={{ color: 'var(--muted)', fontSize: 13, padding: '8px 2px' }}>{t('typeStationName')}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Train detail ── */}
      <DetailSheet open={selectedTrain !== null} onClose={onCloseTrain} maxHeight="86vh">
        <DetailPanel train={selectedTrain} lineColors={lineColors} onClose={onCloseTrain} mobile />
      </DetailSheet>

      {/* ── Stop detail ── */}
      <DetailSheet open={selectedStop !== null && selectedTrain === null} onClose={onCloseStop} maxHeight="80vh">
        <StopPanel stop={selectedStop} onClose={onCloseStop} lineColors={lineColors} mobile />
      </DetailSheet>
    </div>
  )
}
