'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import type { PlannerStation, Journey } from '@/types'
import { LINE_COLORS } from '@/lib/constants'
import { useI18n } from '@/lib/i18n'

interface TripPlannerProps {
  lineColors: Record<string, string>
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600) % 24
  const m = Math.floor(sec / 60) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
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

function JourneyCard({ journey, lineColors, best }: { journey: Journey; lineColors: Record<string, string>; best: boolean }) {
  const { t } = useI18n()
  const delayed = journey.liveDelayMin && journey.liveDelayMin > 0
  return (
    <div style={{ border: `1px solid ${best ? 'var(--accent)' : 'var(--border)'}`, background: best ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.06)', borderRadius: 10, padding: 12, marginBottom: 8 }}>
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

export function TripPlanner({ lineColors }: TripPlannerProps) {
  const { t } = useI18n()
  const [stations, setStations] = useState<PlannerStation[]>([])
  const [origin, setOrigin]     = useState<PlannerStation | null>(null)
  const [dest, setDest]         = useState<PlannerStation | null>(null)
  const [journeys, setJourneys] = useState<Journey[] | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/plan-stations')
      .then(r => r.json())
      .then((s: PlannerStation[]) => Array.isArray(s) && setStations(s))
      .catch(() => {})
  }, [])

  const search = useCallback(async () => {
    if (!origin || !dest) return
    if (origin.code === dest.code) { setError(t('sameOriginDest')); return }
    setLoading(true); setError(null); setJourneys(null)
    try {
      const res = await fetch(`/api/plan?from=${encodeURIComponent(origin.code)}&to=${encodeURIComponent(dest.code)}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? t('genericError')); return }
      setJourneys(data.journeys ?? [])
    } catch {
      setError(t('cannotConnect'))
    } finally {
      setLoading(false)
    }
  }, [origin, dest, t])

  // Auto-search when both ends are picked.
  useEffect(() => {
    if (origin && dest && origin.code !== dest.code) search()
  }, [origin, dest, search])

  const swap = () => { setOrigin(dest); setDest(origin) }

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <StationInput label={t('origin')} value={origin} onChange={setOrigin} stations={stations} placeholder={t('fromWhere')} />
        <div style={{ display: 'flex', justifyContent: 'center', margin: '-6px 0' }}>
          <button
            onClick={swap}
            title={t('swap')}
            style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--muted)', borderRadius: 20, width: 28, height: 28, cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
          >
            ⇅
          </button>
        </div>
        <StationInput label={t('destination')} value={dest} onChange={setDest} stations={stations} placeholder={t('toWhere')} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {loading && <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 20, fontSize: 13 }}>{t('calcRoute')}</p>}
        {error && !loading && <p style={{ color: 'var(--red)', textAlign: 'center', padding: 20, fontSize: 13 }}>{error}</p>}
        {!loading && !error && journeys && journeys.length === 0 && (
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 20, fontSize: 13 }}>
            {t('noDirectRoute')}
          </p>
        )}
        {!loading && !error && journeys && journeys.map((j, i) => (
          <JourneyCard key={i} journey={j} lineColors={lineColors} best={i === 0} />
        ))}
        {!loading && !error && !journeys && (
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 20, fontSize: 13 }}>
            {t('pickOriginDest')}
          </p>
        )}
      </div>
    </div>
  )
}
