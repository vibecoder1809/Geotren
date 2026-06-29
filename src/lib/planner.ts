import { STATION_CODES } from './constants'
import { fgcExport, fgcGtfsFile, fgcAllRecords } from './fgc'

// Minimum time (seconds) needed to change between two trips at a station.
const TRANSFER_SECONDS = 120

interface RawTimetableRow {
  date: string
  route_short_name: string
  trip_headsign: string
  stop_name: string
  stop_id: string
  arrival_time: string
  departure_time: string
  stop_sequence: number
  shape_id: number
  parent_station: string | null
  exception_type: number | null
}

interface TripStop {
  parent: string      // parent station code (e.g. "PC")
  name: string
  seq: number
  arrival: number     // seconds since midnight
  departure: number   // seconds since midnight
}

interface Trip {
  id: number
  line: string        // route_short_name
  headsign: string
  stops: TripStop[]
}

// A single ride between two consecutive stops on a trip.
interface Connection {
  depTime: number
  arrTime: number
  fromParent: string
  toParent: string
  fromName: string
  toName: string
  tripId: number
  line: string
  headsign: string
}

interface TimetableData {
  date: string                 // service date (YYYY-MM-DD) the data was built for
  connections: Connection[]    // sorted ascending by depTime
  tripConns: Map<number, Connection[]>  // tripId -> its connections, in stop order
  trips: Map<number, Trip>
  stationNames: Map<string, string>  // parent code -> display name
}

// ---- time helpers -------------------------------------------------------

function parseClock(t: string): number | null {
  // "HH:MM:SS" — GTFS times can exceed 24:00:00 for after-midnight services.
  const parts = t.split(':')
  if (parts.length !== 3) return null
  const h = Number(parts[0]), m = Number(parts[1]), s = Number(parts[2])
  if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(s)) return null
  return h * 3600 + m * 60 + s
}

