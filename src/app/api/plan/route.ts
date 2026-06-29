import { planJourneys, MAX_PLAN_DAYS_AHEAD } from '@/lib/planner'
import { fetchLineDelays } from '@/lib/gtfs'

function parseAfter(raw: string | null): number {
  // Accepts "HH:MM"; defaults to current local time.
  if (raw) {
    const m = raw.match(/^(\d{1,2}):(\d{2})$/)
    if (m) {
      const h = Number(m[1]), min = Number(m[2])
      if (h < 24 && min < 60) return h * 3600 + min * 60
    }
  }
  const now = new Date()
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
}

function localISO(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

// Validate a requested service date: must be YYYY-MM-DD within
// [today, today + MAX_PLAN_DAYS_AHEAD]. Returns the ISO date, or null for
// today/invalid (planner treats undefined as today).
function parseDate(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const max = new Date(today)
  max.setDate(max.getDate() + MAX_PLAN_DAYS_AHEAD)
  const req = new Date(`${raw}T00:00:00`)
  if (Number.isNaN(req.getTime()) || req < today || req > max) return null
  const iso = localISO(req)
  return iso === localISO(today) ? null : iso
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const after = parseAfter(url.searchParams.get('after'))
  const date = parseDate(url.searchParams.get('date'))

  if (!from || !to) {
    return Response.json({ error: 'Missing from/to' }, { status: 400 })
  }
  if (from === to) {
    return Response.json({ error: "L'origen i la destinació són iguals" }, { status: 400 })
  }

  try {
    // Live delays only make sense for today's plan; skip the enrichment (and
    // its network cost) when planning a future date.
    const lineDelays = date ? undefined : await fetchLineDelays()
    const journeys = await planJourneys(from, to, after, 4, lineDelays, date ?? undefined)
    return Response.json({ journeys })
  } catch (err) {
    console.error('Plan failed:', err)
    return Response.json({ error: 'No es pot calcular la ruta' }, { status: 503 })
  }
}
