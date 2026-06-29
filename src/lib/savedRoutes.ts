'use client'

import { useState, useEffect, useCallback } from 'react'

// A persisted origin→destination pair. We store the station code (the planner's
// key) plus the display name so the list renders without needing the full
// station catalogue loaded yet.
export interface SavedRoute {
  fromCode: string
  fromName: string
  toCode: string
  toName: string
}

const FAV_KEY    = 'geotren-fav-routes'
const RECENT_KEY = 'geotren-recent-routes'
const MAX_RECENT = 6

// Two routes are "the same" iff both endpoints match. Direction matters — A→B
// and B→A are distinct saved trips.
export function sameRoute(a: SavedRoute, b: SavedRoute): boolean {
  return a.fromCode === b.fromCode && a.toCode === b.toCode
}

function read(key: string): SavedRoute[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Guard against malformed/stale entries from older versions.
    return parsed.filter(
      (r): r is SavedRoute =>
        r && typeof r.fromCode === 'string' && typeof r.toCode === 'string' &&
        typeof r.fromName === 'string' && typeof r.toName === 'string',
    )
  } catch {
    return []
  }
}

function write(key: string, routes: SavedRoute[]) {
  try { window.localStorage.setItem(key, JSON.stringify(routes)) } catch {}
}

// Favorites (user-pinned) and recents (auto-recorded) for the trip planner,
// persisted to localStorage. State is hydrated after mount to avoid an SSR
// mismatch, matching the i18n provider's pattern.
export function useSavedRoutes() {
  const [favorites, setFavorites] = useState<SavedRoute[]>([])
  const [recents, setRecents]     = useState<SavedRoute[]>([])

  useEffect(() => {
    setFavorites(read(FAV_KEY))
    setRecents(read(RECENT_KEY))
  }, [])

  const isFavorite = useCallback(
    (r: SavedRoute) => favorites.some(f => sameRoute(f, r)),
    [favorites],
  )

  const toggleFavorite = useCallback((r: SavedRoute) => {
    setFavorites(prev => {
      const next = prev.some(f => sameRoute(f, r))
        ? prev.filter(f => !sameRoute(f, r))
        : [r, ...prev]
      write(FAV_KEY, next)
      return next
    })
  }, [])

  // Push a route to the top of the recents list (de-duplicated, capped).
  const recordRecent = useCallback((r: SavedRoute) => {
    setRecents(prev => {
      const next = [r, ...prev.filter(x => !sameRoute(x, r))].slice(0, MAX_RECENT)
      write(RECENT_KEY, next)
      return next
    })
  }, [])

  const clearRecents = useCallback(() => {
    setRecents([])
    write(RECENT_KEY, [])
  }, [])

  return { favorites, recents, isFavorite, toggleFavorite, recordRecent, clearRecents }
}
