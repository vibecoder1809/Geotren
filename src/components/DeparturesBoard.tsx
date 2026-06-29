'use client'

import { useEffect, useState } from 'react'
import { LINE_COLORS } from '@/lib/constants'
import { useI18n } from '@/lib/i18n'

interface Departure {
  line: string
  headsign: string
  depTime: number    // scheduled seconds since midnight
  delayMin: number   // current median live delay for this line
}

// Seconds since local midnight (matches the server's depTime units).
function nowSecondsOfDay(): number {
  const n = new Date()
  return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()
}

function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600) % 24
  const m = Math.floor(sec / 60) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const MAX_SHOWN  = 6
const REFRESH_MS = 60_000   // re-pull schedule + live delays as time passes
const IMMINENT_S = 30       // within this many seconds → show "now"

// Live next-departures board for a station. Scheduled times come from the GTFS
// timetable (via /api/departures) and are pushed later by each line's current
// median delay; a per-second countdown ticks client-side.
export function DeparturesBoard({ stationCode, lineColors }: { stationCode: string; lineColors: Record<string, string> }) {
  const { t } = useI18n()
  const [departures, setDepartures] = useState<Departure[] | null>(null)
  const [now, setNow]               = useState(nowSecondsOfDay())

  // Fetch + periodically refresh the departures for this station.
  useEffect(() => {
    if (!stationCode) return
    let active = true
    const load = () => {
      fetch(`/api/departures?station=${encodeURIComponent(stationCode)}`)
        .then(r => r.json())
        .then((d: { departures?: Departure[] }) => { if (active) setDepartures(d.departures ?? []) })
        .catch(() => { if (active) setDepartures([]) })
    }
    setDepartures(null)
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => { active = false; clearInterval(id) }
  }, [stationCode])

  // Tick the countdown every second.
  useEffect(() => {
    const id = setInterval(() => setNow(nowSecondsOfDay()), 1000)
    return () => clearInterval(id)
  }, [])

  // Effective departure = schedule + live delay; keep those still upcoming
  // (allow a 30s grace so a train "at the platform" doesn't vanish instantly).
  const upcoming = (departures ?? [])
    .map(d => ({ ...d, eff: d.depTime + (d.delayMin > 0 ? d.delayMin * 60 : 0) }))
    .filter(d => d.eff - now >= -IMMINENT_S)
    .slice(0, MAX_SHOWN)

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
        {t('departures')}
      </div>

      {departures === null ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 0' }}>{t('loadingData')}</div>
      ) : upcoming.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 0' }}>{t('noDepartures')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {upcoming.map((d, i) => {
            const color     = lineColors[d.line] || LINE_COLORS[d.line] || '#7a82a0'
            const remaining = d.eff - now
            const imminent  = remaining <= IMMINENT_S
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg3)', borderRadius: 8, padding: '7px 10px' }}>
                <span style={{ background: color, color: '#fff', fontWeight: 700, fontSize: 11, padding: '2px 7px', borderRadius: 6, fontFamily: 'var(--font-space-grotesk), sans-serif', flexShrink: 0, minWidth: 30, textAlign: 'center' }}>
                  {d.line}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.headsign}
                </span>
                {d.delayMin > 0 && (
                  <span style={{ color: 'var(--red)', fontWeight: 600, fontSize: 10, flexShrink: 0 }}>+{d.delayMin}m</span>
                )}
                <span style={{
                  flexShrink: 0,
                  fontFamily: 'var(--font-space-grotesk), monospace',
                  fontSize: 13,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  color: imminent ? 'var(--accent)' : 'var(--text)',
                  minWidth: 46,
                  textAlign: 'right',
                }}>
                  {imminent
                    ? t('etaNow')
                    : remaining < 3600
                      ? t('minShort', Math.ceil(remaining / 60))
                      : fmtClock(d.depTime)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
