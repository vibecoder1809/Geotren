import { useEffect, useRef, useState } from 'react'
import type { Train, Route, Stop } from '@/types'

// --- Geometry helpers (all coords are [lng, lat]) ---

const DEG2RAD = Math.PI / 180
const EARTH_R  = 6_371_000 // metres

function haversine(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * DEG2RAD
  const dLng = (b[0] - a[0]) * DEG2RAD
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(a[1] * DEG2RAD) * Math.cos(b[1] * DEG2RAD) * sinLng * sinLng
  return 2 * EARTH_R * Math.asin(Math.sqrt(h))
}

interface Polyline {
  pts:      [number, number][]   // [lng, lat]
  cumDist:  number[]             // cumulative metres from pts[0], length === pts.length
  totalLen: number
}

function buildPolyline(coords: number[][][]): Polyline | null {
  // Flatten MultiLineString segments into one continuous path.
  // Adjacent segments that don't share an endpoint get a straight join.
  if (!coords.length) return null
  const pts: [number, number][] = []

  for (const seg of coords) {
    if (!seg.length) continue
    const start = seg[0] as [number, number]
    // If pts is non-empty and the last point matches this segment's start, skip duplicate
    if (pts.length > 0) {
      const last = pts[pts.length - 1]
      if (Math.abs(last[0] - start[0]) > 1e-7 || Math.abs(last[1] - start[1]) > 1e-7) {
        pts.push(start)
      }
    } else {
      pts.push(start)
    }
    for (let i = 1; i < seg.length; i++) {
      pts.push(seg[i] as [number, number])
    }
  }

  if (pts.length < 2) return null

  const cumDist: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    cumDist.push(cumDist[i - 1] + haversine(pts[i - 1], pts[i]))
  }

  return { pts, cumDist, totalLen: cumDist[cumDist.length - 1] }
}

function positionAtDistance(pl: Polyline, dist: number): [number, number] {
  const clamped = Math.max(0, Math.min(dist, pl.totalLen))
  // Binary search for the segment containing `clamped`
  let lo = 0, hi = pl.cumDist.length - 2
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pl.cumDist[mid + 1] < clamped) lo = mid + 1
    else hi = mid
  }
  const segLen = pl.cumDist[lo + 1] - pl.cumDist[lo]
  const t = segLen > 0 ? (clamped - pl.cumDist[lo]) / segLen : 0
  const a = pl.pts[lo], b = pl.pts[lo + 1]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

// Project a point onto the polyline, return distance along it (metres)
function projectOntoPolyline(pt: [number, number], pl: Polyline): number {
  let bestDist = Infinity
  let bestAlong = 0

  for (let i = 0; i < pl.pts.length - 1; i++) {
    const a = pl.pts[i], b = pl.pts[i + 1]
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const lenSq = dx * dx + dy * dy
    let t = 0
    if (lenSq > 0) {
      t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / lenSq))
    }
    const cx = a[0] + t * dx, cy = a[1] + t * dy
    const d2 = (pt[0] - cx) ** 2 + (pt[1] - cy) ** 2
    if (d2 < bestDist) {
      bestDist = d2
      bestAlong = pl.cumDist[i] + t * haversine(a, b)
    }
  }

  return bestAlong
}

// --- Per-train interpolation state ---

interface TrainState {
  id:         string
  polyline:   Polyline
  distAlong:  number    // current position along polyline (metres)
  // If dwelling at a station, until when (performance.now() ms)
  dwellUntil: number
  // Direction: +1 or -1 along the polyline
  direction:  1 | -1
  lat:        number
  lng:        number
}

// Typical FGC inter-city speed in m/s (~80 km/h for mainline, ~60 for urban)
const SPEED_MS = 10.5 // ~38 km/h — FGC average commercial speed
const DWELL_MS = 30_000 // 30 s station dwell
// If the real API position is >500 m from where we think the train is, hard-snap it
const SNAP_THRESHOLD_M = 500

// Match a stop name to its coordinate on the polyline
function findStopDist(stopName: string, stops: Stop[], pl: Polyline): number | null {
  const stop = stops.find(s => s.name === stopName)
  if (!stop) return null
  return projectOntoPolyline([stop.lng, stop.lat], pl)
}

