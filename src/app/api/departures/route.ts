import { getDepartures } from '@/lib/planner'
import { fetchLineDelays } from '@/lib/gtfs'

// Seconds since local midnight, matching the planner's depTime units.
function nowSeconds(): number {
  const n = new Date()
  return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()
}

// Next scheduled departures from a station (by parent code, e.g. "SC"),
// enriched with the current median live delay for each line.
export async function GET(req: Request) {
  const station = new URL(req.url).searchParams.get('station')
  if (!station) {
    return Response.json({ error: 'Missing station' }, { status: 400 })
  }

  try {
    const [departures, lineDelays] = await Promise.all([
      getDepartures(station, nowSeconds(), 8),
      fetchLineDelays(),
    ])
    const enriched = departures.map(d => ({
      line: d.line,
      headsign: d.headsign,
      depTime: d.depTime,
      delayMin: lineDelays.get(d.line) ?? 0,
    }))
    return Response.json({ departures: enriched })
  } catch (err) {
    console.error('Departures failed:', err)
    return Response.json({ error: 'No es poden carregar les sortides' }, { status: 503 })
  }
}
