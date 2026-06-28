'use client'

import type { Train } from '@/types'
import { LINE_COLORS } from '@/lib/constants'
import { useI18n } from '@/lib/i18n'

interface TrainCardProps {
  train: Train
  selected: boolean
  onClick: () => void
  lineColors?: Record<string, string>
}

function occStyle(pct: number) {
  if (pct > 70) return { bg: 'rgba(239,68,68,0.12)', color: '#f87171' }
  if (pct > 40) return { bg: 'rgba(234,179,8,0.12)',  color: '#fbbf24' }
  return             { bg: 'rgba(34,197,94,0.12)',   color: '#4ade80' }
}

export function TrainCard({ train, selected, onClick, lineColors }: TrainCardProps) {
  const { t } = useI18n()
  const colors = lineColors ?? LINE_COLORS
  const color  = colors[train.line] || '#7a82a0'
  const occ    = Math.round(train.occupancyPercent)
  const oStyle = occStyle(occ)
  const delayed = train.delayMinutes > 0
  const nextStop = train.upcomingStops[0]
  const etaLabel = (etaUnix: number | undefined): string | null => {
    if (etaUnix == null || !Number.isFinite(etaUnix)) return null
    const mins = Math.round((etaUnix * 1000 - Date.now()) / 60000)
    if (!Number.isFinite(mins)) return null
    if (mins <= 0) return t('etaNow')
    return t('etaIn', mins)
  }
  const eta = etaLabel(train.nextStopEta)

  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 14px 10px 18px',
        borderRadius: 10,
        border: `1px solid ${selected ? color + '55' : 'var(--border)'}`,
        marginBottom: 5,
        cursor: 'pointer',
        background: selected ? `${color}0d` : 'transparent',
        position: 'relative',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {/* Left accent bar */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: color, borderRadius: '3px 0 0 3px' }} />

      {/* Top row: line badge + delay or on-time */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontFamily: 'var(--font-space-grotesk), sans-serif', fontSize: 12, fontWeight: 700, color, letterSpacing: '0.3px' }}>
          {train.line}
        </span>
        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
          background: delayed ? 'rgba(239,68,68,0.12)' : oStyle.bg,
          color:      delayed ? '#f87171' : oStyle.color,
        }}>
          {delayed ? `+${train.delayMinutes} min` : occ > 0 ? `${occ}% ${t('occupied')}` : t('onTime')}
        </span>
      </div>

      {/* Destination */}
      <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        → {train.destination}
      </div>

      {/* Current stop if known */}
      {train.currentStop && (
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
          {t('nowAt')} <span style={{ color: 'var(--text)' }}>{train.currentStop}</span>
        </div>
      )}

      {/* Next stop + ETA */}
      {nextStop && (
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('nextStop')}: <span style={{ color: 'var(--text)' }}>{nextStop}</span></span>
          {eta && <span style={{ color: color, fontWeight: 600 }}>{eta}</span>}
        </div>
      )}
    </div>
  )
}
