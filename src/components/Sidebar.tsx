'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import type { Train, Stop } from '@/types'
import { LINE_COLORS, STATION_CODES } from '@/lib/constants'
import { TrainCard } from './TrainCard'
import { TripPlanner } from './TripPlanner'
import { useI18n, type TransKey } from '@/lib/i18n'

type Tab = 'trains' | 'stations' | 'plan'

interface SidebarProps {
  trains: Train[]
  stops: Stop[]
  lines: string[]
  lineColors: Record<string, string>
  activeLines: Set<string>
  selectedTrain: Train | null
  selectedStop: Stop | null
  onToggleLine: (line: string) => void
  onSelectTrain: (train: Train) => void
  onSelectStop: (stop: Stop) => void
}

const LINE_GROUPS: { key: string; labelKey: TransKey; prefix: RegExp }[] = [
  { key: 'L',     labelKey: 'groupUrban',    prefix: /^L/ },
  { key: 'S',     labelKey: 'groupValles',   prefix: /^S/ },
  { key: 'R',     labelKey: 'groupRegional', prefix: /^R/ },
  { key: 'Other', labelKey: 'groupOther',    prefix: /^(?!L|S|R)/ },
]

export function Sidebar({ trains, stops, lines, lineColors, activeLines, selectedTrain, selectedStop, onToggleLine, onSelectTrain, onSelectStop }: SidebarProps) {
  const { t } = useI18n()
  const [activeTab, setActiveTab]           = useState<Tab>('trains')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [filterOpen, setFilterOpen]         = useState(true)
  const [stationQuery, setStationQuery]     = useState('')
  const [showDropdown, setShowDropdown]     = useState(false)
  const dropdownRef                         = useRef<HTMLDivElement>(null)

  // Sync station query label when parent's selectedStop changes (e.g. map click)
  useEffect(() => {
    if (selectedStop) {
      setStationQuery(selectedStop.name)
      setActiveTab('stations')
    }
  }, [selectedStop?.stopId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredStops = useMemo(() =>
    stationQuery
      ? Array.from(
          new Map(
            stops
              .filter(s => s.name.toLowerCase().includes(stationQuery.toLowerCase()))
              .map(s => [s.name, s]),
          ).values(),
        ).slice(0, 10)
      : [],
    [stops, stationQuery],
  )

  // Trains report stops by their canonical name (resolved via STATION_CODES),
  // which differs from the stop's raw API name (e.g. "Barcelona - Plaça
  // Catalunya" vs "Pl. Catalunya"). Resolve the selected stop the same way the
  // map popup does so the two panels agree.
  const selectedStationName = useMemo(() => {
    if (!selectedStop) return null
    const code = selectedStop.stopId.replace(/\d+$/, '')
    return STATION_CODES[code] ?? selectedStop.name
  }, [selectedStop])

  const passingTrains = useMemo(() =>
    selectedStationName
      ? trains.filter(t =>
          t.currentStop === selectedStationName ||
          t.upcomingStops.includes(selectedStationName)
        )
      : [],
    [trains, selectedStationName],
  )

  const lineGroups = useMemo(() =>
    LINE_GROUPS.map(g => ({
      ...g,
      members: lines.filter(l => g.prefix.test(l)),
    })).filter(g => g.members.length > 0),
    [lines],
  )

  function selectStop(stop: Stop) {
    setStationQuery(stop.name)
    setShowDropdown(false)
    onSelectStop(stop)
  }

  function toggleGroup(key: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function groupActive(members: string[]) {
    if (activeLines.has('ALL')) return false
    return members.some(l => activeLines.has(l))
  }

  const tabStyle = (tab: Tab) => ({
    flex: 1, padding: 12, border: 'none', background: 'none',
    color: activeTab === tab ? 'var(--accent)' : 'var(--muted)',
    fontWeight: 600, fontSize: 12, cursor: 'pointer',
    borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
    textTransform: 'uppercase' as const, letterSpacing: '0.5px', fontFamily: 'inherit',
    transition: 'color 0.15s',
  })

  return (
    <aside style={{ background: 'var(--bg2)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Tab buttons */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.05)' }}>
        {(['trains', 'stations', 'plan'] as Tab[]).map(tab => (
          <button key={tab} style={tabStyle(tab)} onClick={() => setActiveTab(tab)}>
            {tab === 'trains' ? t('tabTrains') : tab === 'stations' ? t('tabStations') : t('tabPlan')}
          </button>
        ))}
      </div>

      {/* ── Trains tab ── */}
      {activeTab === 'trains' && (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Line filters */}
          <div style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <button
              onClick={() => setFilterOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontFamily: 'inherit' }}
            >
              <span style={{ flex: 1, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', textAlign: 'left' }}>{t('filterByLine')}</span>
              <span style={{ fontSize: 9, opacity: 0.6 }}>{filterOpen ? '▲' : '▼'}</span>
            </button>
            {filterOpen && <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span
                onClick={() => onToggleLine('ALL')}
                style={{ alignSelf: 'flex-start', padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${activeLines.has('ALL') ? 'var(--text)' : 'transparent'}`, background: 'var(--bg3)', color: 'var(--text)', opacity: activeLines.has('ALL') ? 1 : 0.45, transition: 'all 0.15s', fontFamily: 'var(--font-space-grotesk), sans-serif' }}
              >
                {t('all')}
              </span>

              {lineGroups.map(g => {
                const expanded = expandedGroups.has(g.key)
                const anyActive = groupActive(g.members)
                return (
                  <div key={g.key}>
                    <button
                      onClick={() => toggleGroup(g.key)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: anyActive ? 'var(--accent)10' : 'var(--bg3)', border: `1px solid ${anyActive ? 'var(--accent)' : 'var(--border2)'}`, borderRadius: 7, padding: '5px 10px', cursor: 'pointer', color: anyActive ? 'var(--accent)' : 'var(--muted)', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-space-grotesk), sans-serif', textAlign: 'left', transition: 'all 0.15s' }}
                    >
                      <span style={{ flex: 1 }}>{t(g.labelKey)}</span>
                      <span style={{ fontSize: 9, opacity: 0.6 }}>{expanded ? '▲' : '▼'}</span>
                    </button>

                    {expanded && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '6px 4px 2px 4px' }}>
                        {g.members.map(l => {
                          const active = activeLines.has(l)
                          const color = lineColors[l] || LINE_COLORS[l] || '#7a82a0'
                          return (
                            <span
                              key={l}
                              onClick={() => onToggleLine(l)}
                              style={{ padding: '4px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${active ? color : 'transparent'}`, background: `${color}20`, color, opacity: active ? 1 : 0.45, transition: 'all 0.15s', fontFamily: 'var(--font-space-grotesk), sans-serif' }}
                            >
                              {l}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>}
          </div>

          {/* Train list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 8px 4px' }}>
            {trains.length === 0
              ? <p style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 12 }}>{t('noActiveTrains')}</p>
              : trains.map(t => (
                  <TrainCard key={t.id} train={t} selected={selectedTrain?.id === t.id} onClick={() => onSelectTrain(t)} lineColors={lineColors} />
                ))
            }
          </div>
        </div>
      )}

      {/* ── Stations tab ── */}
      {activeTab === 'stations' && (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div ref={dropdownRef} style={{ padding: 16, borderBottom: '1px solid var(--border)', flexShrink: 0, position: 'relative' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
              {t('searchStation')}
            </div>
            <input
              type="text"
              value={stationQuery}
              onChange={e => { setStationQuery(e.target.value); setShowDropdown(true) }}
              onKeyDown={e => { if (e.key === 'Enter' && filteredStops.length > 0) selectStop(filteredStops[0]) }}
              onFocus={() => setShowDropdown(true)}
              placeholder={t('searchStationPlaceholder')}
              style={{ width: '100%', padding: '10px 12px', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
            />
            {showDropdown && filteredStops.length > 0 && (
              <div style={{ position: 'absolute', left: 16, right: 16, top: '100%', background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: 'auto', zIndex: 30, boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
                {filteredStops.map(s => (
                  <div key={s.stopId} onClick={() => selectStop(s)} style={{ padding: '10px 12px', cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {s.name}
                    {s.wheelchairBoarding && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent)' }}>♿</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {selectedStop ? (
              <>
                <h3 style={{ fontFamily: 'var(--font-space-grotesk)', fontSize: 15, marginBottom: 4, color: 'var(--accent)' }}>
                  {selectedStop.name}
                </h3>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
                  {t('passingNowSoon')}
                </p>
                {passingTrains.length > 0 ? passingTrains.map(train => {
                  const color = lineColors[train.line] || LINE_COLORS[train.line] || '#7a82a0'
                  const isHere = train.currentStop === selectedStationName
                  const stopsAway = isHere ? 0 : train.upcomingStops.indexOf(selectedStationName!) + 1
                  return (
                    <div
                      key={train.id}
                      onClick={() => onSelectTrain(train)}
                      style={{ border: `1px solid ${isHere ? color : 'var(--border)'}`, padding: 10, borderRadius: 8, marginBottom: 6, background: isHere ? `${color}12` : 'rgba(0,0,0,0.1)', cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <b style={{ color, fontSize: 13 }}>{train.line}</b>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {train.delayMinutes > 0 && <span style={{ color: 'var(--red)', fontWeight: 600, fontSize: 11 }}>+{train.delayMinutes}m</span>}
                          {isHere
                            ? <span style={{ background: color, color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}>{t('hereNow')}</span>
                            : <span style={{ color: 'var(--muted)', fontSize: 10 }}>{t('stopsAway', stopsAway)}</span>
                          }
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {t('towards')} <b style={{ color: 'var(--text)' }}>{train.destination}</b> · {Math.round(train.occupancyPercent)}% {t('occupancyLabel')}
                      </div>
                    </div>
                  )
                }) : (
                  <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
                    {t('noTrainHere')}
                  </p>
                )}
              </>
            ) : (
              <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 20, fontSize: 13 }}>
                {t('searchToSeeTrains')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Plan tab ── */}
      {activeTab === 'plan' && <TripPlanner lineColors={lineColors} />}
    </aside>
  )
}
