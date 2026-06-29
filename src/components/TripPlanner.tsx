'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import type { PlannerStation, Journey } from '@/types'
import { LINE_COLORS } from '@/lib/constants'
import { useI18n } from '@/lib/i18n'
import { useSavedRoutes, type SavedRoute } from '@/lib/savedRoutes'

interface TripPlannerProps {
  lineColors: Record<string, string>
  selectedJourney: Journey | null
  onSelectJourney: (journey: Journey | null) => void
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600) % 24
  const m = Math.floor(sec / 60) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Seconds-since-local-midnight right now (matches planner's depTime units).
function nowSecondsOfDay(): number {
  const n = new Date()
  return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()
}

// Live countdown (in seconds) until this journey's train reaches the origin.
// depTime is scheduled seconds-since-midnight; live delay (minutes) pushes it
// later. Re-evaluates every second. Returns null once the train has departed.
function useDepartureCountdown(depTime: number, liveDelayMin: number | undefined, live: boolean): number | null {
  const target = depTime + (liveDelayMin && liveDelayMin > 0 ? liveDelayMin * 60 : 0)
  const compute = () => target - nowSecondsOfDay()
  const [remaining, setRemaining] = useState(compute)
  useEffect(() => {
    if (!live) return
    setRemaining(compute())
    const id = setInterval(() => setRemaining(compute()), 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, live])
  if (!live) return null
  return remaining <= -60 ? null : remaining
}

function fmtCountdown(sec: number): string {
  const clamped = Math.max(0, sec)
  const m = Math.floor(clamped / 60)
  const s = clamped % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Local YYYY-MM-DD `offset` days from today, for the date picker bounds. Must
// stay in sync with MAX_PLAN_DAYS_AHEAD on the server.
const MAX_DAYS_AHEAD = 7
function isoDay(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

// A station autocomplete input.
function StationInput({
  label, value, onChange, stations, placeholder,
}: {
  label: string
  value: PlannerStation | null
  onChange: (s: PlannerStation | null) => void
  stations: PlannerStation[]
  placeholder: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const ref               = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(value?.name ?? '') }, [value])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || q === value?.name.toLowerCase()) return []
    return stations.filter(s => s.name.toLowerCase().includes(q)).slice(0, 8)
  }, [query, stations, value])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 5 }}>
        {label}
      </div>
      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(null); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => { if (e.key === 'Enter' && matches.length > 0) { onChange(matches[0]); setOpen(false) } }}
        placeholder={placeholder}
        style={{ width: '100%', padding: '9px 11px', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
      />
      {open && matches.length > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: 'auto', zIndex: 40, boxShadow: '0 10px 25px rgba(0,0,0,0.25)' }}>
          {matches.map(s => (
            <div
              key={s.code}
              onClick={() => { onChange(s); setOpen(false) }}
              style={{ padding: '9px 11px', cursor: 'pointer', fontSize: 13 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {s.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LinePill({ line, lineColors }: { line: string; lineColors: Record<string, string> }) {
  const color = lineColors[line] || LINE_COLORS[line] || '#7a82a0'
  return (
    <span style={{ background: color, color: '#fff', fontWeight: 700, fontSize: 11, padding: '2px 8px', borderRadius: 6, fontFamily: 'var(--font-space-grotesk), sans-serif', flexShrink: 0 }}>
      {line}
    </span>
  )
}

// A saved / recent route row: tappable to re-run the search, with an optional
// star to (un)favorite it.
function RouteRow({ route, faved, onPick, onToggleFav }: { route: SavedRoute; faved?: boolean; onPick: () => void; onToggleFav?: () => void }) {
  const { t } = useI18n()
  return (
    <div
      onClick={onPick}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: 'var(--bg3)', marginBottom: 5 }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg3)')}
    >
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{route.fromName}</span>
        <span style={{ color: 'var(--muted)', flexShrink: 0 }}>→</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{route.toName}</span>
      </div>
      {onToggleFav && (
        <button
          onClick={e => { e.stopPropagation(); onToggleFav() }}
          title={faved ? t('unsaveRoute') : t('saveRoute')}
          aria-label={faved ? t('unsaveRoute') : t('saveRoute')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1, color: faved ? 'var(--accent)' : 'var(--muted)', flexShrink: 0 }}
        >
          {faved ? '★' : '☆'}
        </button>
      )}
    </div>
  )
}

function JourneyCard({ journey, lineColors, best, live, active, onClick }: { journey: Journey; lineColors: Record<string, string>; best: boolean; live: boolean; active: boolean; onClick: () => void }) {
  const { t } = useI18n()
  const delayed = journey.liveDelayMin && journey.liveDelayMin > 0
  // The live countdown only makes sense for today's plan; for a future date the
  // scheduled departure time is shown without a ticking timer.
  const countdown = useDepartureCountdown(journey.depTime, journey.liveDelayMin, live)
  return (
    <div
      onClick={onClick}
      title={t('showOnMap')}
      style={{ border: `1px solid ${active ? 'var(--accent)' : best ? 'var(--border2)' : 'var(--border)'}`, outline: active ? '1px solid var(--accent)' : 'none', background: active ? 'rgba(0,0,0,0.18)' : best ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.06)', borderRadius: 10, padding: 12, marginBottom: 8, cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-space-grotesk), sans-serif' }}>
            {fmtTime(journey.depTime)}
          </span>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>→</span>
          <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-space-grotesk), sans-serif' }}>
            {fmtTime(journey.arrTime)}
          </span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{journey.durationMin} min</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            {journey.transfers === 0 ? t('direct') : t('transfers', journey.transfers)}
          </div>
        </div>
      </div>

      {/* live countdown: how long until this train reaches the origin (today only) */}
      {live && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4, marginBottom: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            {countdown === null ? t('departed') : t('departsIn')}
          </span>
          {countdown !== null && (
            <span style={{
              fontFamily: 'var(--font-space-grotesk), monospace',
              fontSize: 17,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              color: countdown <= 60 ? 'var(--red)' : best ? 'var(--accent)' : 'var(--text)',
            }}>
              {fmtCountdown(countdown)}
            </span>
          )}
        </div>
      )}

      {/* leg chain */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {journey.legs.map((leg, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && <span style={{ color: 'var(--muted)', fontSize: 11 }}>↔ {leg.fromName}</span>}
            <LinePill line={leg.line} lineColors={lineColors} />
          </span>
        ))}
      </div>

      {delayed && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--red)', fontWeight: 600 }}>
          ⚠ {t('delayLive', journey.legs[0].line, journey.liveDelayMin!)}
        </div>
      )}
    </div>
  )
}