// Determine which direction along the polyline the train is heading.
// We use the next upcoming stop: it should be further along than the current position.
function resolveDirection(
  currentDistAlong: number,
  train: Train,
  stops: Stop[],
  pl: Polyline,
): 1 | -1 {
  for (const stopName of train.upcomingStops) {
    const d = findStopDist(stopName, stops, pl)
    if (d == null) continue
    const diff = d - currentDistAlong
    if (Math.abs(diff) > 100) return diff > 0 ? 1 : -1
  }
  // Fall back: destination end of polyline
  const destD = findStopDist(train.destination, stops, pl)
  if (destD != null) {
    const diff = destD - currentDistAlong
    if (Math.abs(diff) > 100) return diff > 0 ? 1 : -1
  }
  return 1
}

// --- The hook ---

export function useInterpolatedTrains(
  apiTrains: Train[],
  routes: Route[],
  stops: Stop[],
): Train[] {
  const stateMap    = useRef<Map<string, TrainState>>(new Map())
  const rafRef      = useRef<number | null>(null)
  const lastTick    = useRef<number>(performance.now())
  const lastRender  = useRef<number>(0)
  const RENDER_INTERVAL = 100  // ms — cap React re-renders at ~10fps

  const [displayed, setDisplayed] = useState<Train[]>(apiTrains)

  const polylineCache = useRef<Map<string, Polyline>>(new Map())

  // Sync API snapshot → stateMap
  useEffect(() => {
    const now = performance.now()

    function getPolyline(lineName: string): Polyline | null {
      if (polylineCache.current.has(lineName)) return polylineCache.current.get(lineName)!
      const route = routes.find(r => r.shortName === lineName)
      if (!route?.geometry) return null
      const pl = buildPolyline(route.geometry.coordinates)
      if (pl) polylineCache.current.set(lineName, pl)
      return pl
    }

    for (const train of apiTrains) {
      const pl = getPolyline(train.line)
      if (!pl) continue

      const realPt: [number, number] = [train.lng, train.lat]
      const realDist = projectOntoPolyline(realPt, pl)

      const existing = stateMap.current.get(train.id)

      if (!existing) {
        // New train — seed from real position
        const dir = resolveDirection(realDist, train, stops, pl)
        stateMap.current.set(train.id, {
          id: train.id,
          polyline: pl,
          distAlong: realDist,
          dwellUntil: train.currentStop ? now + DWELL_MS : 0,
          direction: dir,
          lat: train.lat,
          lng: train.lng,
        })
      } else {
        // Update polyline if route data changed
        existing.polyline = pl

        // Hard-snap if too far off, otherwise keep interpolated position
        const drift = haversine(realPt, [existing.lng, existing.lat])
        if (drift > SNAP_THRESHOLD_M) {
          existing.distAlong = realDist
          existing.lat = train.lat
          existing.lng = train.lng
        }

        // Update direction from fresh upcoming-stops data
        existing.direction = resolveDirection(existing.distAlong, train, stops, pl)

        // If newly at a station, start dwell
        if (train.currentStop && existing.dwellUntil < now) {
          existing.dwellUntil = now + DWELL_MS
        }
      }
    }

    // Remove trains that disappeared from the API
    const apiIds = new Set(apiTrains.map(t => t.id))
    for (const id of stateMap.current.keys()) {
      if (!apiIds.has(id)) stateMap.current.delete(id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiTrains, routes, stops])

  // Animation loop
  useEffect(() => {
    function tick(now: number) {
      const dt = (now - lastTick.current) / 1000  // seconds
      lastTick.current = now

      let anyMoved = false

      for (const state of stateMap.current.values()) {
        if (now < state.dwellUntil) continue   // dwelling at station
        const move = SPEED_MS * dt * state.direction
        const next = state.distAlong + move

        // Clamp to polyline ends
        const clamped = Math.max(0, Math.min(next, state.polyline.totalLen))
        if (clamped === state.distAlong) continue

        state.distAlong = clamped
        const [lng, lat] = positionAtDistance(state.polyline, clamped)
        if (Math.abs(state.lat - lat) > 1e-8 || Math.abs(state.lng - lng) > 1e-8) {
          state.lat = lat
          state.lng = lng
          anyMoved = true
        }
      }

      if (anyMoved && now - lastRender.current >= RENDER_INTERVAL) {
        lastRender.current = now
        setDisplayed(
          apiTrains.map(t => {
            const st = stateMap.current.get(t.id)
            if (!st) return t
            return { ...t, lat: st.lat, lng: st.lng }
          })
        )
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiTrains])

  // If no routes yet (first load), just show raw API data
  if (routes.length === 0) return apiTrains

  return displayed
}
