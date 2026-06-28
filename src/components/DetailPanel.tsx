'use client'

import type { Train } from '@/types'
import { LINE_COLORS } from '@/lib/constants'
import { useI18n } from '@/lib/i18n'

function occColor(pct: number) {
  if (pct > 70) return 'var(--red)'
  if (pct > 40) return 'var(--yellow)'
  return 'var(--green)'
}

interface DetailPanelProps {
  train: Train | null
  lineColors: Record<string, string>
  onClose: () => void
}


export function DetailPanel({ train, lineColors, onClose }: DetailPanelProps) {
  const { t } = useI18n()
  const open = train !== null

  return (
    <div style={{
      position: 'absolute',
      right: 20,
      top: 20,
      width: 320,
      background: 'var(--bg2)',
      border: '1px solid var(--border2)',
      borderRadius: 16,
      padding: 20,
      transform: open ? 'translateX(0)' : 'translateX(360px)',
      transition: 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
      zIndex: 5,
      maxHeight: 'calc(100% - 40px)',
      overflowY: 'auto',
      boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
      pointerEvents: open ? 'auto' : 'none',
    }}>
      {train && (
        <>
          <button
            onClick={onClose}
            style={{ position: 'absolute', top: 14, right: 14, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--muted)', width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 12 }}
          >
            ✕
          </button>

          <div style={{ fontSize: 11, fontWeight: 700, color: lineColors[train.line] || LINE_COLORS[train.line] || '#7a82a0', marginBottom: 4, fontFamily: 'var(--font-space-grotesk)' }}>
            {t('activeService')}
          </div>
          <h2 style={{ fontFamily: 'var(--font-space-grotesk), sans-serif', fontSize: 24, marginBottom: 2 }}>
            {t('line')} {train.line}
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
            {t('unit')} <b>#{train.id.split('|')[1]?.slice(-6) ?? train.id}</b>
          </p>

          {/* Metrics grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            {[
              { label: t('finalDest'),   value: train.destination, size: 13 },
              { label: t('punctuality'), value: train.delayMinutes > 0 ? `+${train.delayMinutes} min` : t('onTime'), color: train.delayMinutes > 0 ? 'var(--red)' : 'var(--green)', size: 18 },
              { label: t('avgOccupancy'), value: `${Math.round(train.occupancyPercent)}%`, size: 18 },
            ].map(m => (
              <div key={m.label} style={{ background: 'var(--bg3)', borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>{m.label}</div>
                <div style={{ fontFamily: 'var(--font-space-grotesk)', fontSize: m.size, fontWeight: 600, color: m.color || 'var(--text)', paddingTop: m.size === 13 ? 4 : 0 }}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>


          {/* Per-wagon occupancy — real data from ocupacio_m1/m2/mi/ri fields */}
          {train.wagons && train.wagons.some(w => w > 0) && (
            <>
              <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>{t('occupancyPerCar')}</div>
              <div style={{ display: 'flex', gap: 4, height: 48, alignItems: 'flex-end', marginBottom: 14 }}>
                {train.wagons.map((v, i) => {
                  const label = String(i + 1)
                  const pct = Math.max(6, Math.min(98, Math.round(v)))
                  const c = occColor(v)
                  return (
                    <div key={i} style={{ flex: 1, height: `${pct}%`, borderRadius: 4, background: `${c}25`, border: `1px solid ${c}`, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 3 }}>
                      <span style={{ fontSize: 8, fontWeight: 600, color: c }}>{label}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Route: origin → current → upcoming stops */}
          <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>{t('upcomingStops')}</div>
          <div>
            {/* Origin */}
            <StopRow name={`${train.origin} (${t('origin2')})`} state="passed" />

            {/* Current stop if known */}
            {train.currentStop && (
              <StopRow name={train.currentStop} state="current" label={t('hereNowLabel')} />
            )}

            {/* Upcoming stops */}
            {train.upcomingStops.length === 0 && !train.currentStop && (
              <StopRow name={t('inTransit')} state="current" />
            )}
            {train.upcomingStops.map((stop, i) => (
              <StopRow
                key={i}
                name={stop === train.destination ? `${stop} (${t('terminal')})` : stop}
                state={i === 0 && !train.currentStop ? 'current' : 'next'}
                isLast={i === train.upcomingStops.length - 1}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function StopRow({ name, state, label, isLast }: { name: string; state: 'passed' | 'current' | 'next'; label?: string; isLast?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingBottom: 8, position: 'relative' }}>
      <div style={{ position: 'relative', zIndex: 2, marginTop: 4, flexShrink: 0 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: state === 'current' ? 'var(--accent)' : state === 'passed' ? 'var(--muted)' : 'var(--border2)',
          boxShadow: state === 'current' ? '0 0 0 3px rgba(59,130,246,0.3)' : 'none',
        }} />
        {!isLast && (
          <div style={{ position: 'absolute', left: 3.5, top: 8, width: 1, height: 18, background: 'var(--border)' }} />
        )}
      </div>
      <div style={{ flex: 1, fontSize: 12, color: state === 'passed' ? 'var(--muted)' : 'var(--text)', fontWeight: state === 'current' ? 600 : 400 }}>
        {name}
      </div>
      {label && <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>{label}</div>}
    </div>
  )
}
