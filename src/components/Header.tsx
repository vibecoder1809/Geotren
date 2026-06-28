'use client'

import { useState, useEffect, useRef } from 'react'
import { useI18n, LANGS, type Lang } from '@/lib/i18n'

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

export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const current = LANGS.find(l => l.code === lang)!

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--muted)', padding: compact ? '6px 10px' : '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: compact ? 11 : 12, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {compact ? current.label : `${t('language')}: ${current.label}`}
        <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden', zIndex: 50, boxShadow: '0 10px 25px rgba(0,0,0,0.25)', minWidth: 120 }}>
          {LANGS.map(l => (
            <div
              key={l.code}
              onClick={() => { setLang(l.code as Lang); setOpen(false) }}
              style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 13, color: l.code === lang ? 'var(--accent)' : 'var(--text)', fontWeight: l.code === lang ? 600 : 400, background: l.code === lang ? 'var(--bg3)' : 'transparent' }}
              onMouseEnter={e => { if (l.code !== lang) e.currentTarget.style.background = 'var(--bg3)' }}
              onMouseLeave={e => { if (l.code !== lang) e.currentTarget.style.background = 'transparent' }}
            >
              {l.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface HeaderProps {
  trainCount: number
  lineCount: number
  lastUpdate: Date | null
  refreshing: boolean
  onThemeToggle: () => void
  onRefresh: () => void
}

export function Header({ trainCount, lineCount, lastUpdate, refreshing, onThemeToggle, onRefresh }: HeaderProps) {
  const { t } = useI18n()
  const relativeTime = useRelativeTime(lastUpdate)

  return (
    <header style={{
      gridColumn: '1 / -1',
      background: 'var(--bg2)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 20px',
      gap: 16,
      zIndex: 10,
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ fontFamily: 'var(--font-space-grotesk), sans-serif', fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src="/logo.svg" alt="" style={{ width: 28, height: 28, borderRadius: 6 }} />
        Geotren
      </div>

      {/* Live badge */}
      <div style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: 'var(--green)', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse-dot 1.5s infinite' }} />
        {t('live')}
      </div>

      {/* Stats */}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          <b style={{ color: 'var(--text)', fontSize: 13 }}>{trainCount}</b> {t('trains')}
        </span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          <b style={{ color: 'var(--text)', fontSize: 13 }}>{lineCount}</b> {t('lines')}
        </span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {t('updatedShort')} <b style={{ color: 'var(--text)', fontSize: 13 }}>{relativeTime}</b>
        </span>
        <LanguagePicker />
        <button onClick={onThemeToggle} style={{ background: 'none', border: '1px solid var(--border2)', color: 'var(--muted)', padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
          {t('theme')}
        </button>
        <button onClick={onRefresh} disabled={refreshing} style={{ background: 'none', border: '1px solid var(--border2)', color: refreshing ? 'var(--accent)' : 'var(--muted)', padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', opacity: refreshing ? 0.7 : 1 }}>
          {refreshing ? t('loading') : t('refresh')}
        </button>
      </div>
    </header>
  )
}