export function formatClock(sec: number): string {
  const h = Math.floor(sec / 3600) % 24
  const m = Math.floor(sec / 60) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function parentOf(row: RawTimetableRow): string {
  if (row.parent_station) return row.parent_station
  return row.stop_id.replace(/\d+$/, '')
}

function displayName(parent: string, fallback: string): string {
  return STATION_CODES[parent] ?? fallback
}

// ---- build (cached per service date) ------------------------------------

let cache: TimetableData | null = null
let inflight: Promise<TimetableData> | null = null

function todayLocalISO(): string {
  // FGC service date in local (Europe/Madrid ~ server) terms.
  const now = new Date()
  const y = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

async function buildTimetable(): Promise<TimetableData> {
  const rows = await fgcExport<RawTimetableRow>('viajes-de-hoy', 3600)

  // Group rows into trips by (line, headsign, shape_id), then reconstruct
  // individual runs by chaining stop_sequence continuity over time.
  const groups = new Map<string, RawTimetableRow[]>()
  for (const r of rows) {
    if (r.exception_type != null && r.exception_type === 2) continue
    const key = `${r.route_short_name}|${r.trip_headsign}|${r.shape_id}`
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }

  const trips = new Map<number, Trip>()
  const stationNames = new Map<string, string>()
  let tripId = 0

  for (const [, recs] of groups) {
    // Sort by departure time then sequence.
    const prepared = recs
      .map(r => {
        const dep = parseClock(r.departure_time)
        const arr = parseClock(r.arrival_time) ?? dep
        if (dep == null || arr == null) return null
        const parent = parentOf(r)
        if (!stationNames.has(parent)) {
          stationNames.set(parent, displayName(parent, r.stop_name))
        }
        return { r, dep, arr, parent, seq: r.stop_sequence }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.dep - b.dep || a.seq - b.seq)

    // Greedy chaining: attach each stop to the open trip whose last stop is
    // exactly one sequence earlier and not later in time. Trains don't
    // overtake on the same shape, so the closest-in-time match is correct.
    const open: Trip[] = []
    for (const p of prepared) {
      let best: Trip | null = null
      for (const t of open) {
        const last = t.stops[t.stops.length - 1]
        if (last.seq === p.seq - 1 && last.departure <= p.dep) {
          if (best === null || best.stops[best.stops.length - 1].departure < last.departure) {
            best = t
          }
        }
      }
      const stop: TripStop = {
        parent: p.parent,
        name: stationNames.get(p.parent)!,
        seq: p.seq,
        arrival: p.arr,
        departure: p.dep,
      }
      if (best) {
        best.stops.push(stop)
      } else {
        const t: Trip = { id: tripId, line: p.r.route_short_name, headsign: p.r.trip_headsign, stops: [stop] }
        trips.set(tripId, t)
        open.push(t)
        tripId++
      }
    }
  }

  return assembleTimetable(todayLocalISO(), trips, stationNames)
}

// Flatten built trips into the sorted connection list + per-trip connection
// index the planner consumes. Shared by the today (viajes-de-hoy) builder and
// the date-specific GTFS builder.
function assembleTimetable(
  date: string,
  trips: Map<number, Trip>,
  stationNames: Map<string, string>,
): TimetableData {
  const connections: Connection[] = []
  const tripConns = new Map<number, Connection[]>()
  for (const trip of trips.values()) {
    const own: Connection[] = []
    for (let i = 0; i < trip.stops.length - 1; i++) {
      const a = trip.stops[i]
      const b = trip.stops[i + 1]
      if (b.arrival < a.departure) continue // guard against bad rows
      const conn: Connection = {
        depTime: a.departure,
        arrTime: b.arrival,
        fromParent: a.parent,
        toParent: b.parent,
        fromName: a.name,
        toName: b.name,
        tripId: trip.id,
        line: trip.line,
        headsign: trip.headsign,
      }
      connections.push(conn)
      own.push(conn)
    }
    if (own.length > 0) tripConns.set(trip.id, own)
  }
  connections.sort((x, y) => x.depTime - y.depTime)

  return { date, connections, tripConns, trips, stationNames }
}

// ---- date-specific build (full static GTFS) ----------------------------

// Maximum days ahead a journey may be planned for. The static GTFS feed covers
// further out, but we bound the work (and the cache) to a sensible window.
export const MAX_PLAN_DAYS_AHEAD = 7

// Parse a minimal CSV (no embedded newlines; quotes tolerated but FGC's GTFS
// files don't use them) into rows keyed by header. Lightweight on purpose —
// stop_times.txt is ~15MB, so we avoid per-cell allocation beyond the split.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n')
  const header = lines[0]?.replace(/\r$/, '').split(',') ?? []
  const out: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const cells = line.replace(/\r$/, '').split(',')
    const row: Record<string, string> = {}
    for (let j = 0; j < header.length; j++) row[header[j]] = cells[j] ?? ''
    out.push(row)
  }
  return out
}

interface CalendarDateRec { service_id: string; date: string; exception_type: number }

// Build the timetable for a specific service date from the static GTFS feed.
// Unlike the today builder (which chains a flat dataset), GTFS stop_times has a
// real trip_id per run, so trips are grouped directly — simpler and exact.
async function buildTimetableForDate(date: string): Promise<TimetableData> {
  // 1. Which services run on this date (exception_type 1 = added/runs).
  const calRows = await fgcAllRecords<CalendarDateRec>(
    'calendar_dates',
    { where: `date=date'${date}' AND exception_type=1`, select: 'service_id' },
    86400,
  )
  const runningServices = new Set(calRows.map(r => r.service_id))
  if (runningServices.size === 0) {
    return { date, connections: [], tripConns: new Map(), trips: new Map(), stationNames: new Map() }
  }

  // 2. Pull the static GTFS member files in parallel.
  const [tripsTxt, stopTimesTxt, stopsTxt] = await Promise.all([
    fgcGtfsFile('trips.txt'),
    fgcGtfsFile('stop_times.txt'),
    fgcGtfsFile('stops.txt'),
  ])

  // stop_id -> { parent code, display name }
  const stopInfo = new Map<string, { parent: string; name: string }>()
  const stationNames = new Map<string, string>()
  for (const s of parseCsv(stopsTxt)) {
    const stopId = s.stop_id
    if (!stopId) continue
    const parent = s.parent_station || stopId.replace(/\d+$/, '')
    stopInfo.set(stopId, { parent, name: s.stop_name })
    if (!stationNames.has(parent)) {
      stationNames.set(parent, STATION_CODES[parent] ?? s.stop_name)
    }
  }

  // trip_id -> { line, headsign } for trips whose service runs today.
  const tripMeta = new Map<string, { line: string; headsign: string }>()
  for (const tr of parseCsv(tripsTxt)) {
    if (!runningServices.has(tr.service_id)) continue
    // route_id equals route_short_name in this feed (e.g. "R5", "L6").
    tripMeta.set(tr.trip_id, { line: tr.route_id, headsign: tr.trip_headsign })
  }

  // 3. Group stop_times rows by trip_id (only for running trips), building the
  // ordered stop list per trip.
  interface RawStopTime { seq: number; arr: number; dep: number; parent: string; name: string }
  const byTrip = new Map<string, RawStopTime[]>()
  for (const st of parseCsv(stopTimesTxt)) {
    const meta = tripMeta.get(st.trip_id)
    if (!meta) continue
    const info = stopInfo.get(st.stop_id)
    if (!info) continue
    const dep = parseClock(st.departure_time)
    const arr = parseClock(st.arrival_time) ?? dep
    if (dep == null || arr == null) continue
    const list = byTrip.get(st.trip_id)
    const row = { seq: Number(st.stop_sequence), arr, dep, parent: info.parent, name: info.name }
    if (list) list.push(row)
    else byTrip.set(st.trip_id, [row])
  }

  // 4. Materialise Trip objects with integer ids.
  const trips = new Map<number, Trip>()
  let id = 0
  for (const [tripId, rows] of byTrip) {
    const meta = tripMeta.get(tripId)!
    rows.sort((a, b) => a.seq - b.seq)
    const stops: TripStop[] = rows.map(r => ({
      parent: r.parent, name: r.name, seq: r.seq, arrival: r.arr, departure: r.dep,
    }))
    if (stops.length < 2) continue
    trips.set(id, { id, line: meta.line, headsign: meta.headsign, stops })
    id++
  }

  return assembleTimetable(date, trips, stationNames)
}

// Cache built timetables per service date (today via the fast viajes-de-hoy
// path, other dates via the static GTFS builder). Bounded to the planning
// window so it can't grow without limit.
const dateCache = new Map<string, TimetableData>()
const dateInflight = new Map<string, Promise<TimetableData>>()

async function getTimetable(date?: string): Promise<TimetableData> {
  const today = todayLocalISO()
  const target = date ?? today

  if (target === today) {
    if (cache && cache.date === today) return cache
    if (inflight) return inflight
    inflight = buildTimetable()
      .then(data => { cache = data; inflight = null; return data })
      .catch(err => { inflight = null; throw err })
    return inflight
  }

  const cached = dateCache.get(target)
  if (cached) return cached
  const pending = dateInflight.get(target)
  if (pending) return pending
  const build = buildTimetableForDate(target)
    .then(data => { dateCache.set(target, data); dateInflight.delete(target); return data })
    .catch(err => { dateInflight.delete(target); throw err })
  dateInflight.set(target, build)
  return build
}

// ---- public: station list ----------------------------------------------

export interface PlannerStation {
  code: string
  name: string
}

export async function getStations(): Promise<PlannerStation[]> {
  const data = await getTimetable()
  return [...data.stationNames.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ca'))
}

// ---- public: station departures board -----------------------------------

export interface Departure {
  line: string
  headsign: string   // trip destination shown on the board
  depTime: number    // scheduled seconds since midnight
  tripId: number
}

// The next scheduled departures leaving `stationCode` at or after
// `afterSeconds`. A trip departs a station via exactly one connection whose
// `fromParent` is that station, and the connection list is already sorted by
// departure time, so we just take the first `count` such connections.
export async function getDepartures(
  stationCode: string,
  afterSeconds: number,
  count = 8,
  date?: string,
): Promise<Departure[]> {
  const data = await getTimetable(date)
  if (!data.stationNames.has(stationCode)) return []

  const out: Departure[] = []
  for (const c of data.connections) {
    if (c.depTime < afterSeconds) continue
    if (c.fromParent !== stationCode) continue
    out.push({ line: c.line, headsign: c.headsign, depTime: c.depTime, tripId: c.tripId })
    if (out.length >= count) break
  }
  return out
}

// ---- public: journey planning (CSA) -------------------------------------

export interface JourneyLeg {
  line: string
  headsign: string
  fromCode: string
  fromName: string
  toCode: string
  toName: string
  depTime: number       // seconds since midnight (scheduled)
  arrTime: number
  intermediateStops: number
}

export interface Journey {
  legs: JourneyLeg[]
  depTime: number
  arrTime: number
  durationMin: number
  transfers: number
  /** Live delay (minutes) currently reported for the first leg's line, if any. */
  liveDelayMin?: number
}

// Penalty (seconds) added per boarding so the search prefers staying on one
// train over hopping between parallel services on the same corridor. A change
// only "wins" if it saves more than this much time. Set high (20 min) because
// FGC corridors run several parallel lines; without a strong bias the
// earliest-arrival scan produces absurd "hop every other stop" itineraries.
const TRANSFER_PENALTY = 1200

interface Label {
  arr: number               // best known real arrival time at this stop
  cost: number              // arr + TRANSFER_PENALTY * transfers (ranking key)
  transfers: number         // number of boardings used to reach this stop
  conn: Connection | null   // last connection ridden to reach it (null = origin)
  boardStop: string | null  // stop where the trip behind `conn` was boarded
}

// Reconstruct the connection path by walking transfers backward. Each label
// records the stop where its trip was boarded, so we slice the trip's
// connections between board and alight, then jump to the board stop's label
// (a transfer) and repeat. This avoids mixing connections from different
// competing paths that happen to share an intermediate stop.
function reconstruct(
  origin: string,
  dest: string,
  labels: Map<string, Label>,
  tripConns: Map<number, Connection[]>,
): Connection[] | null {
  const path: Connection[] = []
  let cur = dest
  const guard = new Set<string>()
  while (cur !== origin) {
    const label = labels.get(cur)
    if (!label || !label.conn || label.boardStop == null) return null
    if (guard.has(cur)) return null // cycle safety — should never happen
    guard.add(cur)

    const conns = tripConns.get(label.conn.tripId)
    if (!conns) return null
    // Take the slice of this trip from boardStop up to the alight stop (cur).
    const boardStop = label.boardStop
    const startIdx = conns.findIndex(x => x.fromParent === boardStop)
    const endIdx = conns.findIndex(x => x.toParent === cur)
    if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return null
    for (let i = endIdx; i >= startIdx; i--) path.push(conns[i])
    cur = boardStop
  }
  path.reverse()
  return path
}

// Gap (seconds) below which two consecutive same-line legs are treated as one
// ride. Trip reconstruction sometimes splits a single physical train into
// several phantom trips; those splits show up as second-level gaps. Genuine
// same-line transfers (waiting for a later train) have multi-minute gaps.
const PHANTOM_GAP = 150

function legsFromPath(path: Connection[]): JourneyLeg[] {
  const legs: JourneyLeg[] = []
  for (const c of path) {
    const last = legs[legs.length - 1]
    if (last && last.toCode === c.fromParent && last.line === c.line && last.headsign === c.headsign) {
      // same trip continuing — extend the leg
      last.toCode = c.toParent
      last.toName = c.toName
      last.arrTime = c.arrTime
      last.intermediateStops++
    } else {
      legs.push({
        line: c.line,
        headsign: c.headsign,
        fromCode: c.fromParent,
        fromName: c.fromName,
        toCode: c.toParent,
        toName: c.toName,
        depTime: c.depTime,
        arrTime: c.arrTime,
        intermediateStops: 0,
      })
    }
  }

  // Collapse phantom splits: consecutive same-line legs separated by only a
  // few seconds are really one ride that got split during reconstruction.
  const merged: JourneyLeg[] = []
  for (const leg of legs) {
    const prev = merged[merged.length - 1]
    if (prev && prev.line === leg.line && leg.depTime - prev.arrTime <= PHANTOM_GAP) {
      prev.toCode = leg.toCode
      prev.toName = leg.toName
      prev.arrTime = leg.arrTime
      prev.intermediateStops += leg.intermediateStops + 1
    } else {
      merged.push(leg)
    }
  }
  return merged
}

/**
 * Plan the earliest-arrival journey from origin to dest departing at or after
 * `afterSeconds` (seconds since midnight). Uses the Connection Scan Algorithm
 * with a fixed transfer buffer so it doesn't hop between parallel trains.
 */
export async function planJourney(
  originCode: string,
  destCode: string,
  afterSeconds: number,
  lineDelays?: Map<string, number>,
  date?: string,
): Promise<Journey | null> {
  const data = await getTimetable(date)
  if (originCode === destCode) return null
  if (!data.stationNames.has(originCode) || !data.stationNames.has(destCode)) return null

  const labels = new Map<string, Label>()
  labels.set(originCode, { arr: afterSeconds, cost: afterSeconds, transfers: 0, conn: null, boardStop: null })

  // Per-trip carried state: the cheapest way found to be riding this trip —
  // the boarding label's transfer count plus the stop where we boarded.
  const tripState = new Map<number, { transfers: number; boardStop: string }>()

  const labelAt = (s: string) => labels.get(s)
  const costAt = (s: string) => labels.get(s)?.cost ?? Infinity
  // Latest departure worth scanning: once a connection departs after the best
  // destination arrival, it can never be part of an earlier-arriving journey.
  let bestDestArr = Infinity
  let bestDestCost = Infinity

  for (const c of data.connections) {
    if (c.depTime < afterSeconds) continue
    if (c.depTime > bestDestArr) break // nothing later can reach the dest sooner

    const fromLabel = labelAt(c.fromParent)
    let riding = tripState.get(c.tripId)

    // Can we board this connection by transferring here?
    if (fromLabel) {
      const needBuffer = c.fromParent === originCode ? 0 : TRANSFER_SECONDS
      if (fromLabel.arr + needBuffer <= c.depTime) {
        const boardTransfers = fromLabel.transfers + 1
        if (!riding || boardTransfers < riding.transfers) {
          riding = { transfers: boardTransfers, boardStop: c.fromParent }
          tripState.set(c.tripId, riding)
        }
      }
    }

    if (!riding) continue // not on this trip yet

    const arr = c.arrTime
    const cost = arr + TRANSFER_PENALTY * riding.transfers
    if (cost < costAt(c.toParent)) {
      labels.set(c.toParent, { arr, cost, transfers: riding.transfers, conn: c, boardStop: riding.boardStop })
      if (c.toParent === destCode) {
        if (cost < bestDestCost) bestDestCost = cost
        if (arr < bestDestArr) bestDestArr = arr
      }
    }
  }

  const path = reconstruct(originCode, destCode, labels, data.tripConns)
  if (!path || path.length === 0) return null

  const legs = legsFromPath(path)
  const depTime = legs[0].depTime
  const arrTime = legs[legs.length - 1].arrTime
  const liveDelayMin = lineDelays?.get(legs[0].line)
  return {
    legs,
    depTime,
    arrTime,
    durationMin: Math.round((arrTime - depTime) / 60),
    transfers: legs.length - 1,
    ...(liveDelayMin ? { liveDelayMin } : {}),
  }
}

/**
 * Plan the next `count` departures (each leaving after the previous one's
 * first departure) from origin to dest at or after `afterSeconds`.
 */
export async function planJourneys(
  originCode: string,
  destCode: string,
  afterSeconds: number,
  count = 4,
  lineDelays?: Map<string, number>,
  date?: string,
): Promise<Journey[]> {
  const journeys: Journey[] = []
  let after = afterSeconds
  for (let i = 0; i < count; i++) {
    const j = await planJourney(originCode, destCode, after, lineDelays, date)
    if (!j) break
    journeys.push(j)
    // Next search starts one second after this option's first departure.
    after = j.depTime + 1
  }
  return journeys
}
