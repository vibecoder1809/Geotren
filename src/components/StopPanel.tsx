'use client'

import { useEffect, useState } from 'react'
import type { Stop, StopDetail } from '@/types'
import { useI18n, type TransKey } from '@/lib/i18n'

interface StopPanelProps {
  stop: Stop | null
  onClose: () => void
  mobile?: boolean
}

const SKY_ICONS: Record<string, string> = {
  'sol': '☀️',
  'sol i núvols alts': '🌤️',
  'entre poc i mig ennuvolat': '⛅',
  'ennuvolat': '☁️',
  'ruixat': '🌦️',
  'xàfec amb tempesta': '⛈️',
  'neu': '🌨️',
  'boira': '🌫️',
}

const IQAM_CONFIG: Record<string, { labelKey: TransKey; color: string; bg: string }> = {
  'BO':      { labelKey: 'airGood',     color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  'MODERAT': { labelKey: 'airModerate', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  'DOLENT':  { labelKey: 'airBad',      color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
}

function Metric({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '8px 10px', flex: 1 }}>
      <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-space-grotesk)', fontSize: 16, fontWeight: 600 }}>
        {value != null ? `${value}` : '—'}
        {value != null && <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 2 }}>{unit}</span>}
      </div>
    </div>
  )
}

function StopContent({ stop, detail, loading, onClose, showCloseButton }: {
  stop: Stop
  detail: StopDetail | null
  loading: boolean
  onClose: () => void
  showCloseButton: boolean
}) {
  const { t } = useI18n()
  const air     = detail?.air ?? null
  const weather = detail?.weather ?? null
  const iqam    = air?.iqam ? IQAM_CONFIG[air.iqam] : null

  return (
    <>
      {showCloseButton && (
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 14, right: 14, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--muted)', width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 12 }}
        >
          ✕
        </button>
      )}

      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>
        {t('stationFgc')}
      </div>
      <h2 style={{ fontFamily: 'var(--font-space-grotesk)', fontSize: 20, marginBottom: 2 }}>
        {stop.name}
      </h2>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16, display: 'flex', gap: 8 }}>
        <span>{stop.stopId}</span>
        {stop.wheelchairBoarding && <span style={{ color: 'var(--accent)' }}>♿ {t('accessible')}</span>}
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>{t('loadingData')}</div>
      )}

      {weather && !loading && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
            {t('weatherLabel')} · {weather.timeRange}
          </div>
          <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>{SKY_ICONS[weather.sky] ?? '🌡️'}</span>
            <span style={{ fontSize: 13, color: 'var(--text)', textTransform: 'capitalize' }}>{weather.sky}</span>
          </div>
        </div>
      )}

      {air && !loading && (
        <div>
          <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
            {t('airQuality')}{air.stationName ? ` · ${air.stationName}` : ''}
          </div>
          {iqam && (
            <div style={{ background: iqam.bg, border: `1px solid ${iqam.color}40`, borderRadius: 10, padding: '8px 14px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: iqam.color, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: iqam.color, fontFamily: 'var(--font-space-grotesk)' }}>{t(iqam.labelKey)}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('airQualityIndex')}</div>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <Metric label="NO₂" value={air.no2} unit="µg/m³" />
            <Metric label="O₃" value={air.o3} unit="µg/m³" />
            <Metric label="PM10" value={air.pm10} unit="µg/m³" />
          </div>
        </div>
      )}

      {!loading && !air && !weather && (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 0' }}>
          {t('noEnvData')}
        </div>
      )}
    </>
  )
}

export function StopPanel({ stop, onClose, mobile = false }: StopPanelProps) {
  const [detail, setDetail] = useState<StopDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!stop) { setDetail(null); return }
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/stop-info?stopId=${encodeURIComponent(stop.stopId)}`, { signal: controller.signal })
      .then(r => r.json())
      .then((d: StopDetail) => { setDetail(d); setLoading(false) })
      .catch(e => { if (e.name !== 'AbortError') setLoading(false) })
    return () => controller.abort()
  }, [stop?.stopId])

  // Mobile: no wrapper — parent slide-up div handles positioning
  if (mobile) {
    return (
      <div style={{ padding: '0 20px 20px' }}>
        {stop && <StopContent stop={stop} detail={detail} loading={loading} onClose={onClose} showCloseButton={false} />}
      </div>
    )
  }

  // Desktop: absolutely positioned panel sliding in from the right
  const open = stop !== null
  return (
    <div style={{
      position: 'absolute',
      right: 20,
      top: 20,
      width: 300,
      background: 'var(--bg2)',
      border: '1px solid var(--border2)',
      borderRadius: 16,
      padding: 20,
      transform: open ? 'translateX(0)' : 'translateX(340px)',
      transition: 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
      zIndex: 4,
      maxHeight: 'calc(100% - 40px)',
      overflowY: 'auto',
      boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
      pointerEvents: open ? 'auto' : 'none',
    }}>
      {stop && <StopContent stop={stop} detail={detail} loading={loading} onClose={onClose} showCloseButton />}
    </div>
  )
}
