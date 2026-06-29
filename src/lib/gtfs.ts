import type { Stop, Alert, Route, StopArrival, StopDetail } from '@/types'
import { fgcRecords, fgcAllRecords, fgcFeed } from './fgc'
import { fetchTrains } from './geotren'

type RawStop = {
  stop_id: string
  stop_name: string
  stop_coordinates: { lat: number; lon: number }
  wheelchair_boarding: number
}

export async function fetchStops(): Promise<Stop[]> {
  const all = await fgcAllRecords<RawStop>('gtfs_stops', undefined, 86400)

  return all.map(r => ({
    stopId: r.stop_id,
    name: r.stop_name,
    lat: r.stop_coordinates.lat,
    lng: r.stop_coordinates.lon,
    wheelchairBoarding: r.wheelchair_boarding === 1,
  }))
}

function pickText(
  ts: { translation?: Array<{ text: string; language?: string | null }> | null } | null | undefined,
): string {
  const list = ts?.translation
  if (!list?.length) return ''
  return (
    list.find(t => t.language === 'ca') ??
    list.find(t => t.language === 'es') ??
    list[0]
  ).text
}

export async function fetchRoutes(): Promise<Route[]> {
  type RawRoute = {
    route_id: string
    route_short_name: string
    route_long_name: string
    route_color: string
  }
  type RawShape = {
    route_id: string
    route_short_name: string
    shape: { type: 'Feature'; geometry: { type: 'MultiLineString'; coordinates: number[][][] } } | null
  }

  const [routesData, shapesData] = await Promise.all([
    fgcRecords<RawRoute>('lineas-red-fgc', { limit: 100 }, 86400),
    fgcRecords<RawShape>('gtfs_routes', { limit: 50 }, 86400).catch(() => null),
  ])

  // Build shape map from gtfs_routes (has geometry); lineas-red-fgc does not
  const shapeMap = new Map<string, { type: 'MultiLineString'; coordinates: number[][][] }>()
  if (shapesData) {
    for (const r of shapesData.results) {
      if (r.shape) shapeMap.set(r.route_short_name, r.shape.geometry)
    }
  }

  return routesData.results.map(r => ({
    routeId:   r.route_id,
    shortName: r.route_short_name,
    longName:  r.route_long_name,
    color:     `#${r.route_color}`,
    geometry:  shapeMap.get(r.route_short_name) ?? null,
  }))
}

export interface TripInfo {
  delay: number
  nextStopEta: number | null
}

// Returns a map of posicionament record id -> delay + next-stop ETA (unix seconds).
// The posicionament record `id` equals the GTFS `trip.tripId` (NOT the feed
// entity.id, which is prefixed `S|<date>|<tripId>`), so we key by tripId.
export async function fetchTripInfo(): Promise<Map<string, TripInfo>> {
  const feed = await fgcFeed('trip-updates-gtfs_realtime')

  const now = Date.now() / 1000
  const result = new Map<string, TripInfo>()

  for (const entity of feed.entity) {
    if (!entity.tripUpdate) continue
    const tu = entity.tripUpdate
    const tripId = tu.trip?.tripId
    if (!tripId) continue
    let delay = 0
    let nextStopEta: number | null = null

    for (const stu of tu.stopTimeUpdate ?? []) {
      const delaySec = (stu.arrival?.delay ?? stu.departure?.delay) as number | null | undefined
      if (delaySec != null && delaySec !== 0 && delay === 0) {
        delay = Math.round(delaySec / 60)
      }
      if (nextStopEta === null) {
        const t = (stu.arrival?.time ?? stu.departure?.time) as number | null | undefined
        if (t != null && (t as number) > now) {
          nextStopEta = t as number
        }
      }
      if (delay !== 0 && nextStopEta !== null) break
    }

    result.set(tripId, { delay, nextStopEta })
  }
  return result
}

// Returns a map of posicionament record id -> delay in minutes (from GTFS-RT arrival.delay)
export async function fetchTripDelays(): Promise<Map<string, number>> {
  const info = await fetchTripInfo()
  return new Map([...info.entries()].map(([id, v]) => [id, v.delay]))
}

// Median live delay (minutes) per line, from current train positions joined to
// GTFS-RT trip delays. Only lines actually running late appear (delay > 0).
// Shared by the trip planner and the station departures board.
export async function fetchLineDelays(): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  try {
    const [trains, delays] = await Promise.all([fetchTrains(), fetchTripDelays()])
    const byLine = new Map<string, number[]>()
    for (const t of trains) {
      const d = delays.get(t.id)
      if (d == null) continue
      const list = byLine.get(t.line)
      if (list) list.push(d)
      else byLine.set(t.line, [d])
    }
    for (const [line, list] of byLine) {
      list.sort((a, b) => a - b)
      const mid = list[Math.floor(list.length / 2)]
      if (mid > 0) result.set(line, mid)
    }
  } catch (err) {
    console.error('Live line-delay enrichment failed:', err)
  }
  return result
}

