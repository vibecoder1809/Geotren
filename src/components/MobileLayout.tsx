'use client'

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import dynamic from 'next/dynamic'
import type { Train, Stop, Alert, Route, Theme } from '@/types'
import { LINE_COLORS } from '@/lib/constants'
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

// Sheet snap positions as % of viewport height from bottom
const SNAP_PEEK  = 0.13  // handle + 1 train card peeking
const SNAP_HALF  = 0.45  // half screen
const SNAP_FULL  = 0.88  // almost full

function snapNearest(ratio: number): number {
  const snaps = [SNAP_PEEK, SNAP_HALF, SNAP_FULL]
  return snaps.reduce((a, b) => Math.abs(b - ratio) < Math.abs(a - ratio) ? b : a)
}

const ROTATION_MS   = 7_000
const PREVIEW_COUNT = 5
const EXPANDED_COUNT = 10

function MobileAlertBanner({ alerts }: { alerts: Alert[] }) {
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
        position: 'absolute', top: 48, left: 0, right: 0, zIndex: 20,
        background: 'rgba(234,179,8,0.92)',
        color: '#000',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px',
        fontSize: 11, fontWeight: 600,
        opacity: fade ? 1 : 0, transition: 'opacity 0.25s',
      }}>
        <span style={{ fontWeight: 700, flexShrink: 0 }}>{t('alert')}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{visible?.header}</span>
        {preview.length > 1 && (
          <span style={{ fontSize: 10, flexShrink: 0, opacity: 0.7 }}>
            {idx + 1}/{preview.length} {expanded ? '▲' : '▼'}
          </span>
        )}
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.15)', padding: '4px 14px 8px', maxHeight: 220, overflowY: 'auto' }}>
          {alerts.slice(0, EXPANDED_COUNT).map((a, i) => (
            <div key={i} style={{
              padding: '4px 0',
              borderBottom: i < Math.min(alerts.length, EXPANDED_COUNT) - 1 ? '1px solid rgba(0,0,0,0.1)' : 'none',
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
  const [stationQuery, setStationQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const dragStart = useRef<{ y: number; ratio: number } | null>(null)

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

  // Drag handlers for the sheet handle
  const onDragStart = useCallback((clientY: number) => {
    dragStart.current = { y: clientY, ratio: sheetRatio }
  }, [sheetRatio])

  const onDragMove = useCallback((clientY: number) => {
    if (!dragStart.current) return
    const vh = window.innerHeight
    const delta = (dragStart.current.y - clientY) / vh
    const next = Math.max(SNAP_PEEK - 0.02, Math.min(SNAP_FULL + 0.02, dragStart.current.ratio + delta))
    setSheetRatio(next)
  }, [])

  const onDragEnd = useCallback(() => {
    if (!dragStart.current) return
    setSheetRatio(snapNearest(sheetRatio))
    dragStart.current = null
  }, [sheetRatio])

  const sheetHeight = `${Math.round(sheetRatio * 100)}vh`

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* Compact top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        background: 'linear-gradient(to bottom, var(--bg) 60%, transparent)',
        pointerEvents: 'none',
      }}>
        <div style={{ pointerEvents: 'auto', fontFamily: 'var(--font-space-grotesk), sans-serif', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: 'pulse-dot 2s infinite' }} />
          Geotren
        </div>

        <div style={{ pointerEvents: 'auto', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: 'var(--green)', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse-dot 1.5s infinite' }} />
          {t('live')}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, pointerEvents: 'auto' }}>
          <LanguagePicker compact />
          <button
            onClick={onThemeToggle}
            style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--muted)', padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}
          >
            {t('theme')}
          </button>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', color: refreshing ? 'var(--accent)' : 'var(--muted)', padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}
          >
            {refreshing ? '…' : relativeTime}
          </button>
        </div>
      </div>

      {/* Alert banner */}
      {apiError && (
        <div style={{
          position: 'absolute', top: 48, left: 0, right: 0, zIndex: 20,
          background: 'rgba(239,68,68,0.9)',
          color: '#fff', fontSize: 11, fontWeight: 600, padding: '5px 14px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontWeight: 700 }}>ERROR</span>
          {apiError}
        </div>
      )}
      {!apiError && alerts.length > 0 && (
        <MobileAlertBanner alerts={alerts} />
      )}

      {/* Full-screen map */}
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
          theme={theme}
        />
      </div>

      {/* Bottom sheet */}
      <div
        style={{
          position: 'absolute',
          left: 0, right: 0, bottom: 0,
          height: sheetHeight,
          background: 'var(--bg2)',
          borderRadius: '18px 18px 0 0',
          boxShadow: '0 -4px 30px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10,
          transition: dragStart.current ? 'none' : 'height 0.3s cubic-bezier(0.34,1.56,0.64,1)',
          willChange: 'height',
        }}
      >
        {/* Drag handle */}
        <div
          style={{ padding: '10px 0 4px', flexShrink: 0, cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
          onMouseDown={e => onDragStart(e.clientY)}
          onMouseMove={e => { if (dragStart.current) onDragMove(e.clientY) }}
          onMouseUp={onDragEnd}
          onMouseLeave={onDragEnd}
          onTouchStart={e => onDragStart(e.touches[0].clientY)}
          onTouchMove={e => { e.preventDefault(); onDragMove(e.touches[0].clientY) }}
          onTouchEnd={onDragEnd}
        >
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border2)', margin: '0 auto' }} />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {(['trains', 'stations', 'plan'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); if (sheetRatio < SNAP_HALF) setSheetRatio(SNAP_HALF); if (tab === 'trains') setStationQuery('') }}
              style={{
                flex: 1, padding: '10px 0', border: 'none', background: 'none',
                color: activeTab === tab ? 'var(--accent)' : 'var(--muted)',
                fontWeight: 600, fontSize: 12, cursor: 'pointer',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'inherit',
              }}
            >
              {tab === 'trains' ? `${t('tabTrains')} (${filteredTrains.length})` : tab === 'stations' ? t('tabStations') : t('tabPlan')}
            </button>
          ))}
        </div>

        {/* Line filter — grouped by family (hidden on the planner tab) */}
        {activeTab !== 'plan' && <div style={{ padding: '6px 14px 4px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
          {/* "All" pill + group header pills on one scrollable row */}
          <div style={{ overflowX: 'auto', display: 'flex', gap: 6, paddingBottom: 6, scrollbarWidth: 'none' }}>
            <span
              onClick={() => onToggleLine('ALL')}
              style={{ flexShrink: 0, padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${activeLines.has('ALL') ? 'var(--text)' : 'transparent'}`, background: 'var(--bg3)', color: 'var(--text)', opacity: activeLines.has('ALL') ? 1 : 0.5, fontFamily: 'var(--font-space-grotesk), sans-serif' }}
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
                  style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${anyActive ? 'var(--accent)' : expanded ? 'var(--border2)' : 'transparent'}`, background: anyActive ? 'rgba(99,102,241,0.12)' : 'var(--bg3)', color: anyActive ? 'var(--accent)' : 'var(--muted)', fontFamily: 'var(--font-space-grotesk), sans-serif' }}
                >
                  {t(g.labelKey)} {expanded ? '▲' : '▼'}
                </span>
              )
            })}
          </div>
          {/* Expanded group lines */}
          {lineGroups.filter(g => expandedGroups.has(g.key)).map(g => (
            <div key={g.key} style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingBottom: 6 }}>
              {g.members.map(l => {
                const active = activeLines.has(l)
                const color = lineColors[l] || LINE_COLORS[l] || '#7a82a0'
                return (
                  <span
                    key={l}
                    onClick={() => onToggleLine(l)}
                    style={{ padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${active ? color : 'transparent'}`, background: `${color}20`, color, opacity: active ? 1 : 0.5, fontFamily: 'var(--font-space-grotesk), sans-serif' }}
                  >
                    {l}
                  </span>
                )
              })}
            </div>
          ))}
        </div>}

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: activeTab === 'plan' ? 'hidden' : 'auto', display: activeTab === 'plan' ? 'flex' : 'block', flexDirection: 'column', padding: activeTab === 'plan' ? 0 : '0 10px 24px' }}>
          {activeTab === 'plan' ? (
            <TripPlanner lineColors={lineColors} />
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
            <div style={{ paddingTop: 4 }}>
              <input
                type="text"
                value={stationQuery}
                onChange={e => setStationQuery(e.target.value)}
                placeholder={t('searchStationShort')}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, outline: 'none', marginBottom: 8 }}
              />
              {filteredStops.map(s => (
                <div
                  key={s.stopId}
                  onClick={() => { onSelectStop(s); setStationQuery(s.name); setSheetRatio(SNAP_PEEK) }}
                  style={{ padding: '10px 12px', borderRadius: 8, marginBottom: 4, cursor: 'pointer', background: 'var(--bg3)', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span>{s.name}</span>
                  {s.wheelchairBoarding && <span style={{ fontSize: 12, color: 'var(--accent)' }}>♿</span>}
                </div>
              ))}
              {stationQuery && filteredStops.length === 0 && (
                <p style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 0' }}>{t('noStationFound')}</p>
              )}
              {!stationQuery && (
                <p style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 0' }}>{t('typeStationName')}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Train detail — slides up from bottom */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30,
        maxHeight: '85vh', overflowY: 'auto',
        background: 'var(--bg2)',
        borderRadius: '18px 18px 0 0',
        boxShadow: '0 -4px 30px rgba(0,0,0,0.5)',
        transform: selectedTrain ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)',
        pointerEvents: selectedTrain ? 'auto' : 'none',
      }}>
        {/* Drag-down to close hint */}
        <div style={{ padding: '10px 0 0', cursor: 'pointer' }} onClick={onCloseTrain}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border2)', margin: '0 auto' }} />
        </div>
        <DetailPanel train={selectedTrain} lineColors={lineColors} onClose={onCloseTrain} />
      </div>

      {/* Stop detail — slides up from bottom */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30,
        maxHeight: '75vh', overflowY: 'auto',
        background: 'var(--bg2)',
        borderRadius: '18px 18px 0 0',
        boxShadow: '0 -4px 30px rgba(0,0,0,0.5)',
        transform: selectedStop ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)',
        pointerEvents: selectedStop ? 'auto' : 'none',
      }}>
        <div style={{ padding: '10px 0 0', cursor: 'pointer' }} onClick={onCloseStop}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border2)', margin: '0 auto' }} />
        </div>
        <StopPanel stop={selectedStop} onClose={onCloseStop} mobile />
      </div>
    </div>
  )
}
