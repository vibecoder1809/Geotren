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
import { NearMeButton } from './NearMeButton'
import { LanguagePicker } from './Header'
import { isPlannerLink } from '@/lib/urlState'
import { useI18n, type TransKey } from '@/lib/i18n'

const LINE_GROUPS: { key: string; labelKey: TransKey; prefix: RegExp }[] = [
  { key: 'L', labelKey: 'groupUrbanShort',    prefix: /^L/ },
  { key: 'S', labelKey: 'groupVallesShort',   prefix: /^S/ },
  { key: 'R', labelKey: 'groupRegionalShort', prefix: /^R/ },
  { key: 'Other', labelKey: 'groupOther',     prefix: /^(?!L|S|R)/ },
]

function useRelativeTime(lastUpdate: Date | null): string {
  const { t } = useI18n()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!lastUpdate) return '—'
  const secs = Math.round((now - lastUpdate.getTime()) / 1000)
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
// (positive = expanding upward); `max` is the ceiling from `useSheetCeiling`.
function resolveSnap(ratio: number, velocity: number, max: number): number {
  const FLICK = 0.6
  const snaps = SNAPS.map(s => Math.min(s, max))
  const nearestIdx = snaps.reduce(
    (best, _, i) => (Math.abs(snaps[i] - ratio) < Math.abs(snaps[best] - ratio) ? i : best),
    0,
  )
  if (velocity > FLICK && nearestIdx < snaps.length - 1) return snaps[nearestIdx + 1]
  if (velocity < -FLICK && nearestIdx > 0) return snaps[nearestIdx - 1]
  return snaps[nearestIdx]
}

// ── Sheet ceiling ────────────────────────────────────────────────────────
// The floating top bar is painted *over* the sheets (zIndex 35 vs 10), so a
// sheet tall enough to reach it tucks its own grab handle behind the pills —
// and the pills swallow the touch, so the sheet can't be dragged back down.
// How far down the bar reaches depends on the notch inset, so measure it
// instead of guessing a snap fraction, and cap every sheet just below it.
const SHEET_TOP_GAP = 10

