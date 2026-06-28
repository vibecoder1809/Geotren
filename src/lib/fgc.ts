// Thin typed client for the FGC Open Data portal (Opendatasoft v2.1).
//
// Every dataset on dadesobertes.fgc.cat is reachable through the same handful
// of endpoints, so this module centralises the URL building, paging, caching
// policy, and GTFS-Realtime protobuf decoding that the per-dataset fetchers
// used to each re-implement.

const BASE = 'https://dadesobertes.fgc.cat/api/explore/v2.1/catalog/datasets'

type Primitive = string | number | boolean

interface RecordsResponse<T> {
  total_count: number
  results: T[]
}

function buildQuery(params?: Record<string, Primitive | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

/**
 * Fetch a single page of records from a dataset. `revalidate` (seconds) sets
 * the Next.js cache lifetime; pass 0 for always-fresh (`cache: 'no-store'`).
 */
export async function fgcRecords<T>(
  dataset: string,
  params?: Record<string, Primitive | undefined>,
  revalidate = 3600,
): Promise<RecordsResponse<T>> {
  const init: RequestInit & { next?: { revalidate: number } } =
    revalidate > 0 ? { next: { revalidate } } : { cache: 'no-store' }
  const res = await fetch(`${BASE}/${dataset}/records${buildQuery(params)}`, init)
  if (!res.ok) throw new Error(`${dataset} records API ${res.status}`)
  return res.json()
}

/**
 * Fetch every record from a dataset, paging in parallel beyond the first page.
 * Opendatasoft caps `limit` at 100 per records call.
 */
export async function fgcAllRecords<T>(
  dataset: string,
  params?: Record<string, Primitive | undefined>,
  revalidate = 3600,
): Promise<T[]> {
  const pageSize = 100
  const first = await fgcRecords<T>(dataset, { ...params, limit: pageSize, offset: 0 }, revalidate)
  const remaining = Math.ceil((first.total_count - first.results.length) / pageSize)
  if (remaining <= 0) return first.results
  const pages = await Promise.all(
    Array.from({ length: remaining }, (_, i) =>
      fgcRecords<T>(dataset, { ...params, limit: pageSize, offset: (i + 1) * pageSize }, revalidate),
    ),
  )
  return [first, ...pages].flatMap(p => p.results)
}

/**
 * Fetch a dataset's full JSON export (`limit=-1`), bypassing the 100-row
 * records cap. Used for large timetable pulls.
 */
export async function fgcExport<T>(dataset: string, revalidate = 3600): Promise<T[]> {
  const res = await fetch(`${BASE}/${dataset}/exports/json?limit=-1`, { next: { revalidate } })
  if (!res.ok) throw new Error(`${dataset} export ${res.status}`)
  return res.json()
}

/**
 * Fetch a member file of the `gtfs_zip` dataset (e.g. `stop_times.txt`) as raw
 * text. The dataset exposes each GTFS file as its own record with a download
 * URL, so we resolve the filename to its URL then fetch the body. Returns the
 * CSV text; callers parse it. These files are large and change at most daily,
 * so the default revalidate is long. Too large for Next's data cache, so the
 * body fetch is uncached (`no-store`) — only the small URL lookup is cached.
 */
export async function fgcGtfsFile(filename: string, revalidate = 86400): Promise<string> {
  const page = await fgcRecords<{ file: { filename: string; url: string } }>(
    'gtfs_zip',
    { limit: 20 },
    revalidate,
  )
  const url = page.results.find(r => r.file?.filename === filename)?.file?.url
  if (!url) throw new Error(`gtfs_zip has no ${filename}`)
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`gtfs_zip/${filename} fetch ${res.status}`)
  return res.text()
}

/**
 * Decode a GTFS-Realtime feed. These datasets expose a single record pointing
 * at a `.pb` protobuf file; we resolve that URL then decode it. Always fetched
 * fresh — realtime feeds must not be cached.
 */
export async function fgcFeed(dataset: string) {
  const rec = await fgcRecords<{ file: { url: string } }>(dataset, { limit: 1 }, 0)
  const pbUrl = rec.results[0]?.file?.url
  if (!pbUrl) throw new Error(`${dataset} has no .pb file`)

  const pbRes = await fetch(pbUrl, { cache: 'no-store' })
  if (!pbRes.ok) throw new Error(`${dataset} .pb fetch ${pbRes.status}`)
  const buffer = new Uint8Array(await pbRes.arrayBuffer())

  const { transit_realtime } = await import('gtfs-realtime-bindings')
  const message = transit_realtime.FeedMessage.decode(buffer)
  // int64 fields (e.g. stopTimeUpdate arrival/departure `time`) decode as
  // protobufjs Long objects, which break arithmetic (`time * 1000` → NaN).
  // Re-materialise as a plain object with longs coerced to JS numbers; GTFS-RT
  // timestamps are epoch seconds and fit safely within MAX_SAFE_INTEGER.
  return transit_realtime.FeedMessage.toObject(message, { longs: Number }) as typeof message
}