export interface VehiclePosition {
  vehicleId: string
  tripId: string
  lat: number
  lng: number
  stopId: string | null
  /** GTFS occupancy_status enum (0–8), or null if unreported. */
  occupancyStatus: number | null
  timestamp: number | null
}

// Official GTFS-Realtime vehicle positions. Keyed by tripId, which joins
// cleanly to trip-updates (delays) — useful as an authoritative cross-check
// for the `posicionament-dels-trens` feed.
export async function fetchVehiclePositions(): Promise<VehiclePosition[]> {
  const feed = await fgcFeed('vehicle-positions-gtfs_realtime')
  const out: VehiclePosition[] = []
  for (const e of feed.entity) {
    const v = e.vehicle
    if (!v?.position || !v.trip?.tripId) continue
    out.push({
      vehicleId: v.vehicle?.id ?? e.id,
      tripId: v.trip.tripId,
      lat: v.position.latitude,
      lng: v.position.longitude,
      stopId: v.stopId ?? null,
      occupancyStatus: v.occupancyStatus ?? null,
      timestamp: v.timestamp != null ? Number(v.timestamp) : null,
    })
  }
  return out
}

// Returns upcoming stop arrivals for a given trip. `tripId` is the posicionament
// record id, which matches the GTFS-RT trip.tripId (not the feed entity.id).
export async function fetchStopArrivals(
  tripId: string,
  stopNameMap: Map<string, string>,
): Promise<StopArrival[]> {
  const feed = await fgcFeed('trip-updates-gtfs_realtime')

  const entity = feed.entity.find(e => e.tripUpdate?.trip?.tripId === tripId)
  if (!entity?.tripUpdate) return []

  const now = Date.now() / 1000
  return (entity.tripUpdate.stopTimeUpdate ?? [])
    .filter(stu => {
      const t = (stu.departure?.time ?? stu.arrival?.time) as number | null | undefined
      return t != null && (t as number) > now
    })
    .map(stu => {
      const stopId = stu.stopId ?? ''
      const baseCode = stopId.replace(/\d+$/, '')
      return {
        stopId,
        name: stopNameMap.get(stopId) ?? stopNameMap.get(baseCode) ?? stopId,
        arrivalTime: (stu.arrival?.time as number) ?? 0,
        departureTime: (stu.departure?.time as number) ?? 0,
      }
    })
}

export async function fetchAlerts(): Promise<Alert[]> {
  const feed = await fgcFeed('alerts-gtfs_realtime')

  return feed.entity
    .filter(e => e.alert)
    .map(e => {
      const a = e.alert!
      return {
        id: e.id,
        header: pickText(a.headerText),
        description: pickText(a.descriptionText),
        routes: (a.informedEntity ?? [])
          .map(ie => ie.routeId)
          .filter((r): r is string => !!r),
      }
    })
    .filter(a => a.header)
}

// Air quality keyed by base stop code (no digit suffix), e.g. "PC", "SR"
export async function fetchAirQuality(): Promise<Map<string, StopDetail['air']>> {
  const data = await fgcRecords<{
    id: string
    iqam: string | null
    data_no2: number | null
    data_o3: number | null
    data_pm10: string | null
    nom_estaci: string | null
  }>('calidad-del-aire-por-paradas0', { limit: 100 }, 1800)

  const map = new Map<string, StopDetail['air']>()
  for (const r of data.results) {
    map.set(r.id, {
      iqam: (r.iqam as 'BO' | 'MODERAT' | 'DOLENT' | null) ?? null,
      no2: r.data_no2,
      o3: r.data_o3,
      pm10: r.data_pm10 != null ? Number(r.data_pm10) : null,
      stationName: r.nom_estaci,
    })
  }
  return map
}

// Current time-range weather keyed by base stop code
export async function fetchWeather(): Promise<Map<string, StopDetail['weather']>> {
  const data = await fgcRecords<{
    stop_id: string
    estat_del_cel: string
    rang_horari: string
  }>('prediccion-meteorologica-del-dia-por-paradas', { limit: 200 }, 3600)

  // Prefer the current time range; pick by closest to now
  const hour = new Date().getHours()
  const currentRange = hour < 12 ? 'Matí' : hour < 20 ? 'Tarda' : 'Nit'

  const map = new Map<string, StopDetail['weather']>()
  for (const r of data.results) {
    const baseCode = r.stop_id.replace(/\d+$/, '')
    // Prefer current range, but accept any if not found
    if (!map.has(baseCode) || r.rang_horari === currentRange) {
      map.set(baseCode, { sky: r.estat_del_cel, timeRange: r.rang_horari })
    }
  }
  return map
}