function useSheetCeiling(
  rootRef: React.RefObject<HTMLDivElement | null>,
  barRef: React.RefObject<HTMLDivElement | null>,
): number {
  const [ceiling, setCeiling] = useState(SNAP_FULL)

  useLayoutEffect(() => {
    const root = rootRef.current
    const bar = barRef.current
    if (!root || !bar) return

    const measure = () => {
      const vh = root.clientHeight
      if (!vh) return
      const rootTop = root.getBoundingClientRect().top
      // Only the bar's pills are opaque and clickable — its own bottom padding
      // is a transparent gradient tail the sheet may safely slide under.
      const pillsBottom = Array.from(bar.children).reduce(
        (bottom, el) => Math.max(bottom, el.getBoundingClientRect().bottom - rootTop),
        0,
      )
      setCeiling(Math.max(SNAP_HALF, Math.min(SNAP_FULL, 1 - (pillsBottom + SHEET_TOP_GAP) / vh)))
    }

    measure()
    // The bar grows with the safe-area inset on rotation, and the root resizes
    // whenever mobile browser chrome (URL bar) slides in or out. Watch the
    // *border* box: the inset lands on the bar's padding, which leaves its
    // content box (and so a default ResizeObserver) completely unmoved.
    const ro = new ResizeObserver(measure)
    ro.observe(root, { box: 'border-box' })
    ro.observe(bar, { box: 'border-box' })
    return () => ro.disconnect()
  }, [rootRef, barRef])

  return ceiling
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

function MobileAlertBanner({ alerts, top }: { alerts: Alert[]; top: string }) {
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

  // Restart the rotation only when the alert *content* changes — the array
  // identity changes on every poll, which used to reset to the first alert.
  const fingerprint = preview.map(a => a.header).join('|')
  useLayoutEffect(() => { setIdx(0) }, [fingerprint])

  // Clamp in case the alert list shrank under the current index.
  const visible = preview[idx % preview.length]

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

// ── Detail sheet (train / stop) ──────────────────────────────────────────
// Opens at a peek height so the map stays visible and interactive behind it;
// dragging the handle up expands it toward `full`, and only that expansion
// dims the map. Drag down to fall back to the peek or dismiss.
function DetailSheet({ open, onClose, peek = 0.28, full: fullSnap = 0.86, max = 1, children }: {
  open: boolean
  onClose: () => void
  peek?: number   // opening snap, as a fraction of the container height
  full?: number   // expanded snap
  max?: number    // hard ceiling — keeps the handle clear of the top bar
  children: React.ReactNode
}) {
  const full = Math.min(fullSnap, max)
  const [ratio, setRatio]       = useState(peek)
  const [dragging, setDragging] = useState(false)
  const sheetRef                = useRef<HTMLDivElement>(null)
  // The sheet height the current drag started from (so deltas are absolute).
  const dragBase                = useRef(peek)
  // Whether the last pointer interaction actually dragged — a spring-back drag
  // must not fire the handle's tap-to-toggle (the click lands after mouseup).
  const moved = useRef(false)

  const viewH = () => sheetRef.current?.parentElement?.clientHeight || window.innerHeight

  const handleMove = useCallback((deltaY: number) => {
    // Dragging up (negative deltaY) raises the sheet. A little overshoot past
    // `full` is allowed, but never past the ceiling.
    setRatio(Math.max(0.05, Math.min(Math.min(full + 0.03, max), dragBase.current - deltaY / viewH())))
  }, [full, max])

  const handleEnd = useCallback((deltaY: number, velocityPxPerS: number) => {
    moved.current = Math.abs(deltaY) > 6
    setDragging(false)
    const vh = viewH()
    const velRatio = -velocityPxPerS / vh // up = positive (expanding)
    const landed = dragBase.current - deltaY / vh
    const FLICK = 0.6
    if (velRatio > FLICK) setRatio(full)
    // A downward flick falls back one level: full → peek, peek → dismissed.
    else if (velRatio < -FLICK) {
      if (dragBase.current > (peek + full) / 2) setRatio(peek)
      else onClose()
    }
    else if (landed < peek * 0.6) onClose() // pulled well below the peek
    else setRatio(landed < (peek + full) / 2 ? peek : full)
  }, [onClose, peek, full])

  const beginDrag = useVerticalDrag(handleMove, handleEnd)
  const startDrag = useCallback((clientY: number) => {
    dragBase.current = ratio
    moved.current = false
    setDragging(true)
    beginDrag(clientY)
  }, [ratio, beginDrag])

  // (Re)open at the peek height.
  useEffect(() => { if (open) setRatio(peek) }, [open, peek])

  // Tap the handle to toggle peek ↔ full (a real drag suppresses the click).
  const toggle = useCallback(() => {
    if (moved.current) return
    setRatio(r => (r < (peek + full) / 2 ? full : peek))
  }, [peek, full])

  // Expansion beyond the peek (0..1) — drives the map-dimming scrim.
  const expand = Math.max(0, Math.min(1, (ratio - peek) / (full - peek)))

  return (
    <>
      {/* Scrim — transparent and click-through at the peek so the map stays
          usable; darkens with expansion. Tap it to dismiss when expanded. */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, zIndex: 25,
          background: 'rgba(0,0,0,0.5)',
          opacity: open ? expand : 0,
          pointerEvents: open && expand > 0.4 ? 'auto' : 'none',
          transition: dragging ? 'none' : 'opacity 0.3s',
        }}
      />
      {/* Sheet */}
      <div ref={sheetRef} style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30,
        height: `${(ratio * 100).toFixed(2)}%`, overflowY: 'auto',
        background: 'var(--bg2)',
        borderRadius: '20px 20px 0 0',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.55)',
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition: dragging ? 'none' : 'transform 0.36s cubic-bezier(0.32,1.4,0.5,1), height 0.3s cubic-bezier(0.32,1.2,0.5,1)',
        pointerEvents: open ? 'auto' : 'none',
        willChange: 'transform, height',
        overscrollBehavior: 'contain',
      }}>
        {/* Grabbable handle row — drag to resize, tap to toggle. Sticky so it
            stays reachable when the sheet content is scrolled. */}
        <div
          style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg2)', borderRadius: '20px 20px 0 0', padding: '12px 0 6px', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
          onMouseDown={e => startDrag(e.clientY)}
          onTouchStart={e => startDrag(e.touches[0].clientY)}
          onClick={toggle}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border2)', margin: '0 auto' }} />
        </div>
        {/* Keep content clear of the home-indicator area on notched phones. */}
        <div style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {children}
        </div>
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
  const rootRef = useRef<HTMLDivElement>(null)
  const topBarRef = useRef<HTMLDivElement>(null)
  // Tallest the sheets may grow without hiding their handle under the top bar.
  const sheetCeiling = useSheetCeiling(rootRef, topBarRef)
  const [sheetRatio, setSheetRatio]     = useState(SNAP_PEEK)
  // Transition is disabled while dragging so the sheet tracks the finger
  // instead of easing toward it.
  const [sheetDragging, setSheetDragging] = useState(false)
  const [activeTab, setActiveTab]       = useState<'trains' | 'stations' | 'plan'>('trains')
  const [selectedJourney, setSelectedJourney] = useState<Journey | null>(null)

  const journeyPath = useMemo(
    () => selectedJourney && stops.length > 0
      ? buildJourneyPath(selectedJourney, routes, stops, lineColors)
      : null,
    [selectedJourney, routes, stops, lineColors],
  )

  // Stable identity (setters are stable) so TripPlanner's memoised search() and
  // its effects don't see a new callback every render — an inline arrow here
  // was the root of the "Anar a…" freeze.
  const handleSelectJourney = useCallback((j: Journey | null) => {
    setSelectedJourney(j)
    if (j) setSheetRatio(SNAP_HALF)
  }, [])
  const [stationQuery, setStationQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  // The sheet height the current drag started from (so deltas are absolute).
  const dragBase = useRef(SNAP_PEEK)

  const relativeTime = useRelativeTime(lastUpdate)

  // Arriving via a shared planner link: open the Plan tab and raise the sheet
  // so the restored journey is visible. Effect (not initial state) avoids an
  // SSR/hydration mismatch.
  useEffect(() => {
    if (isPlannerLink()) { setActiveTab('plan'); setSheetRatio(SNAP_HALF) }
  }, [])

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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
  // Ratios are relative to the app container, not `vh` — mobile browser chrome
  // (URL bar) makes `vh` overflow the visible viewport.
  const viewH = () => rootRef.current?.clientHeight || window.innerHeight
  // Whether the last pointer interaction was a real drag (vs a tap).
  const sheetMoved = useRef(false)

  const onSheetMove = useCallback((deltaY: number) => {
    const vh = viewH()
    // Dragging up (negative deltaY) raises the sheet, but never past the
    // ceiling — the handle has to stay below the top bar to stay grabbable.
    const next = Math.max(SNAP_PEEK - 0.03, Math.min(sheetCeiling, dragBase.current - deltaY / vh))
    setSheetRatio(next)
  }, [sheetCeiling])

  const onSheetEnd = useCallback((deltaY: number, velocityPxPerS: number) => {
    const vh = viewH()
    sheetMoved.current = Math.abs(deltaY) > 6
    setSheetDragging(false)
    const ratioVel = -velocityPxPerS / vh // up = positive (expanding)
    const landed = dragBase.current - deltaY / vh
    setSheetRatio(resolveSnap(landed, ratioVel, sheetCeiling))
  }, [sheetCeiling])

  const beginSheetDrag = useVerticalDrag(onSheetMove, onSheetEnd)
  const startSheetDrag = useCallback((clientY: number) => {
    dragBase.current = sheetRatio
    sheetMoved.current = false
    setSheetDragging(true)
    beginSheetDrag(clientY)
  }, [sheetRatio, beginSheetDrag])

  // Tapping the handle toggles peek ↔ half (a real drag suppresses the click).
  const toggleSheet = useCallback(() => {
    if (sheetMoved.current) return
    setSheetRatio(r => (r < SNAP_HALF ? SNAP_HALF : SNAP_PEEK))
  }, [])

  const expandSheet = useCallback(() => {
    setSheetRatio(r => (r < SNAP_HALF ? SNAP_HALF : r))
  }, [])

  // Typing needs the keyboard *and* the results visible: raise the sheet as
  // high as it goes whenever any input inside it gains focus.
  const onSheetFocus = useCallback((e: React.FocusEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') setSheetRatio(sheetCeiling)
  }, [sheetCeiling])

  // Frame journey fits above the sheet, which sits at half snap after a
  // journey is selected (uniform padding would hide the path behind it).
  const fitPadding = useMemo(() => ({
    top: 90, left: 40, right: 40,
    bottom: Math.round((typeof window === 'undefined' ? 800 : window.innerHeight) * (SNAP_HALF + 0.06)),
  }), [])

  const sheetHeight = `${(sheetRatio * 100).toFixed(2)}%`

  const TABS = [
    { key: 'trains'   as const, label: `${t('tabTrains')}` },
    { key: 'stations' as const, label: t('tabStations') },
    { key: 'plan'     as const, label: t('tabPlan') },
  ]

  return (
    <div ref={rootRef} style={{ position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Floating top bar ── */}
      <div ref={topBarRef} style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 35,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 12px 18px',
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
          <span style={{ fontFamily: 'var(--font-space-grotesk), sans-serif', fontSize: 15, fontWeight: 700 }}>Andana</span>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', marginLeft: 1, animation: 'pulse-dot 1.6s infinite' }} />
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 7, pointerEvents: 'auto' }}>
          {/* Nearest station → opens its detail sheet with live departures. */}
          <NearMeButton stops={stops} onPick={s => { onSelectStop(s); setSheetRatio(SNAP_PEEK) }} compact />
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
      {/* Fades out when the sheet is raised near-full: the floating banner
          would otherwise sit exactly over the sheet's grab handle and swallow
          its touches, locking the sheet up. The map it annotates is covered
          by the sheet at that point anyway. */}
      <div style={{ position: 'relative', zIndex: 20, opacity: sheetRatio > 0.75 ? 0 : 1, pointerEvents: sheetRatio > 0.75 ? 'none' : 'auto', transition: 'opacity 0.25s' }}>
        {apiError && (
          <div style={{
            position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 58px)', left: 10, right: 10,
            background: 'rgba(239,68,68,0.95)', borderRadius: 12,
            color: '#fff', fontSize: 11.5, fontWeight: 600, padding: '8px 14px',
            display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
          }}>
            <span style={{ fontWeight: 800, fontSize: 10 }}>ERROR</span>
            {apiError}
          </div>
        )}
        {!apiError && alerts.length > 0 && (
          <MobileAlertBanner alerts={alerts} top="calc(env(safe-area-inset-top, 0px) + 58px)" />
        )}
      </div>

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
          // Tap (not drag) on empty map deselects whatever's focused.
          onBackgroundClick={() => { onCloseTrain(); onCloseStop() }}
          journeyPath={journeyPath}
          theme={theme}
          fitPadding={fitPadding}
        />
      </div>

      {/* ── Bottom sheet ── */}
      <div
        onFocusCapture={onSheetFocus}
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
          transition: sheetDragging ? 'none' : 'height 0.32s cubic-bezier(0.32,1.2,0.5,1)',
          willChange: 'height',
        }}
      >
        {/* Grab zone: handle + segmented tabs both initiate a drag */}
        <div
          style={{ flexShrink: 0, touchAction: 'none', cursor: 'grab' }}
          onMouseDown={e => startSheetDrag(e.clientY)}
          onTouchStart={e => startSheetDrag(e.touches[0].clientY)}
        >
          {/* Handle strip — also a tap target that toggles peek ↔ half */}
          <div onClick={toggleSheet} style={{ padding: '10px 0 8px' }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border2)', margin: '0 auto' }} />
          </div>

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

        {/* Scrollable content (bottom padding keeps it clear of the home indicator) */}
        <div style={{ flex: 1, overflowY: activeTab === 'plan' ? 'hidden' : 'auto', display: activeTab === 'plan' ? 'flex' : 'block', flexDirection: 'column', padding: activeTab === 'plan' ? '0 0 env(safe-area-inset-bottom, 0px)' : '8px 12px calc(28px + env(safe-area-inset-bottom, 0px))', overscrollBehavior: 'contain' }}>
          {activeTab === 'plan' ? (
            <TripPlanner
              lineColors={lineColors}
              selectedJourney={selectedJourney}
              onSelectJourney={handleSelectJourney}
              stops={stops}
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
      <DetailSheet open={selectedTrain !== null} onClose={onCloseTrain} full={0.86} max={sheetCeiling}>
        <DetailPanel train={selectedTrain} lineColors={lineColors} onClose={onCloseTrain} mobile />
      </DetailSheet>

      {/* ── Stop detail ── */}
      <DetailSheet open={selectedStop !== null && selectedTrain === null} onClose={onCloseStop} full={0.8} max={sheetCeiling}>
        <StopPanel stop={selectedStop} onClose={onCloseStop} lineColors={lineColors} mobile trains={filteredTrains} onSelectTrain={onSelectTrain} />
      </DetailSheet>
    </div>
  )
}