export function TripPlanner({ lineColors, selectedJourney, onSelectJourney }: TripPlannerProps) {
  const { t } = useI18n()
  const [stations, setStations] = useState<PlannerStation[]>([])
  const [origin, setOrigin]     = useState<PlannerStation | null>(null)
  const [dest, setDest]         = useState<PlannerStation | null>(null)
  const [journeys, setJourneys] = useState<Journey[] | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  // Departure time. `null` means "leave now" (server uses current time).
  const [depTime, setDepTime]   = useState<string | null>(null)
  // Departure date (YYYY-MM-DD). `null` means today.
  const [depDate, setDepDate]   = useState<string | null>(null)
  // Step-free itinerary text for the current origin→dest pair (null = none).
  const [stepFree, setStepFree] = useState<string | null>(null)
  const [showStepFree, setShowStepFree] = useState(false)
  const { favorites, recents, isFavorite, toggleFavorite, recordRecent, clearRecents } = useSavedRoutes()

  useEffect(() => {
    fetch('/api/plan-stations')
      .then(r => r.json())
      .then((s: PlannerStation[]) => Array.isArray(s) && setStations(s))
      .catch(() => {})
  }, [])

  // The current origin→dest pair as a SavedRoute (null until both are picked).
  const currentRoute = useMemo<SavedRoute | null>(
    () => origin && dest && origin.code !== dest.code
      ? { fromCode: origin.code, fromName: origin.name, toCode: dest.code, toName: dest.name }
      : null,
    [origin, dest],
  )

  // Fill the planner from a saved/recent route, which kicks off an auto-search.
  const applyRoute = useCallback((r: SavedRoute) => {
    setOrigin({ code: r.fromCode, name: r.fromName })
    setDest({ code: r.toCode, name: r.toName })
  }, [])

  const search = useCallback(async () => {
    if (!origin || !dest) return
    if (origin.code === dest.code) { setError(t('sameOriginDest')); return }
    setLoading(true); setError(null); setJourneys(null)
    try {
      let qs = `from=${encodeURIComponent(origin.code)}&to=${encodeURIComponent(dest.code)}`
      if (depTime) qs += `&after=${encodeURIComponent(depTime)}`
      if (depDate) qs += `&date=${encodeURIComponent(depDate)}`
      const res = await fetch(`/api/plan?${qs}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? t('genericError')); return }
      const found: Journey[] = data.journeys ?? []
      setJourneys(found)
      // Auto-draw the best journey's path; clicking another card switches it.
      onSelectJourney(found[0] ?? null)
      // Record a usable search in recents (only when a route was actually found).
      if (found.length > 0) {
        recordRecent({ fromCode: origin.code, fromName: origin.name, toCode: dest.code, toName: dest.name })
      }
    } catch {
      setError(t('cannotConnect'))
    } finally {
      setLoading(false)
    }
  }, [origin, dest, depTime, depDate, onSelectJourney, recordRecent, t])

  // Auto-search when both ends are picked (re-runs when time or date changes).
  useEffect(() => {
    if (origin && dest && origin.code !== dest.code) search()
  }, [origin, dest, search])

  // Look up the step-free itinerary whenever the origin→dest pair changes.
  useEffect(() => {
    setStepFree(null)
    setShowStepFree(false)
    // Drop any path drawn for the previous pair until fresh results arrive.
    onSelectJourney(null)
    if (!origin || !dest || origin.code === dest.code) return
    const ctrl = new AbortController()
    fetch(`/api/accessibility?from=${encodeURIComponent(origin.name)}&to=${encodeURIComponent(dest.name)}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((d: { itinerary?: { steps: string } | null }) => setStepFree(d.itinerary?.steps ?? null))
      .catch(() => {})
    return () => ctrl.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, dest])

  // Clear the drawn path when the planner unmounts (e.g. switching tabs away).
  useEffect(() => () => onSelectJourney(null), [onSelectJourney])

  const swap = () => { setOrigin(dest); setDest(origin) }

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <StationInput label={t('origin')} value={origin} onChange={setOrigin} stations={stations} placeholder={t('fromWhere')} />
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, margin: '-6px 0' }}>
          <button
            onClick={swap}
            title={t('swap')}
            style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--muted)', borderRadius: 20, width: 28, height: 28, cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
          >
            ⇅
          </button>
          {currentRoute && (
            <button
              onClick={() => toggleFavorite(currentRoute)}
              title={isFavorite(currentRoute) ? t('unsaveRoute') : t('saveRoute')}
              aria-label={isFavorite(currentRoute) ? t('unsaveRoute') : t('saveRoute')}
              style={{ background: 'var(--bg3)', border: `1px solid ${isFavorite(currentRoute) ? 'var(--accent)' : 'var(--border2)'}`, color: isFavorite(currentRoute) ? 'var(--accent)' : 'var(--muted)', borderRadius: 20, width: 28, height: 28, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
            >
              {isFavorite(currentRoute) ? '★' : '☆'}
            </button>
          )}
        </div>
        <StationInput label={t('destination')} value={dest} onChange={setDest} stations={stations} placeholder={t('toWhere')} />

        {depTime === null ? (
          <button
            onClick={() => {
              const now = new Date()
              setDepTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
            }}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: 0 }}
          >
            <span>{t('leaveNow')} · {t('changeTime')}</span>
            <span aria-hidden style={{ fontSize: 10, lineHeight: 1 }}>▾</span>
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', minWidth: 52 }}>
                {t('leaveAt')}
              </span>
              <input
                type="time"
                value={depTime}
                onChange={e => setDepTime(e.target.value || null)}
                style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, padding: '7px 9px', outline: 'none' }}
              />
              <button
                onClick={() => { setDepTime(null); setDepDate(null) }}
                title={t('leaveNow')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: 0 }}
              >
                <span>{t('leaveNow')}</span>
                <span aria-hidden style={{ fontSize: 10, lineHeight: 1 }}>▴</span>
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', minWidth: 52 }}>
                {t('onDay')}
              </span>
              <input
                type="date"
                value={depDate ?? isoDay(0)}
                min={isoDay(0)}
                max={isoDay(MAX_DAYS_AHEAD)}
                onChange={e => setDepDate(e.target.value && e.target.value !== isoDay(0) ? e.target.value : null)}
                style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, padding: '7px 9px', outline: 'none' }}
              />
              {depDate && (
                <button
                  onClick={() => setDepDate(null)}
                  title={t('today')}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: 0 }}
                >
                  {t('today')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {loading && <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 20, fontSize: 13 }}>{t('calcRoute')}</p>}
        {error && !loading && <p style={{ color: 'var(--red)', textAlign: 'center', padding: 20, fontSize: 13 }}>{error}</p>}
        {!loading && !error && journeys && journeys.length === 0 && (
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 20, fontSize: 13 }}>
            {t('noDirectRoute')}
          </p>
        )}
        {!loading && !error && stepFree && (
          <div style={{ border: '1px solid var(--border)', background: 'rgba(0,0,0,0.06)', borderRadius: 10, padding: 12, marginBottom: 8 }}>
            <button
              onClick={() => setShowStepFree(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: 0, textAlign: 'left' }}
            >
              <span aria-hidden style={{ fontSize: 15 }}>♿</span>
              <span style={{ flex: 1 }}>{t('stepFreeRoute')}</span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>{showStepFree ? '▲' : '▼'}</span>
            </button>
            {showStepFree && (
              <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12, lineHeight: 1.55, color: 'var(--muted)', whiteSpace: 'pre-line' }}>
                {stepFree}
              </p>
            )}
          </div>
        )}
        {!loading && !error && journeys && journeys.map((j, i) => (
          <JourneyCard
            key={i}
            journey={j}
            lineColors={lineColors}
            best={i === 0}
            live={depDate === null}
            active={j === selectedJourney}
            onClick={() => onSelectJourney(j)}
          />
        ))}
        {/* Saved & recent routes — shown in the idle state, before a search. */}
        {!loading && !error && !journeys && (
          <>
            {favorites.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span aria-hidden style={{ color: 'var(--accent)' }}>★</span>{t('savedRoutes')}
                </div>
                {favorites.map((r, i) => (
                  <RouteRow key={`f${i}`} route={r} faved onPick={() => applyRoute(r)} onToggleFav={() => toggleFavorite(r)} />
                ))}
              </div>
            )}

            {recents.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{t('recentRoutes')}</span>
                  <button
                    onClick={clearRecents}
                    style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600, padding: 0 }}
                  >
                    {t('clearRecents')}
                  </button>
                </div>
                {recents.map((r, i) => (
                  <RouteRow key={`r${i}`} route={r} faved={isFavorite(r)} onPick={() => applyRoute(r)} onToggleFav={() => toggleFavorite(r)} />
                ))}
              </div>
            )}

            <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 20, fontSize: 13 }}>
              {t('pickOriginDest')}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
