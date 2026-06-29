'use client'

import { useRef, useEffect, useState } from 'react'
import { Map, Marker, NavigationControl, Source, Layer, Popup } from 'react-map-gl/maplibre'
import type { MapRef } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Train, Stop, Route, Theme } from '@/types'
import type { JourneyPath } from '@/lib/journeyPath'
import { LINE_COLORS, STATION_CODES } from '@/lib/constants'

const MAP_STYLES: Record<Theme, string> = {
  dark:  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
}

interface MapViewProps {
  trains: Train[]
  stops: Stop[]
  routes: Route[]
  lineColors: Record<string, string>
  selectedTrain: Train | null
  selectedStop: Stop | null
  onSelectTrain: (train: Train) => void
  onSelectStop: (stop: Stop) => void
  onCloseStop?: () => void
  journeyPath?: JourneyPath | null
  theme: Theme
}

export default function MapView({ trains, stops, routes, lineColors, selectedTrain, selectedStop, onSelectTrain, onSelectStop, onCloseStop, journeyPath, theme }: MapViewProps) {
  const mapRef = useRef<MapRef>(null)
  const [popupStop, setPopupStop] = useState<Stop | null>(null)

  useEffect(() => {
    if (!selectedTrain || !mapRef.current) return
    mapRef.current.flyTo({ center: [selectedTrain.lng, selectedTrain.lat], zoom: 14, duration: 1000 })
  }, [selectedTrain])

  useEffect(() => {
    if (!selectedStop || !mapRef.current) return
    mapRef.current.flyTo({ center: [selectedStop.lng, selectedStop.lat], zoom: 15, duration: 1000 })
    setPopupStop(selectedStop)
  }, [selectedStop])

  // When a journey path is drawn, frame it: fit both endpoints (and the whole
  // travelled path) into view with padding so the full trip is visible.
  useEffect(() => {
    if (!journeyPath || !mapRef.current) return
    const coords = journeyPath.legs.flatMap(l => l.coords)
    if (coords.length === 0) return
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng
      if (lat < minLat) minLat = lat
      if (lng > maxLng) maxLng = lng
      if (lat > maxLat) maxLat = lat
    }
    mapRef.current.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 80, maxZoom: 15, duration: 1000 },
    )
  }, [journeyPath])

  const routesGeoJson = {
    type: 'FeatureCollection' as const,
    features: routes
      .filter(r => r.geometry !== null)
      .map(r => ({
        type: 'Feature' as const,
        properties: { routeId: r.routeId, color: r.color, line: r.shortName },
        geometry: r.geometry!,
      })),
  }

  // The line of whatever is currently selected — its route is drawn bold.
  const highlightedLine = selectedTrain?.line ?? null

  // Journey path: one colored LineString per leg (transfers => color changes).
  const journeyGeoJson = {
    type: 'FeatureCollection' as const,
    features: (journeyPath?.legs ?? []).map((leg, i) => ({
      type: 'Feature' as const,
      properties: { color: leg.color, line: leg.line, idx: i },
      geometry: { type: 'LineString' as const, coordinates: leg.coords },
    })),
  }

  const stopsGeoJson = {
    type: 'FeatureCollection' as const,
    features: stops.map(s => ({
      type: 'Feature' as const,
      properties: {
        stopId: s.stopId,
        name: s.name,
        code: s.stopId.replace(/\d+$/, ''),
        wheelchair: s.wheelchairBoarding,
      },
      geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
    })),
  }

  return (
    <Map
      ref={mapRef}
      initialViewState={{ longitude: 2.07, latitude: 41.43, zoom: 10.5 }}
      style={{ width: '100%', height: '100%' }}
      mapStyle={MAP_STYLES[theme]}
      attributionControl={false}
      interactiveLayerIds={['stops-circles']}
      onClick={e => {
        const f = e.features?.[0]
        if (f?.layer?.id === 'stops-circles') {
          const hit = stops.find(s => s.stopId === (f.properties as { stopId: string }).stopId)
          if (hit) { setPopupStop(hit); onSelectStop(hit) }
        } else {
          setPopupStop(null)
          onCloseStop?.()
        }
      }}
    >
      <NavigationControl position="bottom-right" />

      {/* Route lines — drawn first so they appear below everything */}
      <Source id="routes" type="geojson" data={routesGeoJson}>
        <Layer
          id="routes-lines"
          type="line"
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          paint={{
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 13, 2.2],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.35, 13, 0.45],
          }}
        />
        {/* Highlighted line — the selected train's route, drawn bold on top */}
        <Layer
          id="routes-lines-highlight"
          type="line"
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          filter={['==', ['get', 'line'], highlightedLine ?? ' ']}
          paint={{
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 13, 5],
            'line-opacity': 0.95,
          }}
        />
      </Source>

      {/* Journey path — drawn above base routes, below stops/trains */}
      {journeyPath && journeyGeoJson.features.length > 0 && (
        <Source id="journey" type="geojson" data={journeyGeoJson}>
          {/* White casing for contrast against the basemap — inserted before the
              stop circles so stops always render on top of the journey line. */}
          <Layer
            id="journey-casing"
            type="line"
            beforeId="stops-circles"
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{
              'line-color': theme === 'dark' ? '#000' : '#fff',
              'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 14, 11],
              'line-opacity': 0.55,
            }}
          />
          {/* Colored line per leg */}
          <Layer
            id="journey-line"
            type="line"
            beforeId="stops-circles"
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{
              'line-color': ['get', 'color'],
              'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 6],
              'line-opacity': 1,
            }}
          />
        </Source>
      )}

      {/* Journey endpoint + transfer markers. Markers are HTML overlays, so they
          always render above the drawn line — the dots sit on top of the path.
          Origin is labelled "A", destination "B"; transfers stay as plain dots. */}
      {journeyPath?.stops.map((s, i, arr) => {
        const isOrigin = i === 0
        const isDest = i === arr.length - 1
        const isEnd = isOrigin || isDest
        const label = isOrigin ? 'A' : isDest ? 'B' : ''
        const size = isEnd ? 24 : 12
        return (
          <Marker key={`jp-${i}`} longitude={s.lng} latitude={s.lat}>
            <div
              title={s.name}
              style={{
                width: size,
                height: size,
                borderRadius: '50%',
                background: isEnd ? 'var(--accent)' : '#fff',
                border: `3px solid ${isEnd ? '#fff' : 'var(--accent)'}`,
                boxShadow: '0 0 0 2px rgba(0,0,0,0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                lineHeight: 1,
                fontFamily: 'var(--font-space-grotesk), sans-serif',
                userSelect: 'none',
              }}
            >
              {label}
            </div>
          </Marker>
        )
      })}

      {/* Stop circles + code labels */}
      <Source id="stops" type="geojson" data={stopsGeoJson}>
        <Layer
          id="stops-circles"
          type="circle"
          paint={{
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 11, 7, 13, 11],
            'circle-color': '#12122a',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#bbbbbb',
            // Fully opaque so the dots read as sitting on top of the drawn
            // journey line rather than the line bleeding through them.
            'circle-opacity': 1,
          }}
          minzoom={9}
        />
        <Layer
          id="stops-labels"
          type="symbol"
          layout={{
            'text-field': ['get', 'code'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 10, 6, 13, 9],
            'text-font': ['Open Sans Bold', 'Noto Sans Regular'],
            'text-allow-overlap': false,
          }}
          paint={{ 'text-color': '#ffffff' }}
          minzoom={10}
        />
      </Source>

      {/* Stop popup */}
      {popupStop && (() => {
        const code = popupStop.stopId.replace(/\d+$/, '')
        const stationName = STATION_CODES[code] ?? popupStop.name

        const passing = trains
          .map(t => {
            if (t.currentStop === stationName) return { train: t, status: 'here' as const, dist: 0 }
            const idx = t.upcomingStops.indexOf(stationName)
            if (idx !== -1) return { train: t, status: 'upcoming' as const, dist: idx + 1 }
            return null
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 4)

        return (
          <Popup
            longitude={popupStop.lng}
            latitude={popupStop.lat}
            anchor="bottom"
            closeButton
            closeOnClick={false}
            onClose={() => setPopupStop(null)}
            maxWidth="260px"
          >
            <div style={{ minWidth: 210 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 1 }}>{code}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>{popupStop.name}</div>

              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>
                Trens passant per aquí
              </div>

              {passing.length > 0 ? passing.map(({ train: t, status, dist }) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, padding: '5px 8px', background: 'var(--bg3)', borderRadius: 7, border: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 700, fontSize: 11, color: lineColors[t.line] || LINE_COLORS[t.line] || '#7a82a0', minWidth: 22 }}>{t.line}</span>
                  <span style={{ fontSize: 11, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>→ {t.destination}</span>
                  {t.delayMinutes > 0 && <span style={{ fontSize: 10, color: 'var(--red)', fontWeight: 600 }}>+{t.delayMinutes}m</span>}
                  {status === 'here'
                    ? <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>Ara aquí</span>
                    : <span style={{ fontSize: 10, color: 'var(--muted)' }}>{dist}p</span>}
                </div>
              )) : (
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Cap tren proper ara.
                </div>
              )}

              {popupStop.wheelchairBoarding && (
                <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 8 }}>♿ Accessible</div>
              )}
            </div>
          </Popup>
        )
      })()}

      {/* Train markers — rendered last so they float above lines and stops */}
      {trains.map(train => {
        const isSelected = selectedTrain?.id === train.id
        const color = lineColors[train.line] || LINE_COLORS[train.line] || '#7a82a0'
        return (
          <Marker
            key={train.id}
            longitude={train.lng}
            latitude={train.lat}
            onClick={e => {
              e.originalEvent.stopPropagation()
              onSelectTrain(train)
            }}
          >
            <div
              title={`${train.line} → ${train.destination}${train.delayMinutes > 0 ? ` (+${train.delayMinutes}m)` : ''}`}
              style={{
                width:          isSelected ? 32 : 24,
                height:         isSelected ? 32 : 24,
                borderRadius:   '50%',
                background:     color,
                border:         `2px solid ${isSelected ? '#fff' : 'rgba(255,255,255,0.3)'}`,
                boxShadow:      `0 0 0 ${isSelected ? 6 : 3}px ${color}44`,
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                fontSize:       isSelected ? 9 : 8,
                fontWeight:     700,
                color:          'white',
                cursor:         'pointer',
                transition:     'all 0.2s',
                fontFamily:     'Space Grotesk, sans-serif',
                letterSpacing:  '-0.3px',
                userSelect:     'none',
              }}
            >
              {train.line}
            </div>
          </Marker>
        )
      })}
    </Map>
  )
}
