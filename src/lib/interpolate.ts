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
  // Animation speed (m/s) for this train. Derived from the real distance to the
  // next stop and the real ETA when available (dead-reckoning), else SPEED_MS.
  speed:      number
  // Distances (m along polyline) of upcoming stops the train should pause at,
  // and the set already serviced this leg so we don't dwell twice.
  stopDists:  number[]
  servicedStops: Set<number>
}

// Typical FGC inter-city speed in m/s (~80 km/h for mainline, ~60 for urban)
const SPEED_MS = 19 // ~68 km/h — closer to FGC peak running speed
const DWELL_MS = 20_000 // 20 s station dwell
// How close (m) the animated train must get to a stop to trigger a dwell
const STOP_TRIGGER_M = 60
// If the real API position is >500 m from where we think the train is, hard-snap it
const SNAP_THRESHOLD_M = 500

// Match a stop name to its coordinate on the polyline
function findStopDist(stopName: string, stops: Stop[], pl: Polyline): number | null {
  const stop = stops.find(s => s.name === stopName)
  if (!stop) return null
  return projectOntoPolyline([stop.lng, stop.lat], pl)
}

// Distances along the polyline (sorted) of every stop this train still has to
// serve — its upcoming stops plus the final destination.
function upcomingStopDists(train: Train, stops: Stop[], pl: Polyline): number[] {
  const names = [...train.upcomingStops, train.destination]
  const dists: number[] = []
  for (const name of names) {
    const d = findStopDist(name, stops, pl)
    if (d != null) dists.push(d)
  }
  return dists.sort((a, b) => a - b)
}

// Dead-reckon the animation speed (m/s) from the real distance to the next
// upcoming stop and its real ETA. This makes the train cover the actual gap in
// the actual time the API predicts, rather than gliding at a fixed guess.
// Falls back to SPEED_MS when there's no usable ETA or it's already in the past.
function resolveSpeed(
  currentDistAlong: number,
  train: Train,
  stops: Stop[],
  pl: Polyline,
): number {
  if (train.nextStopEta == null || !train.upcomingStops.length) return SPEED_MS
  const secsLeft = train.nextStopEta - Date.now() / 1000
  if (secsLeft <= 1) return SPEED_MS  // arriving now / stale ETA — use default

  const nextStopD = findStopDist(train.upcomingStops[0], stops, pl)
  if (nextStopD == null) return SPEED_MS
  const gap = Math.abs(nextStopD - currentDistAlong)
  if (gap < STOP_TRIGGER_M) return SPEED_MS  // already essentially there

  const speed = gap / secsLeft
  // Guard against absurd values from bad data (e.g. wrong stop match).
  if (!Number.isFinite(speed) || speed < 1 || speed > 45) return SPEED_MS
  return speed
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
          speed: resolveSpeed(realDist, train, stops, pl),
          stopDists: upcomingStopDists(train, stops, pl),
          servicedStops: new Set(),
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

        // Re-derive speed from the fresh ETA so each leg animates at the rate
        // the API actually predicts.
        existing.speed = resolveSpeed(existing.distAlong, train, stops, pl)

        // Refresh the upcoming-stop distances from the new snapshot, and forget
        // serviced stops that are no longer upcoming.
        existing.stopDists = upcomingStopDists(train, stops, pl)
        existing.servicedStops.clear()

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
        const move = state.speed * dt * state.direction
        const next = state.distAlong + move

        // Clamp to polyline ends
        const clamped = Math.max(0, Math.min(next, state.polyline.totalLen))
        if (clamped === state.distAlong) continue

        // Pause at any station we just reached/passed this frame that we
        // haven't already serviced — mimics the real station dwell.
        const lo = Math.min(state.distAlong, clamped)
        const hi = Math.max(state.distAlong, clamped)
        let dwellHit: number | null = null
        for (const sd of state.stopDists) {
          if (state.servicedStops.has(sd)) continue
          // crossed it, or ended this frame within trigger range of it
          if ((sd >= lo - STOP_TRIGGER_M && sd <= hi + STOP_TRIGGER_M)) {
            if (dwellHit == null || Math.abs(sd - state.distAlong) < Math.abs(dwellHit - state.distAlong)) {
              dwellHit = sd
            }
          }
        }
        if (dwellHit != null) {
          // Snap to the stop, mark serviced, and dwell.
          state.distAlong = dwellHit
          state.servicedStops.add(dwellHit)
          state.dwellUntil = now + DWELL_MS
          const [lng, lat] = positionAtDistance(state.polyline, dwellHit)
          state.lat = lat
          state.lng = lng
          anyMoved = true
          continue
        }

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
